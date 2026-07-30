/**
 * solver.js — Conversor geométrico propio (Signara), v2 "aiming".
 *
 * En vez de descomponer en ángulos de Euler sueltos (que no lograba subir el
 * antebrazo), este solver entrega, por frame, las DIRECCIONES 3D objetivo de
 * cada segmento del brazo:
 *   - dirección del brazo   = hombro → codo
 *   - dirección del antebrazo = codo → muñeca
 * expresadas en el marco del AVATAR (X mundo, Y arriba, Z hacia cámara). El
 * baker de la página apunta cada hueso hacia esa dirección con cuaterniones, lo
 * que reproduce elevación + adelante + codo correctamente (el antebrazo va a
 * donde de verdad apunta en el video).
 *
 * Marco del avatar (verificado con la calibración):
 *   lado derecho del avatar = -X mundo · arriba = +Y · frente (a cámara) = +Z
 */

export const CONFIG = {
  zSign:   -1,     // signo de la profundidad de MediaPipe al pasar a mundo
  fwdSign:  1,     // si las señas salen atrás en vez de adelante, poner -1
  fwdGain:  1.8,   // inclina las señas HACIA ADELANTE (no hacia arriba). Aplica
                   // también a datos 3D: los presenta más "de frente". Calibrable.
  smooth:   0.18,  // EMA final sobre ángulos (fino)
  dirSmooth: 0.15, // EMA general de direcciones (bajado de 0.20, dedos con
                   // menos temblor residual)
  posSmooth: 0.7,  // EMA LIGERO sobre la POSICIÓN de la muñeca (para no aplanar
                   // el momento en que las manos se juntan)
  // EMA sobre la orientación de muñeca (giro de palma). Estaba en 0.10
  // (fuerte) para arreglar GRACIAS, grabado con mala detección de manos — pero
  // eso mismo APLANABA movimientos reales de muñeca (ej. NO de lado a lado)
  // en grabaciones limpias: 0.10 dejaba un vaivén real (rango 0.57–0.73) casi
  // plano (0.62–0.65). Con grabaciones limpias (protocolo actual) 0.5 alcanza
  // para matar el ruido de un frame suelto sin aplastar el movimiento real.
  wristSmooth: 0.35, // bajado de 0.5 — quitar el temblor leve residual en pole/
                     // muñeca sin llegar al 0.10 que aplanaba el vaivén real de NO
  // Antes 0.7: en señas lado a lado (FAMILIA) jalaba las muñecas al mismo
  // punto y stackHands las dejaba una sobre otra. 0.25 solo acerca un poco
  // cuando ya están muy juntas (GRACIAS), sin colapsar la separación lateral.
  handAttract: 0.25,

  // ── Cabeza (Fase 3) ── nariz/orejas ya vienen en pose_world (33 puntos),
  // no hace falta grabar nada extra. Ejes por calibrar con el panel 🔧 Cabeza.
  headYawAxis:   'y',  // eje de girar la cabeza de lado a lado (NO)
  headPitchAxis: 'x',  // eje de asentir / alzar (arriba-abajo)
  headYawSign:   1,
  // VRM: +X en la cabeza baja la barbilla; MediaPipe “nariz arriba” debe
  // mapear a alzar → signo negativo.
  headPitchSign: -1,
  headGain:      2.2,  // MediaPipe da pitch muy pequeño; amplificar para que se vea
  headSmooth:    0.5,
  // Alza de cabeza solo en señas whitelist (TENGO_SED). En HOLA la mano toca
  // la sien y un assist genérico hacía un movimiento raro de cabeza/cuello.
  // 0.75/0.4 rad dejaban un "tirón" hacia atrás demasiado fuerte; 0.34 rad
  // (~19°) alza un poco más que 0.28 sin volver al tirón.
  headNeckAssist: 0.34,
  headNeckAssistTokens: ['TENGO_SED'],
  // Atracción a la garganta (0..1). No demasiado alta: si el weight cae un
  // poco al alejarse, un pull fuerte se nota como tirón. El fade temporal
  // (smoothNeckWeightSeq) hace el resto.
  wristNeckPull: 0.42,
  // Verbos direccionales (Fase 2 — ver src/utils/directionalVerbs.js): qué
  // tan fuerte se re-dirige la seña completa hacia el punto de destino
  // (0..1, constante en toda la seña). Subido de 0.4 a 0.6 (2026-07-21):
  // con AYUDA real grabado, 0.4 no se sentía como profundidad real en
  // AYUDAME/TE_AYUDO — el pull competía demasiado con el offset original
  // de la toma. Seguir calibrando viendo señas reales.
  directionalPull: 0.6,
  // AYUDALO / EL_ME_PERDONO (direction 'third' | 'third_self'): giro del
  // tronco en profundidad (eje Y), no inclinación lateral. Un hombro queda
  // un poco más adelantado (+Z) y el cuerpo “mira” hacia la derecha de
  // pantalla. ~0.2 rad ≈ 11°. Si se ve al lado contrario, invertir el signo.
  thirdTorsoYawY: 0.22,
  // PERDONAME (direction 'plead'): inclinación adelante del torso + cabeza.
  pleadTorsoLeanX: 0.14,
  pleadHeadPitchX: 0.08,
  // TE_AMO — concordancia sutil (mirada / torso / proyección suave).
  teAmoTorsoLeanX: 0.1,
  teAmoHeadPitchX: 0.06,
  teAmoListenerPull: 0.32,
  // me amas / me ama: ILY casi estático → pull al pecho (no reverse).
  teAmoSelfPull: 0.85,
  // Clearance Z delante del pecho (ILY ancha; avoidTorso genérico no alcanza).
  teAmoSelfMinFwd: 0.92,

  // ── Dedos (Fase 2) ──
  fingerGain: 1.0,   // escala del doblez de dedos (1 = ángulo real)
  fingerMax:  1.8,   // tope de doblez por articulación (radianes)
  fingerAxis: 'z',   // eje de curl en ESTE VRM (derecha +, izquierda −)
  thumbGain:  1.0,   // escala del doblez del pulgar
  thumbSign:  -1,    // el pulgar dobla con signo opuesto (según sus poses)
  thumbAxis:  'y',   // eje de cierre del PULGAR — distinto a fingerAxis (el
                      // pulgar tiene otra orientación de reposo en este VRM;
                      // medido con getPos: 'z' casi no acercaba la punta a la
                      // palma, 'y' sí lo hace de forma monótona y clara.

  // ── Muñeca (Fase 2b): giro de la palma desde pose_world 3D real ──
  palmFlip:   1,     // si la palma queda al revés (mira atrás), poner -1
  wristRoll:  0.785, // giro extra de la palma (rad) — calibrado a +45° (fuente: pose_world)

  // ── Fuente de orientación de muñeca ──
  // 'hand' = frameHandBasis (21 landmarks de la mano) para TODAS las señas —
  // confirmado visualmente mejor que 'pose' (frameWristBasis, 3 puntos de
  // pose_world) en BIEN/MAL/NO/SI, con wristRollHand=0°, tras corregir el
  // marco de ejes de frameHandBasis y el despike de saltos de tracking.
  // 'pose' queda como respaldo/comparación (panel 🧪 Prueba #1 en el lab) —
  // ver nota en la Prueba #1 del lab: para movimientos con componente fuerte
  // de PROFUNDIDAD (ej. un asentir que se inclina hacia la cámara), 'hand'
  // puede ser menos preciso que 'pose' porque su z es más débil — si algún
  // giro se ve inestable, comparar ambas fuentes ahí antes de asumir bug.
  wristSource:    'hand',
  wristRollHand:  0,      // confirmado visualmente en 0° para BIEN/MAL/NO/SI.
};

// ── Vector helpers ───────────────────────────────────────────────────────────
const sub  = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot  = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len  = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => { const l = len(a) || 1e-6; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const mid  = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

// ── Des-espejo del pose (00_capture.py hace cv2.flip) ────────────────────────
const POSE_LR_PAIRS = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10],
  [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

// Des-espejo para landmarks de IMAGEN (x en [0,1] → 1-x) + swap L/R.
function unmirrorPose(rawPose) {
  const flipped = rawPose.map((p) => (p ? [1 - (p[0] ?? 0), p[1] ?? 0, p[2] ?? 0] : [0, 0, 0]));
  for (const [l, r] of POSE_LR_PAIRS) {
    if (flipped[l] && flipped[r]) { const t = flipped[l]; flipped[l] = flipped[r]; flipped[r] = t; }
  }
  return flipped;
}

// Des-espejo para landmarks 3D MÉTRICOS (x en metros → -x) + swap L/R.
function unmirrorWorld(raw) {
  const flipped = raw.map((p) => (p ? [-(p[0] ?? 0), p[1] ?? 0, p[2] ?? 0] : [0, 0, 0]));
  for (const [l, r] of POSE_LR_PAIRS) {
    if (flipped[l] && flipped[r]) { const t = flipped[l]; flipped[l] = flipped[r]; flipped[r] = t; }
  }
  return flipped;
}

function worldize(lm) {
  return { x: lm[0] ?? 0, y: -(lm[1] ?? 0), z: CONFIG.zSign * (lm[2] ?? 0) };
}
function present(lm) {
  return lm && (Math.abs(lm[0]) + Math.abs(lm[1]) + Math.abs(lm[2] ?? 0)) > 1e-4;
}

// ¿El frame trae landmarks 3D reales (pose_world) usables?
function hasWorld(frame) {
  const w = frame.pose_world;
  return Array.isArray(w) && w.length >= 33 &&
    w.some((p) => Array.isArray(p) && (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2])) > 1e-4);
}

// Direccion del marco del cuerpo → marco del avatar.
//   avatar: derecha = -X, arriba = +Y, frente = +Z
//   gain amplifica la profundidad SOLO para datos de imagen (2D comprime z);
//   con pose_world (3D real) gain = 1.
function toAvatar(D, axes, gain) {
  const dr = dot(D, axes.right);
  const du = dot(D, axes.up);
  const df = dot(D, axes.fwd) * CONFIG.fwdSign * gain;
  return [-dr, du, df];
}

// ── API: frame → direcciones objetivo por brazo ──────────────────────────────
// Devuelve { right?: {upper:[x,y,z], lower:[x,y,z]}, left?: {...} } segun `arms`.
export function frameToArmDirs(frame, arms = { right: true, left: true }) {
  // Preferir 3D real (pose_world) si está; si no, caer a imagen 2D (legacy).
  const useWorld = hasWorld(frame);
  const pose = useWorld ? unmirrorWorld(frame.pose_world) : unmirrorPose(frame.pose || []);
  const gain = CONFIG.fwdGain;   // inclina hacia adelante (calibrable), también en 3D
  const g = (i) => (present(pose[i]) ? worldize(pose[i]) : null);

  const Rsh = g(12), Lsh = g(11);
  const Rel = g(14), Lel = g(13);
  const Rwr = g(16), Lwr = g(15);
  const Rhip = g(24), Lhip = g(23);
  if (!Rsh || !Lsh) return {};

  const right = norm(sub(Rsh, Lsh));
  const shC = mid(Rsh, Lsh);
  const hipC = (Rhip && Lhip) ? mid(Rhip, Lhip) : { x: shC.x, y: shC.y - 0.3, z: shC.z };
  const up = norm(sub(shC, hipC));
  const fwd = norm(cross(up, right));
  const axes = { right, up, fwd };

  // Para IK: dirección a la muñeca + alcance (fracción del largo del brazo) +
  // dirección del codo (pole). El baker convierte esto en posición objetivo y
  // resuelve los ángulos para que la muñeca LLEGUE ahí (así las manos se juntan).
  // IK con referencia COMÚN: la posición de la muñeca se mide respecto al CENTRO
  // de los hombros (shC), no a cada hombro por separado. Así, al reproducirla en
  // el avatar (escalada por el largo del brazo), las dos manos se juntan donde de
  // verdad se juntaron. `wristOffset` va en metros (marco del avatar); el baker
  // lo escala por (largo brazo avatar / recArmLen).
  const armData = (Sh, El, Wr) => {
    const vU = sub(El, Sh), vL = sub(Wr, El);
    return {
      pole:        toAvatar(norm(vU), axes, 1),      // dir del codo (desambigua IK)
      wristOffset: toAvatar(sub(Wr, shC), axes, 1),  // muñeca respecto al centro de hombros
      recArmLen:   (len(vU) + len(vL)) || 1e-6,
    };
  };
  const out = { _world: useWorld };
  if (arms.right && Rsh && Rel && Rwr) out.right = armData(Rsh, Rel, Rwr);
  if (arms.left && Lsh && Lel && Lwr) out.left = armData(Lsh, Lel, Lwr);
  return out;
}

// ── Qué brazos usa la seña ────────────────────────────────────────────────────
// Espejo: mano anatómica derecha = frame.lh, izquierda = frame.rh.
function handActive(h) {
  return Array.isArray(h) && h.length === 21 &&
    h.some((p) => Array.isArray(p) && (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2] ?? 0)) > 1e-3);
}

export function activeArms(dataset) {
  const frames = dataset.frames || [];
  let r = 0, l = 0;
  for (const f of frames) {
    if (handActive(f.lh)) r++;   // anatómica DERECHA
    if (handActive(f.rh)) l++;   // anatómica IZQUIERDA
  }
  const need = Math.max(3, frames.length * 0.15);
  const right = r >= need, left = l >= need;
  // Sin manos detectadas: NO forzar brazos. Antes se ponían right=left=true
  // y el IK usaba solo muñecas de pose_world → brazos que van adelante/atrás
  // sin gesto real. La cabeza sigue moviéndose vía frameHeadRotation (pose).
  return { right, left };
}

// ── Cabeza (Fase 3): nariz + orejas de pose_world → yaw/pitch de la cabeza ────
// MediaPipe Pose (33 pts) YA incluye nariz(0) y orejas(7,8) con profundidad
// real dentro de pose_world — no hace falta grabar nada extra ni usar los 478
// puntos de cara (esos no traen profundidad). "Adelante de la cabeza" se mide
// como nariz - punto_medio_orejas; yaw/pitch se sacan de cuánto se desvía esa
// dirección del eje del cuerpo (hombros/cadera), así que una cabeza quieta
// mirando a cámara da ~0 y asentir/girar produce la señal real.
export function frameHeadRotation(frame) {
  if (!hasWorld(frame)) return null;
  const pose = unmirrorWorld(frame.pose_world);
  const axes = bodyAxesFromPose(pose);
  if (!axes) return null;
  const g = (i) => (present(pose[i]) ? worldize(pose[i]) : null);
  const nose = g(0), earL = g(7), earR = g(8);
  if (!nose || !earL || !earR) return null;
  const earMid = mid(earL, earR);
  const fwd = norm(sub(nose, earMid));
  const [right, up, forward] = toAvatar(fwd, axes, 1.0);
  const yaw = Math.atan2(right, forward) * CONFIG.headYawSign * CONFIG.headGain;
  const pitch = Math.atan2(up, Math.hypot(right, forward)) * CONFIG.headPitchSign * CONFIG.headGain;
  return { yaw, pitch };
}

export function smoothHeadSeq(rots, alpha = CONFIG.headSmooth) {
  let acc = null;
  return rots.map((r) => {
    if (!r) { acc = null; return null; }
    acc = acc ? { yaw: acc.yaw + alpha * (r.yaw - acc.yaw), pitch: acc.pitch + alpha * (r.pitch - acc.pitch) } : { ...r };
    return { ...acc };
  });
}

// ── Dedos (Fase 2): landmarks de mano → doblez de cada articulación ──────────
// MediaPipe mano (21 pts): muñeca=0, pulgar=1-4, índice=5-8, medio=9-12,
// anular=13-16, meñique=17-20. Recordatorio del espejo: la mano ANATÓMICA
// derecha viene en frame.lh, la izquierda en frame.rh.
const FINGERS = {
  Index:  [5, 6, 7, 8],
  Middle: [9, 10, 11, 12],
  Ring:   [13, 14, 15, 16],
  Little: [17, 18, 19, 20],
};

function angBetween(a, b) {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

// Doblez por articulación de un dedo: ángulo entre segmentos consecutivos.
// Recto = 0; cerrado ≈ 1.4-1.6 rad por articulación.
function fingerCurls(hand) {
  const V = (i) => ({ x: hand[i][0], y: hand[i][1], z: hand[i][2] ?? 0 });
  const wrist = V(0);
  const out = {};
  for (const [name, [a, b, c, d]] of Object.entries(FINGERS)) {
    const s0 = norm(sub(V(a), wrist));   // metacarpo (muñeca→nudillo)
    const s1 = norm(sub(V(b), V(a)));    // falange proximal
    const s2 = norm(sub(V(c), V(b)));    // media
    const s3 = norm(sub(V(d), V(c)));    // distal
    out[name] = [angBetween(s0, s1), angBetween(s1, s2), angBetween(s2, s3)];
  }
  const t = [1, 2, 3, 4].map(V);
  const t1 = norm(sub(t[1], t[0]));
  const t2 = norm(sub(t[2], t[1]));
  const t3 = norm(sub(t[3], t[2]));
  let tp = angBetween(t1, t2), ti = angBetween(t2, t3);
  // El pulgar cierra contra el puño sobre todo por ADUCCIÓN/oposición (se
  // mueve de lado hacia la palma), no solo doblándose — puede quedar
  // "tuckeado" contra el puño y seguir viéndose casi recto en el ángulo
  // entre falanges. Se refuerza con qué tan cerca queda la PUNTA del pulgar
  // del nudillo del dedo medio (centro de la palma), normalizado por el
  // tamaño de la mano: medido en datos reales, un pulgar extendido (BIEN)
  // da ~1.3-1.5×, uno cerrado (SI) baja a ~0.4-0.9× — señal clara e
  // independiente del doblez propio.
  // EXCEPCIÓN letra K: el pulgar VA entre índice y medio (cerca del nudillo
  // medio a propósito). No aplicar proximityCurl o el avatar lo “cierra”
  // por fuera en vez de meterlo en la V.
  const tip = V(4), palmRef = V(9), wristPt = V(0);
  const handSpan = len(sub(palmRef, wristPt)) || 1e-6;
  const ratio = len(sub(tip, palmRef)) / handSpan;
  if (!thumbInIndexMiddleGap(hand)) {
    const proximityCurl = Math.max(0, 1 - ratio) * 2.2;
    tp = Math.max(tp, proximityCurl);
  }
  out.Thumb = [tp, ti];  // MCP, IP
  return out;
}

/** Pulgar entre índice y medio (forma K LSC/ASL), no “fuera” del puño. */
function thumbInIndexMiddleGap(hand) {
  if (!handPresent(hand)) return false;
  const V = (i) => ({ x: hand[i][0], y: hand[i][1], z: hand[i][2] ?? 0 });
  const tip = V(4);
  const iTip = V(8);
  const mTip = V(12);
  const ab = sub(mTip, iTip);
  const abLen2 = dot(ab, ab) || 1e-9;
  const t = Math.max(0, Math.min(1, dot(sub(tip, iTip), ab) / abLen2));
  const closest = {
    x: iTip.x + ab.x * t,
    y: iTip.y + ab.y * t,
    z: iTip.z + ab.z * t,
  };
  const dist = len(sub(tip, closest));
  const gap = Math.sqrt(abLen2) || 1e-6;
  return t > 0.18 && t < 0.82 && dist < gap * 0.9;
}

function fingerExt(hand, mcp, tip) {
  const V = (i) => ({ x: hand[i][0], y: hand[i][1], z: hand[i][2] ?? 0 });
  const wrist = V(0);
  const bone = len(sub(V(mcp), wrist)) || 1e-6;
  return len(sub(V(tip), V(mcp))) / bone;
}

/** Forma K: índice+medio abiertos, anular/meñique cerrados, pulgar en la V. */
function isLetterKHand(hand) {
  if (!handPresent(hand)) return false;
  const iE = fingerExt(hand, 5, 8);
  const mE = fingerExt(hand, 9, 12);
  const rE = fingerExt(hand, 13, 16);
  const pE = fingerExt(hand, 17, 20);
  return (
    iE >= 0.75 &&
    mE >= 0.75 &&
    rE < iE * 0.75 &&
    pE < iE * 0.75 &&
    thumbInIndexMiddleGap(hand)
  );
}

/**
 * Letra K: V abierta. Largo máximo (falanges en 0, como 184) + orientación
 * de cuando “faltaba un poco para verse” (detrás / hueco, ~176–177).
 */
export function letterKFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  bones[`${side}IndexProximal`] = { x: 0, y: s * 0.5, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleProximal`] = { x: 0, y: s * -0.4, z: 0 };
  bones[`${side}MiddleIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleDistal`] = { x: 0, y: 0, z: 0 };
  for (const f of ['Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.4);
    bones[`${side}${f}Intermediate`] = curl(1.35);
    bones[`${side}${f}Distal`] = curl(0.7);
  }
  // Largo max (falanges 0). CMC más hacia la V → yema ENTRE índice y corazón.
  bones[`${side}ThumbMetacarpal`] = { x: s * -0.85, y: s * -0.55, z: s * -0.3 };
  bones[`${side}ThumbProximal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: 0, z: 0 };
  return bones;
}

/**
 * Letra V (LSC): índice + corazón ARRIBA y SEPARADOS (Y). Anular/meñique
 * en puño; pulgar metido. Sin esto, frameFingers solo pone curl Z
 * y los dos dedos quedan pegados.
 */
export function letterVFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  bones[`${side}IndexProximal`] = { x: 0, y: s * 0.22, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleProximal`] = { x: 0, y: s * -0.22, z: 0 };
  bones[`${side}MiddleIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleDistal`] = { x: 0, y: 0, z: 0 };
  for (const f of ['Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.45);
    bones[`${side}${f}Intermediate`] = curl(1.4);
    bones[`${side}${f}Distal`] = curl(0.85);
  }
  // Pulgar pegado a anular/meñique (lado invertido vs hiddenThumbBones).
  bones[`${side}ThumbMetacarpal`] = { x: s * -0.45, y: s * -0.55, z: s * 0.35 };
  bones[`${side}ThumbProximal`] = { x: s * -0.3, y: s * -1.15, z: s * 0.2 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.75, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.5, z: 0 };
  return bones;
}

/**
 * Letra W (LSC): índice + corazón + anular ARRIBA con apertura leve (Y).
 * Meñique en puño; pulgar pegado. Mismo problema que V sin spread Y.
 */
export function letterWFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  bones[`${side}IndexProximal`] = { x: 0, y: s * 0.2, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleProximal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleDistal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}RingProximal`] = { x: 0, y: s * -0.2, z: 0 };
  bones[`${side}RingIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}RingDistal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}LittleProximal`] = curl(1.5);
  bones[`${side}LittleIntermediate`] = curl(1.45);
  bones[`${side}LittleDistal`] = curl(0.9);
  bones[`${side}ThumbMetacarpal`] = { x: s * -0.45, y: s * -0.55, z: s * 0.35 };
  bones[`${side}ThumbProximal`] = { x: s * -0.3, y: s * -1.15, z: s * 0.2 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.75, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.5, z: 0 };
  return bones;
}

/**
 * Letra P (lámina LSC): NO es una K invertida.
 * - Índice recto ↓ = trazo de la P
 * - Corazón curvado + pulgar (yemas se tocan) = panza
 * - Anular/meñique en puño
 */
export function letterPFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  // Trazo vertical (sigue el fwd ↓ de la muñeca).
  bones[`${side}IndexProximal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  // Panza: corazón se curva hacia el pulgar (no abierto en V).
  bones[`${side}MiddleProximal`] = { x: 0, y: s * 0.22, z: s * 0.55 };
  bones[`${side}MiddleIntermediate`] = { x: 0, y: 0, z: s * 1.05 };
  bones[`${side}MiddleDistal`] = { x: 0, y: 0, z: s * 0.75 };
  for (const f of ['Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.45);
    bones[`${side}${f}Intermediate`] = curl(1.4);
    bones[`${side}${f}Distal`] = curl(0.75);
  }
  // Pulgar hacia la yema del corazón (cierra la panza).
  bones[`${side}ThumbMetacarpal`] = { x: s * -0.15, y: s * 0.12, z: 0 };
  bones[`${side}ThumbProximal`] = {
    x: s * -0.5,
    y: s * 0.52,
    z: s * -0.92,
  };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * 0.32, z: s * -0.7 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * 0.28, z: s * -0.75 };
  return bones;
}

/**
 * Letra L: índice arriba + pulgar al costado (90°), proporción natural.
 * Apertura moderada solo en CMC; falanges rectas (sin quiebre ni “brazo” largo).
 */
export function letterLFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  bones[`${side}IndexProximal`] = { x: 0, y: s * 0.06, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  for (const f of ['Middle', 'Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.35);
    bones[`${side}${f}Intermediate`] = curl(1.3);
    bones[`${side}${f}Distal`] = curl(0.65);
  }
  // Apertura corta en la base — suave, sin estirar el mesh.
  bones[`${side}ThumbMetacarpal`] = { x: 0, y: s * 0.32, z: 0 };
  bones[`${side}ThumbProximal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: 0, z: 0 };
  return bones;
}

/**
 * Letra T (LSC): índice acostado (horizontal); corazón+anular+meñique ARRIBA;
 * pulgar como la F (metido en Y). Palma hacia adelante.
 */
export function letterTFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const bones = {};
  // Índice horizontal ⊥ al pulgar, señalando al avatar (curl Z ≈ 90°).
  // Con esta muñeca el eje X no acuesta el dedo; Z sí (hacia la palma).
  bones[`${side}IndexProximal`] = { x: 0, y: 0, z: s * 1.55 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  // Corazón, anular y meñique arriba.
  for (const f of ['Middle', 'Ring', 'Little']) {
    const ySpread = f === 'Middle' ? 0.02 : f === 'Ring' ? -0.02 : -0.06;
    bones[`${side}${f}Proximal`] = { x: 0, y: s * ySpread, z: 0 };
    bones[`${side}${f}Intermediate`] = { x: 0, y: 0, z: 0 };
    bones[`${side}${f}Distal`] = { x: 0, y: 0, z: 0 };
  }
  // Pulgar igual que F (cierre en Y).
  bones[`${side}ThumbMetacarpal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbProximal`] = { x: 0, y: s * -0.9, z: 0 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.5, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.35, z: 0 };
  return bones;
}

/**
 * Letra R (LSC/LSM): índice y corazón RECTOS (sin curvar), cruzados —
 * se cruzan hacia arriba; índice DELANTE del corazón. Anular/meñique en
 * puño; pulgar pegado (lado invertido vs hiddenThumbBones).
 */
export function letterRFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  // Rectos (z=0 en falanges) + Y en MCP para cruzar en línea; X = profundidad.
  bones[`${side}IndexProximal`] = { x: s * -0.32, y: s * -0.28, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleProximal`] = { x: s * 0.28, y: s * 0.32, z: 0 };
  bones[`${side}MiddleIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}MiddleDistal`] = { x: 0, y: 0, z: 0 };
  for (const f of ['Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.5);
    bones[`${side}${f}Intermediate`] = curl(1.45);
    bones[`${side}${f}Distal`] = curl(0.9);
  }
  bones[`${side}ThumbMetacarpal`] = { x: s * -0.45, y: s * -0.55, z: s * 0.35 };
  bones[`${side}ThumbProximal`] = { x: s * -0.3, y: s * -1.15, z: s * 0.2 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.75, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.5, z: 0 };
  return bones;
}

/**
 * Pulgar DETRÁS de los dedos (M / N). En este VRM y− cierra al puño;
 * x+/z− meten el pulgar bajo los dedos (x−/z+ lo abrían hacia afuera).
 */
export function hiddenThumbBones(side) {
  const s = side === 'right' ? 1 : -1;
  return {
    [`${side}ThumbMetacarpal`]: { x: s * 0.45, y: s * -0.55, z: s * -0.35 },
    [`${side}ThumbProximal`]: { x: s * 0.3, y: s * -1.15, z: s * -0.2 },
    [`${side}ThumbIntermediate`]: { x: 0, y: s * -0.75, z: 0 },
    [`${side}ThumbDistal`]: { x: 0, y: s * -0.5, z: 0 },
  };
}

/** Meñique cerrado (puño) — para armar M a partir de la mano N. */
export function fistLittleBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  return {
    [`${side}LittleProximal`]: curl(1.5),
    [`${side}LittleIntermediate`]: curl(1.5),
    [`${side}LittleDistal`]: curl(1.0),
  };
}

/** Anular + meñique en puño (N / Ñ: solo índice y corazón “activos”). */
export function fistRingLittleBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  for (const f of ['Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.5);
    bones[`${side}${f}Intermediate`] = curl(1.5);
    bones[`${side}${f}Distal`] = curl(1.0);
  }
  return bones;
}

/**
 * Letra F (LSC): puño cerrado + SOLO índice arriba (foto de captura).
 *
 * Por qué siempre salía L: en ESTE VRM el pulgar se cierra en el eje Y
 * (CONFIG.thumbAxis='y', thumbSign=-1 → y negativo en derecha). Forzar
 * y positivo / jugar con z/x abre el pulgar al costado (= L). Aquí el
 * cierre va solo en Y, como handToFingerBones.
 */
export function letterFFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  // Índice arriba.
  bones[`${side}IndexProximal`] = { x: 0, y: s * 0.08, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  // Medio / anular / meñique en puño.
  for (const f of ['Middle', 'Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.4);
    bones[`${side}${f}Intermediate`] = curl(1.4);
    bones[`${side}${f}Distal`] = curl(0.7);
  }
  // Pulgar METIDO (cierre real = Y con signo del solver; sin y+ = sin L).
  bones[`${side}ThumbMetacarpal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbProximal`] = { x: 0, y: s * -0.9, z: 0 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.5, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.35, z: 0 };
  return bones;
}

/**
 * Letra G (LSC): puño cerrado + índice en GANCHO (PIP/DIP curvados);
 * el movimiento circular de “enganchar” lo aporta la captura (G.json).
 * Pulgar metido en Y (mismo criterio que F — evita L).
 */
export function letterGFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const curl = (z) => ({ x: 0, y: 0, z: s * z });
  const bones = {};
  // Índice: gancho — MCP leve, PIP/DIP fuertes (como enganchar).
  bones[`${side}IndexProximal`] = { x: 0, y: s * 0.06, z: s * 0.4 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: s * 1.15 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: s * 1.05 };
  // Resto en puño.
  for (const f of ['Middle', 'Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = curl(1.4);
    bones[`${side}${f}Intermediate`] = curl(1.4);
    bones[`${side}${f}Distal`] = curl(0.7);
  }
  // Pulgar cerrado (eje Y del VRM).
  bones[`${side}ThumbMetacarpal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}ThumbProximal`] = { x: 0, y: s * -0.9, z: 0 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.5, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.35, z: 0 };
  return bones;
}

/**
 * Letra D (LSC): índice arriba + círculo.
 * Pulgar = el de la C (curva hacia las yemas, sin z extremo ni y alta tipo L).
 * Los 3 dedos se cierran MÁS para tocar ese pulgar → círculo.
 */
export function letterDFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const bones = letterCFingerBones(side);
  bones[`${side}IndexProximal`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: 0 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: 0 };
  // Más curl → yemas bajan hasta el pulgar de la C.
  for (const f of ['Middle', 'Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = { x: 0, y: 0, z: s * -1.15 };
    bones[`${side}${f}Intermediate`] = { x: 0, y: 0, z: s * -1.4 };
    bones[`${side}${f}Distal`] = { x: 0, y: 0, z: s * -1.0 };
  }
  // Pulgar idéntico a la C (ya apunta a las yemas) + un poco más de cierre.
  bones[`${side}ThumbProximal`] = {
    x: s * -0.5,
    y: s * 0.48,
    z: s * -0.78,
  };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * 0.28, z: s * -0.55 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * 0.22, z: s * -0.6 };
  return bones;
}

/**
 * Letra O (LSC): mismo círculo que la D, sin dedo alzado — los 4 dedos
 * cierran el óvalo con el pulgar (forma D con índice también metido).
 */
export function letterOFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const bones = letterDFingerBones(side);
  bones[`${side}IndexProximal`] = { x: 0, y: 0, z: s * -1.15 };
  bones[`${side}IndexIntermediate`] = { x: 0, y: 0, z: s * -1.4 };
  bones[`${side}IndexDistal`] = { x: 0, y: 0, z: s * -1.0 };
  return bones;
}

/**
 * Letra Q (LSM): palma acostada hacia ARRIBA; las 5 yemas se juntan arriba
 * (pico / capullo, no óvalo O). MCP casi recto → puntas visibles;
 * pulgar tipo C/O (y+) a la punta — y− lo escondía detrás de los dedos.
 */
export function letterQFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const bones = {};
  const ySqueeze = { Index: -0.12, Middle: -0.03, Ring: 0.08, Little: 0.16 };
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = { x: 0, y: s * ySqueeze[f], z: s * 0.12 };
    bones[`${side}${f}Intermediate`] = { x: 0, y: 0, z: s * 0.85 };
    bones[`${side}${f}Distal`] = { x: 0, y: 0, z: s * 0.7 };
  }
  // Pulgar escondido al otro lado (hiddenThumbBones iba al contrario en Q).
  bones[`${side}ThumbMetacarpal`] = { x: s * -0.45, y: s * -0.55, z: s * 0.35 };
  bones[`${side}ThumbProximal`] = { x: s * -0.3, y: s * -1.15, z: s * 0.2 };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * -0.75, z: 0 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * -0.5, z: 0 };
  return bones;
}

/**
 * Letra C (LSM/ASL): arco redondo tipo “C”.
 * - 4 dedos con el MISMO curl → yemas alineadas en el arco
 * - curl fuerte → curva de C (no garra plana)
 * - pulgar curvado hacia las yemas (cierra la mandíbula inferior)
 */
export function letterCFingerBones(side) {
  const s = side === 'right' ? 1 : -1;
  const bones = {};
  // Mismo ángulo en los 4 → puntas alineadas; PIP alto = C redonda.
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
    bones[`${side}${f}Proximal`] = { x: 0, y: 0, z: s * -0.62 };
    bones[`${side}${f}Intermediate`] = { x: 0, y: 0, z: s * -1.05 };
    bones[`${side}${f}Distal`] = { x: 0, y: 0, z: s * -0.55 };
  }
  // Pulgar se curva HACIA las yemas (no recto horizontal).
  bones[`${side}ThumbProximal`] = {
    x: s * -0.45,
    y: s * 0.4,
    z: s * -0.7,
  };
  bones[`${side}ThumbIntermediate`] = { x: 0, y: s * 0.22, z: s * -0.5 };
  bones[`${side}ThumbDistal`] = { x: 0, y: s * 0.18, z: s * -0.55 };
  return bones;
}

function handPresent(h) {
  return Array.isArray(h) && h.length === 21 &&
    h.some((p) => Array.isArray(p) && (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2] ?? 0)) > 1e-3);
}

// Huesos de dedos de UN lado a partir de su mano. side: 'right' | 'left'.
function handToFingerBones(hand, side, { skipLetterK = false } = {}) {
  // Letra K: forzar pulgar entre índice/medio (el curl genérico lo saca afuera).
  // skipLetterK: la P grabada parece K geométricamente — no sustituir por K.
  if (!skipLetterK && isLetterKHand(hand)) return letterKFingerBones(side);

  const sign = side === 'right' ? 1 : -1;   // curl: derecha +, izquierda −
  const ax = CONFIG.fingerAxis;
  const G = CONFIG.fingerGain, M = CONFIG.fingerMax;
  const set = (v) => Math.max(-M, Math.min(M, v));
  const curls = fingerCurls(hand);
  const bones = {};
  const put = (name, val, axis = ax) => { bones[name] = { x: 0, y: 0, z: 0, [axis]: set(val) }; };

  for (const f of Object.keys(FINGERS)) {
    const [p, i, d] = curls[f];
    put(`${side}${f}Proximal`,     sign * p * G);
    put(`${side}${f}Intermediate`, sign * i * G);
    put(`${side}${f}Distal`,       sign * d * G);
  }
  const [tp, ti] = curls.Thumb;
  const tsign = sign * CONFIG.thumbSign, TG = CONFIG.thumbGain;
  // El pulgar tiene otra orientación de reposo en este VRM: medido moviendo
  // punta-pulgar↔palma en el modelo, el eje que de verdad lo cierra es 'y'
  // (con 'z', el mismo de los otros 4 dedos, casi no se movía). thumbAxis.
  // Metacarpal/Intermediate siempre a 0: letterL (y otras) pueden dejar Y
  // en CMC y, como applyPose solo toca claves presentes, se “pegaba” a
  // todas las señas siguientes.
  bones[`${side}ThumbMetacarpal`] = { x: 0, y: 0, z: 0 };
  put(`${side}ThumbProximal`, tsign * tp * TG, CONFIG.thumbAxis);
  bones[`${side}ThumbIntermediate`] = { x: 0, y: 0, z: 0 };
  put(`${side}ThumbDistal`,   tsign * ti * TG, CONFIG.thumbAxis);
  return bones;
}

// Marco del cuerpo (derecha/arriba/frente) desde un pose ya worldizado.
function bodyAxesFromPose(pose) {
  const g = (i) => (present(pose[i]) ? worldize(pose[i]) : null);
  const Rsh = g(12), Lsh = g(11), Rhip = g(24), Lhip = g(23);
  if (!Rsh || !Lsh) return null;
  const right = norm(sub(Rsh, Lsh));
  const shC = mid(Rsh, Lsh);
  const hipC = (Rhip && Lhip) ? mid(Rhip, Lhip) : { x: shC.x, y: shC.y - 0.3, z: shC.z };
  const up = norm(sub(shC, hipC));
  const fwd = norm(cross(up, right));
  return { right, up, fwd };
}

// Dirección de la muñeca (muñeca→nudillo del medio) en marco del avatar, para
// orientar el hueso de la mano. Usa landmarks de mano (imagen 2D) mapeados con
// el marco del cuerpo de imagen — el giro fino de la palma queda aproximado.
export function frameHandFwd(frame, arms = { right: true, left: true }) {
  const pose = unmirrorPose(frame.pose || []);
  const axes = bodyAxesFromPose(pose);
  if (!axes) return {};
  const fwdOf = (h) => {
    const w = worldize([1 - (h[0][0] ?? 0), h[0][1] ?? 0, h[0][2] ?? 0]);
    const m = worldize([1 - (h[9][0] ?? 0), h[9][1] ?? 0, h[9][2] ?? 0]);
    return toAvatar(norm(sub(m, w)), axes, 1.0);
  };
  const out = {};
  if (arms.right && handPresent(frame.lh)) out.right = fwdOf(frame.lh);
  if (arms.left && handPresent(frame.rh)) out.left = fwdOf(frame.rh);
  return out;
}

// Muñeca (Fase 2b): plano de la palma desde pose_world 3D real.
// pose_world trae muñeca + nudillos de índice/meñique con profundidad de verdad
// (índices tras unmirror: der 16/20/18, izq 15/19/17). Con ellos se arma la
// orientación completa de la mano: `fwd` = hacia los nudillos, `normal` =
// perpendicular a la palma. Devuelve direcciones en marco del avatar.
export function frameWristBasis(frame, arms = { right: true, left: true }) {
  if (!hasWorld(frame)) return {};   // sin 3D real no hay giro fiable
  const pose = unmirrorWorld(frame.pose_world);
  const axes = bodyAxesFromPose(pose);
  if (!axes) return {};
  const g = (i) => (present(pose[i]) ? worldize(pose[i]) : null);
  const basisFor = (wi, ii, pi) => {
    const w = g(wi), ix = g(ii), pk = g(pi);
    if (!w || !ix || !pk) return null;
    // Si la mano está cerca del cuerpo/cara, estos 3 puntos de POSE (baja
    // resolución, pensados para el esqueleto, no para la mano) quedan casi
    // superpuestos — dan una dirección basura. Descartamos el frame en vez
    // de devolver ruido; frameHandBasis (más preciso) cubre ese caso.
    const span = Math.max(len(sub(ix, w)), len(sub(pk, w)));
    if (span < 0.04) return null;
    const fwd = norm(sub(mid(ix, pk), w));
    let nrm = norm(cross(sub(ix, w), sub(pk, w)));
    nrm = { x: nrm.x * CONFIG.palmFlip, y: nrm.y * CONFIG.palmFlip, z: nrm.z * CONFIG.palmFlip };
    return { fwd: toAvatar(fwd, axes, 1.0), normal: toAvatar(nrm, axes, 1.0) };
  };
  const out = {};
  if (arms.right) { const b = basisFor(16, 20, 18); if (b) out.right = b; }
  if (arms.left)  { const b = basisFor(15, 19, 17); if (b) out.left = b; }
  return out;
}

// Igual que frameWristBasis, pero usando los landmarks PROPIOS de la mano
// (lh/rh, 21 puntos — el mismo set de alta resolución que ya usamos para los
// dedos en frameFingers) en vez de los puntos aproximados de pose_world. Es
// más preciso SIEMPRE, y crítico cuando la mano está cerca de la cara/cuerpo
// (señas como HOLA): ahí pose_world casi no distingue muñeca/índice/meñique
// (oclusión), pero el modelo de mano dedicado sigue viéndola bien porque
// trabaja en un recorte de alta resolución centrado en la mano.
// El marco del CUERPO (adelante/arriba/derecha) se toma de pose_world (3D
// real) cuando está disponible — igual que frameWristBasis — y no del pose 2D
// de imagen: medido contra BIEN (ya calibrado y correcto con pose_world), el
// marco 2D quedaba desalineado ~23° incluso con el mejor giro posible, porque
// no es solo cuestión de rotar más — el eje "adelante" mismo salía torcido.
// Los landmarks de la MANO (lh/rh) sí siguen siendo de imagen normalizada,
// pero como fwd/normal se normalizan antes de proyectar (toAvatar solo usa
// producto punto con ejes unitarios), no hace falta que compartan escala con
// pose_world — solo que apunten en la dirección real, y sí lo hacen.
export function frameHandBasis(frame, arms = { right: true, left: true }) {
  const pose2d = unmirrorPose(frame.pose || []);
  const axes = hasWorld(frame) ? bodyAxesFromPose(unmirrorWorld(frame.pose_world)) : bodyAxesFromPose(pose2d);
  if (!axes) return {};
  const unmir = (p) => worldize([1 - (p[0] ?? 0), p[1] ?? 0, p[2] ?? 0]);
  const basisFor = (h) => {
    if (!handPresent(h)) return null;
    const w = unmir(h[0]), ix = unmir(h[5]), pk = unmir(h[17]);   // muñeca, MCP índice, MCP meñique
    const fwd = norm(sub(mid(ix, pk), w));
    let nrm = norm(cross(sub(ix, w), sub(pk, w)));
    nrm = { x: nrm.x * CONFIG.palmFlip, y: nrm.y * CONFIG.palmFlip, z: nrm.z * CONFIG.palmFlip };
    return { fwd: toAvatar(fwd, axes, 1.0), normal: toAvatar(nrm, axes, 1.0) };
  };
  const out = {};
  if (arms.right) { const b = basisFor(frame.lh); if (b) out.right = b; }   // espejo: lh = mano anatómica derecha
  if (arms.left)  { const b = basisFor(frame.rh); if (b) out.left = b; }
  return out;
}

const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))) * 180 / Math.PI;
const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1e-6; return [a[0]/l, a[1]/l, a[2]/l]; };

// Repara saltos AISLADOS (1-2 frames seguidos) en una secuencia de {fwd,
// normal}: para cada frame, compara su dirección contra una ventana ancha de
// vecinos (radio 3, no solo el inmediato — un salto de 2 frames seguidos
// "se valida" entre sí si solo se mira el vecino de al lado) usando la
// MEDIANA de esas distancias angulares (robusta: no la arrastra un par de
// vecinos también dañados). Si la mediana es grande, es casi seguro una
// pérdida momentánea de tracking de la mano (landmarks "presentes" pero
// basura) — un giro real que se invierte por 1-2 frames y vuelve enseguida
// no es físicamente posible a 30fps. Se reemplaza por el promedio de los
// frames buenos más cercanos (antes y después, saltando los también dañados).
// General: protege cualquier grabación futura, no solo una seña puntual.
export function despikeWristSeq(seq) {
  const n = seq.length;
  const RADIUS = 3, MIN_NEIGHBORS = 3, MEDIAN_THRESHOLD_DEG = 55;
  const bad = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!seq[i]) continue;
    const dists = [];
    for (let d = -RADIUS; d <= RADIUS; d++) {
      if (d === 0) continue;
      const j = i + d;
      if (j >= 0 && j < n && seq[j]) {
        // También la normal de palma: en AYUDA el fwd se mantiene pero la
        // normal salta ~100° en un frame → el brazo “se traba” a mitad.
        dists.push(Math.max(
          angleDeg(seq[i].fwd, seq[j].fwd),
          angleDeg(seq[i].normal, seq[j].normal),
        ));
      }
    }
    if (dists.length < MIN_NEIGHBORS) continue;
    dists.sort((a, b) => a - b);
    const m = dists.length >> 1;
    const median = dists.length % 2 ? dists[m] : (dists[m - 1] + dists[m]) / 2;
    if (median > MEDIAN_THRESHOLD_DEG) bad[i] = true;
  }
  const out = seq.map((v) => (v ? { fwd: v.fwd, normal: v.normal } : null));
  for (let i = 0; i < n; i++) {
    if (!bad[i]) continue;
    let lo = i - 1; while (lo >= 0 && (bad[lo] || !seq[lo])) lo--;
    let hi = i + 1; while (hi < n && (bad[hi] || !seq[hi])) hi++;
    const a = lo >= 0 ? seq[lo] : null, b = hi < n ? seq[hi] : null;
    if (a && b) {
      out[i] = {
        fwd: vnorm([a.fwd[0]+b.fwd[0], a.fwd[1]+b.fwd[1], a.fwd[2]+b.fwd[2]]),
        normal: vnorm([a.normal[0]+b.normal[0], a.normal[1]+b.normal[1], a.normal[2]+b.normal[2]]),
      };
    } else if (a) out[i] = { fwd: a.fwd, normal: a.normal };
    else if (b) out[i] = { fwd: b.fwd, normal: b.normal };
  }
  return out;
}

// Evita que la normal de palma se “invierta” a mitad de seña (tracking).
// Si el producto punto con la referencia cae bajo 0, se refleja — en AYUDA
// la palma debe seguir mirando arriba; un flip a mitad parece un traba.
export function lockWristHemisphereSeq(seq) {
  const out = seq.map((v) => (v ? { fwd: v.fwd.slice(), normal: v.normal.slice() } : null));
  let ref = null;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    if (!ref) { ref = out[i].normal.slice(); continue; }
    const n = out[i].normal;
    if (n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0) {
      out[i].normal = [-n[0], -n[1], -n[2]];
    }
    const ln = out[i].normal;
    ref = vnorm([ref[0] * 0.75 + ln[0] * 0.25, ref[1] * 0.75 + ln[1] * 0.25, ref[2] * 0.75 + ln[2] * 0.25]);
  }
  return out;
}

// Misma idea que despikeWristSeq (mediana angular sobre ventana de vecinos)
// pero genérica para secuencias de vectores planos [x,y,z] — usada para
// wristOffset (posición, metros) y pole (dirección del codo, unitario).
// despikeWristSeq solo protegía la ORIENTACIÓN de la muñeca; posición y codo
// solo se suavizaban (smoothVecSeq/smoothVecRaw), lo que deja pasar un salto
// de 1 frame como un "brinco y asienta" en vez de rechazarlo — visible sobre
// todo en señas de dos manos MUY juntas (oclusión entre manos, ej. AYUDA),
// donde MediaPipe pierde tracking de una mano por 1-2 frames (2026-07-21,
// reportado con grabación real: "la mano izquierda salta demasiado").
// `threshold` puede ser un número fijo o `(i) => number` para umbral
// relativo por frame (ej. proporcional al largo de brazo de la persona).
export function despikeVec3Seq(seq, threshold) {
  const n = seq.length;
  const RADIUS = 3, MIN_NEIGHBORS = 3;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const bad = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!seq[i]) continue;
    const dists = [];
    for (let d = -RADIUS; d <= RADIUS; d++) {
      if (d === 0) continue;
      const j = i + d;
      if (j >= 0 && j < n && seq[j]) dists.push(dist(seq[i], seq[j]));
    }
    if (dists.length < MIN_NEIGHBORS) continue;
    dists.sort((a, b) => a - b);
    const m = dists.length >> 1;
    const median = dists.length % 2 ? dists[m] : (dists[m - 1] + dists[m]) / 2;
    const th = typeof threshold === 'function' ? threshold(i) : threshold;
    if (median > th) bad[i] = true;
  }
  const out = seq.map((v) => (v ? [...v] : null));
  for (let i = 0; i < n; i++) {
    if (!bad[i]) continue;
    let lo = i - 1; while (lo >= 0 && (bad[lo] || !seq[lo])) lo--;
    let hi = i + 1; while (hi < n && (bad[hi] || !seq[hi])) hi++;
    const a = lo >= 0 ? seq[lo] : null, b = hi < n ? seq[hi] : null;
    if (a && b) out[i] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    else if (a) out[i] = [...a];
    else if (b) out[i] = [...b];
  }
  return out;
}

// API: huesos de dedos de la seña, según brazos activos.
export function frameFingers(frame, arms = { right: true, left: true }, opts = {}) {
  let out = {};
  if (arms.right && handPresent(frame.lh)) out = { ...out, ...handToFingerBones(frame.lh, 'right', opts) };
  if (arms.left && handPresent(frame.rh)) out = { ...out, ...handToFingerBones(frame.rh, 'left', opts) };
  return out;
}

// Recorta los frames de PREPARACIÓN al inicio: donde la mano todavía va
// subiendo desde el reposo hacia la zona de la seña. Evita el "movimiento raro"
// de entrada. Si la seña ya arranca con la mano arriba, no recorta nada.
export function trimLeadIn(dataset) {
  const F = dataset.frames || [];
  if (F.length < 8) return dataset;
  const useW = hasWorld(F[Math.floor(F.length / 2)]);
  const P = (f) => (useW ? f.pose_world : f.pose);
  const yy = (f, i) => { const p = P(f); return (p && p[i]) ? p[i][1] : null; };  // y hacia abajo
  let start = 0;
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    const w = Math.min(yy(f, 15) ?? 1e9, yy(f, 16) ?? 1e9);   // muñeca más alta (menor y)
    const hip = ((yy(f, 23) ?? 0) + (yy(f, 24) ?? 0)) / 2;
    const sh = ((yy(f, 11) ?? 0) + (yy(f, 12) ?? 0)) / 2;
    if (w <= (hip + sh) / 2) { start = i; break; }   // muñeca ya en la zona alta
  }
  start = Math.min(Math.max(0, start - 2), Math.floor(F.length * 0.5));
  return start > 0 ? { ...dataset, frames: F.slice(start) } : dataset;
}

// Simétrico a trimLeadIn pero al FINAL: recorta la bajada de los brazos de
// vuelta al reposo si quedó grabada por error (ideal es soltar "S" justo
// cuando termina el gesto, sin grabar la bajada — la transición de salida ya
// la sintetiza sola, ver bakeSolver en index.html). Si la seña ya termina con
// la mano arriba (nunca "baja" dentro de los frames grabados), no recorta nada.
export function trimTrailOut(dataset) {
  const F = dataset.frames || [];
  if (F.length < 8) return dataset;
  const useW = hasWorld(F[Math.floor(F.length / 2)]);
  const P = (f) => (useW ? f.pose_world : f.pose);
  const yy = (f, i) => { const p = P(f); return (p && p[i]) ? p[i][1] : null; };
  let end = F.length;
  for (let i = F.length - 1; i >= 0; i--) {
    const f = F[i];
    const w = Math.min(yy(f, 15) ?? 1e9, yy(f, 16) ?? 1e9);
    const hip = ((yy(f, 23) ?? 0) + (yy(f, 24) ?? 0)) / 2;
    const sh = ((yy(f, 11) ?? 0) + (yy(f, 12) ?? 0)) / 2;
    if (w <= (hip + sh) / 2) { end = i + 1; break; }   // último frame con la muñeca aún arriba
  }
  end = Math.min(F.length, end + 2);                    // margen: no cortar justo en el borde
  end = Math.max(end, Math.ceil(F.length * 0.5));       // nunca recorta más de la mitad
  return end < F.length ? { ...dataset, frames: F.slice(0, end) } : dataset;
}

// Suaviza una secuencia de vectores [x,y,z] con EMA y los renormaliza. Se usa
// sobre las DIRECCIONES (brazo, antebrazo, muñeca) antes de orientar los huesos:
// suavizar la dirección evita los saltos/volteos de la muñeca (que suavizar el
// ángulo después no puede arreglar). Los huecos (null) reinician el filtro.
export function smoothVecSeq(vecs, alpha = CONFIG.dirSmooth) {
  let acc = null;
  return vecs.map((v) => {
    if (!v) { acc = null; return null; }
    if (!acc) acc = [v[0], v[1], v[2]];
    else acc = [
      acc[0] + alpha * (v[0] - acc[0]),
      acc[1] + alpha * (v[1] - acc[1]),
      acc[2] + alpha * (v[2] - acc[2]),
    ];
    const L = Math.hypot(acc[0], acc[1], acc[2]) || 1e-6;
    return [acc[0] / L, acc[1] / L, acc[2] / L];
  });
}

// ── Suavizado temporal (EMA) de los ángulos horneados ────────────────────────
export function smoothPoseSeq(poses, alpha = CONFIG.smooth) {
  if (poses.length < 2) return poses;
  const acc = {};
  return poses.map((pose) => {
    const out = {};
    for (const bone of Object.keys(pose)) {
      const v = pose[bone];
      if (!acc[bone]) acc[bone] = { x: v.x, y: v.y, z: v.z };
      else acc[bone] = {
        x: acc[bone].x + alpha * (v.x - acc[bone].x),
        y: acc[bone].y + alpha * (v.y - acc[bone].y),
        z: acc[bone].z + alpha * (v.z - acc[bone].z),
      };
      out[bone] = { ...acc[bone] };
    }
    return out;
  });
}

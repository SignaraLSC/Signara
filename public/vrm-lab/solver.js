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
  fwdGain:  2.0,   // amplifica la profundidad (MediaPipe la comprime) → las
                   // señas van HACIA ADELANTE en vez de hacia arriba
  smooth:   0.18,  // EMA anti-tembleque (más bajo = más suave)

  // ── Dedos (Fase 2) ──
  fingerGain: 1.0,   // escala del doblez de dedos (1 = ángulo real)
  fingerMax:  1.8,   // tope de doblez por articulación (radianes)
  fingerAxis: 'z',   // eje de curl en ESTE VRM (derecha +, izquierda −)
  thumbGain:  1.0,   // escala del doblez del pulgar
  thumbSign:  -1,    // el pulgar dobla con signo opuesto (según sus poses)
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
  const gain = useWorld ? 1.0 : CONFIG.fwdGain;   // con 3D real no hace falta amplificar
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

  const out = { _world: useWorld };
  if (arms.right && Rsh && Rel && Rwr) {
    out.right = {
      upper: toAvatar(norm(sub(Rel, Rsh)), axes, gain),
      lower: toAvatar(norm(sub(Rwr, Rel)), axes, gain),
    };
  }
  if (arms.left && Lsh && Lel && Lwr) {
    out.left = {
      upper: toAvatar(norm(sub(Lel, Lsh)), axes, gain),
      lower: toAvatar(norm(sub(Lwr, Lel)), axes, gain),
    };
  }
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
  let right = r >= need, left = l >= need;
  if (!right && !left) { right = true; left = true; }
  return { right, left };
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
  out.Thumb = [angBetween(t1, t2), angBetween(t2, t3)];  // MCP, IP
  return out;
}

function handPresent(h) {
  return Array.isArray(h) && h.length === 21 &&
    h.some((p) => Array.isArray(p) && (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2] ?? 0)) > 1e-3);
}

// Huesos de dedos de UN lado a partir de su mano. side: 'right' | 'left'.
function handToFingerBones(hand, side) {
  const sign = side === 'right' ? 1 : -1;   // curl: derecha +, izquierda −
  const ax = CONFIG.fingerAxis;
  const G = CONFIG.fingerGain, M = CONFIG.fingerMax;
  const set = (v) => Math.max(-M, Math.min(M, v));
  const curls = fingerCurls(hand);
  const bones = {};
  const put = (name, val) => { bones[name] = { x: 0, y: 0, z: 0, [ax]: set(val) }; };

  for (const f of Object.keys(FINGERS)) {
    const [p, i, d] = curls[f];
    put(`${side}${f}Proximal`,     sign * p * G);
    put(`${side}${f}Intermediate`, sign * i * G);
    put(`${side}${f}Distal`,       sign * d * G);
  }
  const [tp, ti] = curls.Thumb;
  const tsign = sign * CONFIG.thumbSign, TG = CONFIG.thumbGain;
  put(`${side}ThumbProximal`, tsign * tp * TG);
  put(`${side}ThumbDistal`,   tsign * ti * TG);
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

// API: huesos de dedos de la seña, según brazos activos.
export function frameFingers(frame, arms = { right: true, left: true }) {
  let out = {};
  if (arms.right && handPresent(frame.lh)) out = { ...out, ...handToFingerBones(frame.lh, 'right') };
  if (arms.left && handPresent(frame.rh)) out = { ...out, ...handToFingerBones(frame.rh, 'left') };
  return out;
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

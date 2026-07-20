/**
 * ============================================================
 *  animations.js — Librería LSC (Lengua de Señas Colombiana)
 *  Versión VRM · @pixiv/three-vrm@2 + Kalidokit
 * ============================================================
 *
 *  API de huesos VRM (normalizedBoneNode):
 *    vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
 *
 *  Ejes VRM en T-pose (brazo derecho apunta en +X):
 *    rightUpperArm.z  → elevación  (+1.4 = colgante, 0 = T-pose, -1.0 = arriba)
 *    rightUpperArm.x  → frente/atrás (+0.5 = adelante, -0.5 = atrás)
 *    rightLowerArm.x  → codo (0 = recto, -1.3 = 90°, -2.2 = máximo)
 *    dedos.z (derecha) → ± (positivo = cerrarse hacia palma)
 *    dedos.z (izquierda) → ∓ (negativo = cerrarse hacia palma)
 *
 *  Todas las poses son ABSOLUTAS desde T-pose (0,0,0).
 *  Para ajustar valores: usa window.vb('boneName', x, y, z) en consola.
 * ============================================================
 */

// ─── Utilidades ───────────────────────────────────────────────────────────────
function getBone(vrm, name) {
    return vrm.humanoid.getNormalizedBoneNode(name) ?? null;
}

function applyPose(vrm, pose) {
    for (const [name, rot] of Object.entries(pose)) {
        const b = getBone(vrm, name);
        if (!b) continue;
        if (rot.x !== undefined) b.rotation.x = rot.x;
        if (rot.y !== undefined) b.rotation.y = rot.y;
        if (rot.z !== undefined) b.rotation.z = rot.z;
    }
}

function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
function lerp(a, b, t) { return a + (b - a) * t; }

function lerpPoses(from, to, t) {
    const result = {};
    for (const bone of new Set([...Object.keys(from), ...Object.keys(to)])) {
        const a = from[bone] ?? { x:0, y:0, z:0 };
        const b = to[bone]   ?? from[bone] ?? { x:0, y:0, z:0 };
        result[bone] = { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), z: lerp(a.z,b.z,t) };
    }
    return result;
}

function readCurrentPose(vrm, boneNames) {
    const pose = {};
    for (const name of boneNames) {
        const b = getBone(vrm, name);
        if (b) pose[name] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
    }
    return pose;
}

// ─── Pose relajada de referencia (brazos colgando) ────────────────────────────
// Se usa como punto de retorno al terminar cada animación.
const VRM_IDLE = {
    rightUpperArm: { x: 0,    y: 0, z:  1.4 },
    rightLowerArm: { x: 0,    y: 0, z:  0   },
    rightHand:     { x: 0,    y: 0, z:  0   },
    leftUpperArm:  { x: 0,    y: 0, z: -1.4 },
    leftLowerArm:  { x: 0,    y: 0, z:  0   },
    leftHand:      { x: 0,    y: 0, z:  0   },
    head:          { x: 0,    y: 0, z:  0   },
};

// ─── Volver a pose relajada ───────────────────────────────────────────────────
export function returnToIdleVrm(vrm, onDone) {
    const start  = performance.now();
    const dur    = 480;
    const bones  = Object.keys(VRM_IDLE);
    const from   = readCurrentPose(vrm, bones);
    function step(now) {
        const t = easeInOut(Math.min((now - start) / dur, 1));
        applyPose(vrm, lerpPoses(from, VRM_IDLE, t));
        if (t < 1) requestAnimationFrame(step);
        else { applyPose(vrm, VRM_IDLE); onDone?.(); }
    }
    requestAnimationFrame(step);
}

export function setIdlePose(vrm) { applyPose(vrm, VRM_IDLE); }

// ─── Motor de keyframes ───────────────────────────────────────────────────────
export function playKeyframes(vrm, keyframes, onDone) {
    let frameIdx  = 0;
    let startTime = null;
    let rafId     = null;
    let cancelled = false;

    // Leer pose actual como punto de partida
    const allBones = [...new Set(keyframes.flatMap(kf => Object.keys(kf.pose)))];
    let fromPose = readCurrentPose(vrm, allBones);

    function step(now) {
        if (cancelled) return;
        if (!startTime) startTime = now;
        const kf = keyframes[frameIdx];
        const t  = easeInOut(Math.min((now - startTime) / kf.duration, 1));
        applyPose(vrm, lerpPoses(fromPose, kf.pose, t));
        if (t < 1) {
            rafId = requestAnimationFrame(step);
        } else {
            applyPose(vrm, kf.pose);
            fromPose  = { ...kf.pose };
            startTime = null;
            frameIdx++;
            if (frameIdx < keyframes.length) rafId = requestAnimationFrame(step);
            else returnToIdleVrm(vrm, () => { if (!cancelled) onDone?.(); });
        }
    }
    rafId = requestAnimationFrame(step);
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
}

// ─── POSES DE DEDOS (VRM) ─────────────────────────────────────────────────────
// VRM + Kalidokit: curl del dedo en rotación Z.
//   Mano DERECHA: z positivo  = dedo se cierra hacia la palma
//   Mano IZQUIERDA: z negativo = dedo se cierra hacia la palma
// (espejo del sistema Kalidokit HandSolver)
//
// Ajustar con: vb('rightIndexProximal', 0, 0, 1.2) en consola

const RF = 1.4;    // right curl fuerte
const RT = 0.7;    // right curl suave (distal / pulgar)
const LF = -1.4;   // left curl fuerte
const LT = -0.7;   // left curl suave

// Mano derecha abierta
const R_OPEN = {
    rightIndexProximal:    { x:0, y: 0.12, z: 0    },
    rightIndexIntermediate:{ x:0, y: 0,    z: 0    },
    rightIndexDistal:      { x:0, y: 0,    z: 0    },
    rightMiddleProximal:   { x:0, y: 0,    z: 0    },
    rightMiddleIntermediate:{ x:0, y: 0,   z: 0    },
    rightMiddleDistal:     { x:0, y: 0,    z: 0    },
    rightRingProximal:     { x:0, y: 0,    z: 0    },
    rightRingIntermediate: { x:0, y: 0,    z: 0    },
    rightRingDistal:       { x:0, y: 0,    z: 0    },
    rightLittleProximal:   { x:0, y:-0.12, z: 0    },
    rightLittleIntermediate:{ x:0, y: 0,   z: 0    },
    rightLittleDistal:     { x:0, y: 0,    z: 0    },
    rightThumbProximal:    { x:-0.4, y: 0.26, z:-0.3 },
    rightThumbIntermediate:{ x:0,    y: 0,    z: 0   },
    rightThumbDistal:      { x:0,    y: 0,    z: 0   },
};

// Puño derecho cerrado
const R_FIST = {
    rightIndexProximal:    { x:0, y:0, z: RF   },
    rightIndexIntermediate:{ x:0, y:0, z: RF   },
    rightIndexDistal:      { x:0, y:0, z: RT   },
    rightMiddleProximal:   { x:0, y:0, z: RF   },
    rightMiddleIntermediate:{ x:0, y:0, z: RF  },
    rightMiddleDistal:     { x:0, y:0, z: RT   },
    rightRingProximal:     { x:0, y:0, z: RF   },
    rightRingIntermediate: { x:0, y:0, z: RF   },
    rightRingDistal:       { x:0, y:0, z: RT   },
    rightLittleProximal:   { x:0, y:0, z: RF   },
    rightLittleIntermediate:{ x:0, y:0, z: RF  },
    rightLittleDistal:     { x:0, y:0, z: RT   },
    rightThumbProximal:    { x:0, y: 0.2, z:-0.55 },
    rightThumbIntermediate:{ x:0, y: 0,   z:-0.3  },
    rightThumbDistal:      { x:0, y: 0,   z:-0.2  },
};

// Solo índice extendido (señalar)
const R_POINT = {
    ...R_FIST,
    rightIndexProximal:    { x:0, y: 0.08, z: 0 },
    rightIndexIntermediate:{ x:0, y: 0,    z: 0 },
    rightIndexDistal:      { x:0, y: 0,    z: 0 },
};

// Pulgar arriba
const R_THUMB_UP = {
    ...R_FIST,
    rightThumbProximal:    { x:-0.4, y: 0.26, z:-0.3 },
    rightThumbIntermediate:{ x:0,    y: 0,    z: 0   },
    rightThumbDistal:      { x:0,    y: 0,    z: 0   },
};

// Signo V (índice + corazón)
const R_V = {
    ...R_FIST,
    rightIndexProximal:    { x:0, y: 0.18, z: 0 },
    rightIndexIntermediate:{ x:0, y: 0,    z: 0 },
    rightIndexDistal:      { x:0, y: 0,    z: 0 },
    rightMiddleProximal:   { x:0, y:-0.18, z: 0 },
    rightMiddleIntermediate:{ x:0, y: 0,   z: 0 },
    rightMiddleDistal:     { x:0, y: 0,    z: 0 },
};

// Mano plana (para GRACIAS)
const R_FLAT = {
    rightIndexProximal:    { x:0, y: 0.06, z: 0.55 },
    rightIndexIntermediate:{ x:0, y: 0,    z: 0.30 },
    rightIndexDistal:      { x:0, y: 0,    z: 0.12 },
    rightMiddleProximal:   { x:0, y: 0,    z: 0.55 },
    rightMiddleIntermediate:{ x:0, y: 0,   z: 0.30 },
    rightMiddleDistal:     { x:0, y: 0,    z: 0.12 },
    rightRingProximal:     { x:0, y: 0,    z: 0.55 },
    rightRingIntermediate: { x:0, y: 0,    z: 0.30 },
    rightRingDistal:       { x:0, y: 0,    z: 0.12 },
    rightLittleProximal:   { x:0, y:-0.06, z: 0.55 },
    rightLittleIntermediate:{ x:0, y: 0,   z: 0.30 },
    rightLittleDistal:     { x:0, y: 0,    z: 0.12 },
    rightThumbProximal:    { x:-0.2, y: 0.13, z:-0.16 },
    rightThumbIntermediate:{ x:0,    y: 0,    z: 0    },
    rightThumbDistal:      { x:0,    y: 0,    z: 0    },
};

// ─── POSES DE MANO IZQUIERDA ──────────────────────────────────────────────────
const L_OPEN = {
    leftIndexProximal:    { x:0, y:-0.12, z: 0 },
    leftIndexIntermediate:{ x:0, y: 0,    z: 0 },
    leftIndexDistal:      { x:0, y: 0,    z: 0 },
    leftMiddleProximal:   { x:0, y: 0,    z: 0 },
    leftMiddleIntermediate:{ x:0, y: 0,   z: 0 },
    leftMiddleDistal:     { x:0, y: 0,    z: 0 },
    leftRingProximal:     { x:0, y: 0,    z: 0 },
    leftRingIntermediate: { x:0, y: 0,    z: 0 },
    leftRingDistal:       { x:0, y: 0,    z: 0 },
    leftLittleProximal:   { x:0, y: 0.12, z: 0 },
    leftLittleIntermediate:{ x:0, y: 0,   z: 0 },
    leftLittleDistal:     { x:0, y: 0,    z: 0 },
    leftThumbProximal:    { x:0.4, y:-0.26, z: 0.3 },
    leftThumbIntermediate:{ x:0,   y: 0,    z: 0   },
    leftThumbDistal:      { x:0,   y: 0,    z: 0   },
};

const L_FIST = {
    leftIndexProximal:    { x:0, y:0, z: LF },
    leftIndexIntermediate:{ x:0, y:0, z: LF },
    leftIndexDistal:      { x:0, y:0, z: LT },
    leftMiddleProximal:   { x:0, y:0, z: LF },
    leftMiddleIntermediate:{ x:0, y:0, z: LF },
    leftMiddleDistal:     { x:0, y:0, z: LT },
    leftRingProximal:     { x:0, y:0, z: LF },
    leftRingIntermediate: { x:0, y:0, z: LF },
    leftRingDistal:       { x:0, y:0, z: LT },
    leftLittleProximal:   { x:0, y:0, z: LF },
    leftLittleIntermediate:{ x:0, y:0, z: LF },
    leftLittleDistal:     { x:0, y:0, z: LT },
    leftThumbProximal:    { x:0, y:-0.2, z: 0.55 },
    leftThumbIntermediate:{ x:0, y: 0,   z: 0.3  },
    leftThumbDistal:      { x:0, y: 0,   z: 0.2  },
};

// ─── POSICIONES DE BRAZO (VRM) ────────────────────────────────────────────────
// rightUpperArm: z = elevación (1.4=colgante, 0=T-pose horizontal, -1.0=muy arriba)
//                x = frente (+) / atrás (-)
// rightLowerArm: x = codo (0=recto, -1.3=~90°, -2.2=máximo)
// rightHand:     x = flexión muñeca (nod), y = giro muñeca

const R_ARM_WAVE  = { rightUpperArm:{x: 0.4, y:0, z:-0.7}, rightLowerArm:{x:-0.3,  y:0, z:0} };
const R_ARM_CHIN  = { rightUpperArm:{x: 0.5, y:0, z: 0.2}, rightLowerArm:{x:-1.0,  y:0, z:0} };
const R_ARM_EXT   = { rightUpperArm:{x: 0.4, y:0, z:-0.3}, rightLowerArm:{x:-0.3,  y:0, z:0} };
const R_ARM_CHEST = { rightUpperArm:{x: 0.4, y:0, z: 0.5}, rightLowerArm:{x:-0.9,  y:0, z:0} };
const R_ARM_MID   = { rightUpperArm:{x: 0.4, y:0, z:-0.2}, rightLowerArm:{x:-0.55, y:0, z:0} };
const R_ARM_CHEST2= { rightUpperArm:{x: 0.4, y:0, z: 0.4}, rightLowerArm:{x:-0.95, y:0, z:0} };

// Izquierdo: z espejado (negativo = arriba, positivo = colgante)
const L_ARM_PLAT = { leftUpperArm:{x: 0.5, y:0, z:-0.7}, leftLowerArm:{x:-0.55, y:0, z:0}, leftHand:{x:0, y:-0.35, z:0} };
const L_ARM_SIDE = { leftUpperArm:{x: 0.4, y:0, z:-0.5}, leftLowerArm:{x:-0.5,  y:0, z:0}, leftHand:{x:0, y:-0.2,  z:0} };

// ─── ANIMACIONES LSC ──────────────────────────────────────────────────────────

// HOLA — mano abierta, vaivén de muñeca
export const ANIM_HOLA = [
    { duration:350, pose:{ ...R_ARM_WAVE, rightHand:{x:0, y: 0,    z:0}, ...R_OPEN }},
    { duration:220, pose:{ ...R_ARM_WAVE, rightHand:{x:0, y: 0.45, z:0}, ...R_OPEN }},
    { duration:220, pose:{ ...R_ARM_WAVE, rightHand:{x:0, y:-0.45, z:0}, ...R_OPEN }},
    { duration:220, pose:{ ...R_ARM_WAVE, rightHand:{x:0, y: 0.45, z:0}, ...R_OPEN }},
    { duration:220, pose:{ ...R_ARM_WAVE, rightHand:{x:0, y:-0.45, z:0}, ...R_OPEN }},
    { duration:220, pose:{ ...R_ARM_WAVE, rightHand:{x:0, y: 0,    z:0}, ...R_OPEN }},
];

// HOLA MEJORADA (demo camino "a mano"): brazo arriba con CODO DOBLADO ~90°
// (rightLowerArm.x = -1.5) y la mano a la altura de la cabeza, saludando de
// lado a lado con la muñeca. Sube desde el reposo y baja al terminar, en vez
// del brazo tieso estirado al costado.
const R_ARM_HELLO = { rightUpperArm:{x: 0.15, y:0, z:-0.95}, rightLowerArm:{x:-1.5, y:0, z:0} };
export const ANIM_HOLA_MEJOR = [
    { duration:300, pose:{ ...R_ARM_HELLO, rightHand:{x:0, y:0, z: 0.0 }, ...R_OPEN }},
    { duration:200, pose:{ ...R_ARM_HELLO, rightHand:{x:0, y:0, z: 0.45}, ...R_OPEN }},
    { duration:200, pose:{ ...R_ARM_HELLO, rightHand:{x:0, y:0, z:-0.45}, ...R_OPEN }},
    { duration:200, pose:{ ...R_ARM_HELLO, rightHand:{x:0, y:0, z: 0.45}, ...R_OPEN }},
    { duration:200, pose:{ ...R_ARM_HELLO, rightHand:{x:0, y:0, z:-0.45}, ...R_OPEN }},
    { duration:250, pose:{ ...R_ARM_HELLO, rightHand:{x:0, y:0, z: 0.0 }, ...R_OPEN }},
];

// GRACIAS — mano plana toca barbilla, se extiende al frente
export const ANIM_GRACIAS = [
    { duration:420, pose:{ ...R_ARM_CHIN, rightHand:{x:-0.3, y:0, z:0}, ...R_FLAT }},
    { duration:300, pose:{ ...R_ARM_CHIN, rightHand:{x:-0.2, y:0, z:0}, ...R_FLAT }},
    { duration:480, pose:{ ...R_ARM_EXT,  rightHand:{x: 0.2, y:0, z:0}, ...R_OPEN }},
];

// SÍ — puño al pecho; la cabeza asiente 3 veces en X (fluido vía easeInOut).
const SI_HOLD = { ...R_ARM_CHEST, rightHand:{x: 0, y: 0, z: 0}, ...R_FIST };
const HEAD_NOD = 0.38;
export const ANIM_SI = [
    { duration:260, pose:{ ...SI_HOLD, head:{ x:  HEAD_NOD, y: 0, z: 0 } } },
    { duration:260, pose:{ ...SI_HOLD, head:{ x: -HEAD_NOD, y: 0, z: 0 } } },
    { duration:260, pose:{ ...SI_HOLD, head:{ x:  HEAD_NOD, y: 0, z: 0 } } },
    { duration:260, pose:{ ...SI_HOLD, head:{ x: -HEAD_NOD, y: 0, z: 0 } } },
    { duration:260, pose:{ ...SI_HOLD, head:{ x:  HEAD_NOD, y: 0, z: 0 } } },
    { duration:260, pose:{ ...SI_HOLD, head:{ x: -HEAD_NOD, y: 0, z: 0 } } },
    { duration:220, pose:{ ...SI_HOLD, head:{ x:  0,        y: 0, z: 0 } } },
];

// NO — índice quieto; la cabeza niega 3 veces en Y (lado a lado).
const NO_HOLD = { ...R_ARM_MID, rightHand:{x: 0, y: 0, z: 0}, ...R_POINT };
const HEAD_SHAKE = 0.42;
export const ANIM_NO = [
    { duration:260, pose:{ ...NO_HOLD, head:{ x: 0, y:  HEAD_SHAKE, z: 0 } } },
    { duration:260, pose:{ ...NO_HOLD, head:{ x: 0, y: -HEAD_SHAKE, z: 0 } } },
    { duration:260, pose:{ ...NO_HOLD, head:{ x: 0, y:  HEAD_SHAKE, z: 0 } } },
    { duration:260, pose:{ ...NO_HOLD, head:{ x: 0, y: -HEAD_SHAKE, z: 0 } } },
    { duration:260, pose:{ ...NO_HOLD, head:{ x: 0, y:  HEAD_SHAKE, z: 0 } } },
    { duration:260, pose:{ ...NO_HOLD, head:{ x: 0, y: -HEAD_SHAKE, z: 0 } } },
    { duration:220, pose:{ ...NO_HOLD, head:{ x: 0, y:  0,          z: 0 } } },
];

// BIEN — pulgar arriba
export const ANIM_BIEN = [
    { duration:380, pose:{ ...R_ARM_MID, rightHand:{x:0.15, y:0, z:0}, ...R_THUMB_UP }},
    { duration:320, pose:{ ...R_ARM_EXT, rightHand:{x:0.15, y:0, z:0}, ...R_THUMB_UP }},
    { duration:260, pose:{ ...R_ARM_MID, rightHand:{x:0.15, y:0, z:0}, ...R_THUMB_UP }},
];

// POR FAVOR — mano abierta hace círculo en el pecho
export const ANIM_POR_FAVOR = [
    { duration:320, pose:{ ...R_ARM_CHEST2, rightHand:{x:-0.3, y: 0.3, z:0}, ...R_OPEN }},
    { duration:380, pose:{ ...R_ARM_CHEST2, rightHand:{x:-0.3, y:-0.3, z:0}, ...R_OPEN }},
    { duration:380, pose:{ ...R_ARM_CHEST2, rightHand:{x:-0.3, y: 0.0, z:0}, ...R_OPEN }},
    { duration:320, pose:{ ...R_ARM_CHEST2, rightHand:{x:-0.3, y: 0.3, z:0}, ...R_OPEN }},
];

// AMOR — puño pulsa en el pecho
const R_ARM_AMOR_HI = { rightUpperArm:{x:0.4, y:0, z:0.5}, rightLowerArm:{x:-1.0, y:0, z:0} };
export const ANIM_AMOR = [
    { duration:360, pose:{ ...R_ARM_CHEST2, rightHand:{x:0, y:0, z:0}, ...R_FIST }},
    { duration:280, pose:{ ...R_ARM_AMOR_HI, rightHand:{x:0, y:0, z:0}, ...R_FIST }},
    { duration:280, pose:{ ...R_ARM_CHEST2, rightHand:{x:0, y:0, z:0}, ...R_FIST }},
    { duration:280, pose:{ ...R_ARM_AMOR_HI, rightHand:{x:0, y:0, z:0}, ...R_FIST }},
];

// AYUDA — mano izq plana = plataforma, puño der sube sobre ella
const R_ARM_AYUDA = { rightUpperArm:{x:0.4, y:0, z:-0.3}, rightLowerArm:{x:-0.9, y:0, z:0} };
export const ANIM_AYUDA = [
    { duration:400, pose:{ ...L_ARM_PLAT, ...L_OPEN, ...R_ARM_CHEST,  rightHand:{x:0, y:0, z:0}, ...R_FIST }},
    { duration:380, pose:{ ...L_ARM_PLAT, ...L_OPEN, ...R_ARM_AYUDA,  rightHand:{x:0, y:0, z:0}, ...R_FIST }},
    { duration:380, pose:{ ...L_ARM_PLAT, ...L_OPEN, ...R_ARM_CHEST,  rightHand:{x:0, y:0, z:0}, ...R_FIST }},
    { duration:380, pose:{ ...L_ARM_PLAT, ...L_OPEN, ...R_ARM_AYUDA,  rightHand:{x:0, y:0, z:0}, ...R_FIST }},
];

// NOMBRE — signo V toca dos veces la mano izq
const R_ARM_NOM1 = { rightUpperArm:{x:0.4, y:0, z:-0.2}, rightLowerArm:{x:-0.6,  y:0, z:0} };
const R_ARM_NOM2 = { rightUpperArm:{x:0.4, y:0, z:-0.2}, rightLowerArm:{x:-0.65, y:0, z:0} };
export const ANIM_NOMBRE = [
    { duration:360, pose:{ ...L_ARM_SIDE, ...L_OPEN, ...R_ARM_NOM1, rightHand:{x:0, y:0.3, z:0}, ...R_V }},
    { duration:220, pose:{ ...L_ARM_SIDE, ...L_OPEN, ...R_ARM_NOM2, rightHand:{x:0, y:0.3, z:0}, ...R_V }},
    { duration:220, pose:{ ...L_ARM_SIDE, ...L_OPEN, ...R_ARM_NOM1, rightHand:{x:0, y:0.3, z:0}, ...R_V }},
    { duration:220, pose:{ ...L_ARM_SIDE, ...L_OPEN, ...R_ARM_NOM2, rightHand:{x:0, y:0.3, z:0}, ...R_V }},
];

// ─── DICCIONARIO ──────────────────────────────────────────────────────────────
export const LSC_DICTIONARY = {
    'hola':      ANIM_HOLA,
    'hola2':     ANIM_HOLA_MEJOR,
    'gracias':   ANIM_GRACIAS,
    'sí':        ANIM_SI,
    'si':        ANIM_SI,
    'no':        ANIM_NO,
    'bien':      ANIM_BIEN,
    'por favor': ANIM_POR_FAVOR,
    'amor':      ANIM_AMOR,
    'ayuda':     ANIM_AYUDA,
    'nombre':    ANIM_NOMBRE,
};

/** Señas grabadas como landmarks MediaPipe (archivos JSON en la raíz). */
export const LSC_DATASETS = {
    'como estas':  'COMO_ESTAS.json',
    'cómo estás':  'COMO_ESTAS.json',
};

export function allLSCWords() {
    return [...Object.keys(LSC_DICTIONARY), ...Object.keys(LSC_DATASETS)];
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────
let _cancelCurrent = null;

export function translateToLSC(vrm, phrase, onDone) {
    const key = phrase.trim().toLowerCase();

    const datasetFile = LSC_DATASETS[key];
    if (datasetFile) {
        _cancelCurrent?.();
        import('./datasetPlayer.js?v=22').then(({ playDatasetFile }) => {
            playDatasetFile(vrm, datasetFile, () => {
                _cancelCurrent = null;
                onDone?.();
            }).then(cancel => { _cancelCurrent = cancel; })
              .catch(err => {
                  console.error('Error reproduciendo dataset:', err);
                  onDone?.();
              });
        });
        return;
    }

    const anim = LSC_DICTIONARY[key];
    if (!anim) {
        console.warn(`Sin animación LSC para: "${phrase}". Disponibles: ${allLSCWords().join(', ')}`);
        onDone?.(); return;
    }
    _cancelCurrent?.();
    _cancelCurrent = playKeyframes(vrm, anim, () => { _cancelCurrent = null; onDone?.(); });
}

export function translateSentence(vrm, text, onDone) {
    const normalized = text.trim().toLowerCase();
    const tokens = [];
    let remaining = normalized;

    while (remaining.length > 0) {
        remaining = remaining.trimStart();
        if (!remaining) break;
        let matched = null;
        for (const key of allLSCWords().sort((a,b) => b.length - a.length)) {
            if (remaining.startsWith(key)) { matched = key; break; }
        }
        if (matched) {
            tokens.push(matched);
            remaining = remaining.slice(matched.length);
        } else {
            const word = remaining.split(/\s+/)[0];
            tokens.push(word);
            remaining = remaining.slice(word.length);
        }
    }

    let i = 0;
    function next() {
        if (i < tokens.length) translateToLSC(vrm, tokens[i++], next);
        else onDone?.();
    }
    next();
}

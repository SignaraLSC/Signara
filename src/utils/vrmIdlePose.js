/**
 * vrmIdlePose.js — pose de reposo del avatar VRM (brazos colgando), portada de
 * public/vrm-lab/animations.js. Solo se porta setIdlePose/VRM_IDLE — el resto
 * de ese archivo (translateToLSC, playKeyframes) es el diccionario de poses
 * "hechas a mano" de la sección A del laboratorio, no se usa en producción.
 */

function getBone(vrm, name) {
  return vrm.humanoid.getNormalizedBoneNode(name) ?? null
}

function applyPose(vrm, pose) {
  for (const [name, rot] of Object.entries(pose)) {
    const b = getBone(vrm, name)
    if (!b) continue
    if (rot.x !== undefined) b.rotation.x = rot.x
    if (rot.y !== undefined) b.rotation.y = rot.y
    if (rot.z !== undefined) b.rotation.z = rot.z
  }
}

// Curva natural de dedos en reposo — MISMA convención que restFingers en
// vrmBaker.js (REST_CURL=0.35), para que la mano se vea igual de relajada
// acá (avatar recién cargado / vrmBaker.js (mano inactiva durante una seña
// de una sola mano). Antes esta pose no tocaba los dedos — como la mano
// "en reposo real" (no usada en la última seña) se congela con
// frozenFingerRest, y ESE sí quedaba en NEUTRAL (dedos totalmente rectos),
// una mano quedaba relajada y la otra "estirada". Ver fix gemelo en
// vrmBaker.js:frozenFingerRest.
const REST_CURL = 0.35
function restFingerPose(side) {
  const g = side === 'right' ? 1 : -1
  const out = {}
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
    out[`${side}${f}Proximal`] = { x: 0, y: 0, z: g * REST_CURL }
    out[`${side}${f}Intermediate`] = { x: 0, y: 0, z: g * REST_CURL }
    out[`${side}${f}Distal`] = { x: 0, y: 0, z: g * REST_CURL * 0.6 }
  }
  return out
}

// Pose relajada de referencia (brazos colgando) — punto de partida/retorno de
// cada seña (bakeSolver sintetiza la transición reposo↔seña contra esta pose).
const VRM_IDLE = {
  rightUpperArm: { x: 0, y: 0, z: 1.4 },
  rightLowerArm: { x: 0, y: 0, z: 0 },
  rightHand: { x: 0, y: 0, z: 0 },
  leftUpperArm: { x: 0, y: 0, z: -1.4 },
  leftLowerArm: { x: 0, y: 0, z: 0 },
  leftHand: { x: 0, y: 0, z: 0 },
  head: { x: 0, y: 0, z: 0 },
  spine: { x: 0, y: 0, z: 0 },
  chest: { x: 0, y: 0, z: 0 },
  ...restFingerPose('right'),
  ...restFingerPose('left'),
}

const EXPR_NAMES = ['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'surprised', 'angry', 'sad']

export function setIdlePose(vrm) {
  applyPose(vrm, VRM_IDLE)
  // Reposo también en la cara: boca cerrada, sin parpadeo forzado — evita
  // que quede "pegada" una expresión de la última seña reproducida.
  if (vrm.expressionManager) {
    EXPR_NAMES.forEach((n) => vrm.expressionManager.setValue(n, 0))
  }
}

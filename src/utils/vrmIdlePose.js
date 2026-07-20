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
}

export function setIdlePose(vrm) {
  applyPose(vrm, VRM_IDLE)
}

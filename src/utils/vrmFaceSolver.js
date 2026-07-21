/**
 * vrmFaceSolver.js — landmarks de cara grabados (00_capture.py, campo
 * `frame.face`) → pesos de expresión VRM (boca: aa/ih/ou/ee/oh · ojos: blink).
 *
 * El avatar (public/avatar/signara-avatar.vrm) es VRM 1.0 y expone estos 6
 * "preset expressions" vía expressionManager (confirmado leyendo
 * extensions.VRMC_vrm.expressions.preset del propio archivo .vrm) — no hay
 * blendshapes personalizados, así que el mapeo va directo a estos nombres.
 *
 * Orden EXACTO del array `frame.face` (124 puntos) — debe calzar siempre con
 * FACE_KEEP de sign_ai/00_capture.py, que lo arma así:
 *   óvalo(36) · ojo der(16) · ojo izq(16) · ceja der(5) · ceja izq(5) ·
 *   labios ext(20) · labios int(20) · nariz(6)  =  124 puntos
 * Si algún día cambia FACE_KEEP en 00_capture.py, estos offsets hay que
 * actualizarlos igual.
 */

// ── Offsets de cada segmento dentro del array de 124 puntos ────────────────
const OVAL = 0        // 36 puntos (no usado todavía)
const R_EYE = 36       // 16 puntos
const L_EYE = 52       // 16 puntos
// R_BROW = 68 (5), L_BROW = 73 (5) — no usados todavía (cejas)
const LIPS_O = 78      // 20 puntos — orden: FACE_LIPS_O en 00_capture.py
const LIPS_I = 98      // 20 puntos — orden: FACE_LIPS_I en 00_capture.py

// Puntos concretos dentro de cada segmento (posición en el array recortado,
// no el índice original de MediaPipe — ver comentario de cada FACE_LIPS_*/
// FACE_*_EYE en 00_capture.py para el orden exacto de cada lista).
const LIP_O_LEFT = LIPS_O + 0     // landmark 61  — comisura externa izquierda
const LIP_O_RIGHT = LIPS_O + 10    // landmark 291 — comisura externa derecha
const LIP_I_TOP = LIPS_I + 15    // landmark 13  — centro labio interno superior
const LIP_I_BOTTOM = LIPS_I + 5     // landmark 14  — centro labio interno inferior

const EYE_R_OUTER = R_EYE + 0      // landmark 33  — comisura externa ojo der
const EYE_R_INNER = R_EYE + 8      // landmark 133 — comisura interna ojo der
const EYE_R_TOP = R_EYE + 12     // landmark 159 — párpado superior ojo der
const EYE_R_BOTTOM = R_EYE + 4      // landmark 145 — párpado inferior ojo der
const EYE_L_OUTER = L_EYE + 0      // landmark 263 — comisura externa ojo izq
const EYE_L_INNER = L_EYE + 8      // landmark 362 — comisura interna ojo izq
const EYE_L_TOP = L_EYE + 12     // landmark 386 — párpado superior ojo izq
const EYE_L_BOTTOM = L_EYE + 4      // landmark 374 — párpado inferior ojo izq

export const FACE_CONFIG = {
  // ── Boca ──
  // Aperture/ancho son RATIOS respecto a la distancia interocular (estable,
  // no cambia al abrir la boca — a diferencia del ancho de la mandíbula).
  // "neutral" = valor típico de una boca cerrada/relajada; por debajo de eso
  // no se activa ningún visema. Calibrado sobre GRACIAS/POR_FAVOR (las
  // primeras tomas con movimiento real de boca) — recalibrar con más datos.
  neutralOpen: 0.06,
  openGain: 3.2,       // aperture ratio → intensidad 0..1 de "boca abierta"
  neutralWidth: 0.62,
  widthGain: 3.0,       // desviación de ancho → intensidad 0..1 de "labios estirados/redondeados"

  // ── Parpadeo (EAR — Eye Aspect Ratio) ──
  // ratio alto = ojo abierto, ratio bajo = ojo cerrado.
  eyeOpenEAR: 0.30,     // EAR típico con el ojo bien abierto
  eyeClosedEAR: 0.12,     // EAR con el ojo cerrado

  smooth: 0.35,       // EMA sobre los 6 canales (evita parpadeo/temblor visual)
}

const NEUTRAL_EXPR = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, blink: 0 }

function dist(a, b) {
  if (!a || !b) return null
  return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0))
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function present(p) {
  return Array.isArray(p) && (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2] ?? 0)) > 1e-4
}

// Eye Aspect Ratio de un ojo: qué tan abierto está, normalizado por su
// propio ancho (comisura a comisura) — así sirve igual de cerca o de lejos.
function eyeAspectRatio(face, topIdx, bottomIdx, outerIdx, innerIdx) {
  const top = face[topIdx], bottom = face[bottomIdx]
  const outer = face[outerIdx], inner = face[innerIdx]
  if (!present(top) || !present(bottom) || !present(outer) || !present(inner)) return null
  const width = dist(outer, inner) || 1e-6
  return dist(top, bottom) / width
}

/**
 * Un frame de `dataset.frames` (con su `face`, 124 puntos) → pesos crudos
 * {aa, ih, ou, ee, oh, blink} en 0..1, o null si no hay cara detectada en
 * ese frame (oclusión, fuera de encuadre, grabación vieja sin `face`).
 */
export function frameFaceExpr(frame) {
  const face = frame.face
  if (!Array.isArray(face) || face.length < 124) return null

  const oLeft = face[LIP_O_LEFT], oRight = face[LIP_O_RIGHT]
  const iTop = face[LIP_I_TOP], iBottom = face[LIP_I_BOTTOM]
  const eyeROuter = face[EYE_R_OUTER], eyeLOuter = face[EYE_L_OUTER]
  if (!present(oLeft) || !present(oRight) || !present(iTop) || !present(iBottom) ||
    !present(eyeROuter) || !present(eyeLOuter)) return null

  // Distancia interocular: referencia de escala estable (no varía al hablar).
  const interocular = dist(eyeROuter, eyeLOuter) || 1e-6

  const openRatio = dist(iTop, iBottom) / interocular
  const widthRatio = dist(oLeft, oRight) / interocular

  const C = FACE_CONFIG
  const openness = clamp01((openRatio - C.neutralOpen) * C.openGain)
  const wideness = clamp01((widthRatio - C.neutralWidth) * C.widthGain) -
    clamp01((C.neutralWidth - widthRatio) * C.widthGain) // -1..1: + ancha (sonrisa) / − angosta (redonda)

  // Heurística v1 (documentada, a recalibrar con grabaciones que sí muevan
  // la boca a propósito): combina apertura vertical + ancho horizontal para
  // repartir entre los 5 visemas. No es un modelo entrenado, es geometría
  // directa — funciona mejor cuanto más exagerado el gesto de boca grabado.
  const wide = Math.max(0, wideness)
  const round = Math.max(0, -wideness)
  const aa = openness * (1 - wide * 0.6)
  const ee = wide * (1 - openness * 0.5)
  const ih = wide * openness * 0.6
  const ou = round * (1 - openness * 0.3)
  const oh = round * openness

  // Parpadeo: promedio de ambos ojos (si uno falla, se usa el otro).
  const earR = eyeAspectRatio(face, EYE_R_TOP, EYE_R_BOTTOM, EYE_R_OUTER, EYE_R_INNER)
  let blink = 0
  if (earR != null) {
    blink = clamp01((C.eyeOpenEAR - earR) / (C.eyeOpenEAR - C.eyeClosedEAR))
  } else {
    const earL = eyeAspectRatio(face, EYE_L_TOP, EYE_L_BOTTOM, EYE_L_OUTER, EYE_L_INNER)
    if (earL != null) blink = clamp01((C.eyeOpenEAR - earL) / (C.eyeOpenEAR - C.eyeClosedEAR))
  }

  return {
    aa: clamp01(aa), ih: clamp01(ih), ou: clamp01(ou),
    ee: clamp01(ee), oh: clamp01(oh), blink: clamp01(blink),
  }
}

/**
 * Secuencia de expresiones por frame → suavizada (EMA) y SIN huecos: los
 * frames sin cara detectada heredan la última expresión válida (igual que
 * frameHeadRotation en vrmSolver.js), arrancando en neutral si el primer
 * frame tampoco tiene cara.
 */
export function smoothFaceSeq(frames, alpha = FACE_CONFIG.smooth) {
  let last = NEUTRAL_EXPR
  const held = frames.map((f) => {
    const e = frameFaceExpr(f)
    if (e) last = e
    return last
  })
  let acc = null
  return held.map((e) => {
    if (!acc) acc = { ...e }
    else {
      for (const k of Object.keys(NEUTRAL_EXPR)) acc[k] += alpha * (e[k] - acc[k])
    }
    return { ...acc }
  })
}

export function lerpExpr(a, b, t) {
  a = a || NEUTRAL_EXPR
  b = b || NEUTRAL_EXPR
  const out = {}
  for (const k of Object.keys(NEUTRAL_EXPR)) out[k] = a[k] + (b[k] - a[k]) * t
  return out
}

export { NEUTRAL_EXPR }

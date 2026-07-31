/**
 * handshapeHints.js — forma ILY (TE_AMO) en el navegador.
 * Corrige NO/SI cuando el GNN se equivoca; espejo de sign_ai/core/handshape_hints.py.
 */

const INDEX_MCP = 5
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const MIDDLE_TIP = 12
const RING_MCP = 13
const RING_TIP = 16
const PINKY_MCP = 17
const PINKY_TIP = 20

function handFromCompact(frame, side) {
  const start = side === 'lh' ? 0 : 63
  const out = []
  for (let i = 0; i < 21; i++) {
    const o = start + i * 3
    out.push({ x: frame[o], y: frame[o + 1], z: frame[o + 2] })
  }
  return out
}

function handPresent(hand) {
  let s = 0
  for (const p of hand) s += Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z)
  return s > 1e-6
}

function pickActiveHand(frames) {
  let best = null
  let bestN = 0
  for (const side of ['lh', 'rh']) {
    const kept = []
    for (const fr of frames) {
      const h = handFromCompact(fr, side)
      if (handPresent(h)) kept.push(h)
    }
    if (kept.length > bestN) {
      bestN = kept.length
      best = kept
    }
  }
  return bestN >= 4 ? best : null
}

function meanHand(seq) {
  const n = seq.length
  const out = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const h of seq) {
    for (let i = 0; i < 21; i++) {
      out[i].x += h[i].x
      out[i].y += h[i].y
      out[i].z += h[i].z
    }
  }
  for (const p of out) {
    p.x /= n
    p.y /= n
    p.z /= n
  }
  return out
}

/** Extensión tip↔MCP relativa a la longitud muñeca→MCP (robusta a bbox). */
function fingerExt(hand, mcp, tip) {
  const wx = hand[0].x
  const wy = hand[0].y
  const bone = Math.hypot(hand[mcp].x - wx, hand[mcp].y - wy) || 1e-4
  const tipLen = Math.hypot(hand[tip].x - hand[mcp].x, hand[tip].y - hand[mcp].y)
  return tipLen / bone
}

/**
 * @param {number[][]} framesCompact lista de frames 126
 * @returns {{ ily: boolean, score: number }}
 */
export function looksLikeIly(framesCompact) {
  if (!framesCompact?.length) return { ily: false, score: 0 }
  const seq = pickActiveHand(framesCompact)
  if (!seq) return { ily: false, score: 0 }
  const tail = seq.slice(-Math.min(8, seq.length))
  const hand = meanHand(tail)

  const indexE = fingerExt(hand, INDEX_MCP, INDEX_TIP)
  const middleE = fingerExt(hand, MIDDLE_MCP, MIDDLE_TIP)
  const ringE = fingerExt(hand, RING_MCP, RING_TIP)
  const pinkyE = fingerExt(hand, PINKY_MCP, PINKY_TIP)

  // ILY: índice y meñique abiertos; medio y anular más cerrados.
  const openPair = Math.min(indexE, pinkyE)
  const closedPair = Math.max(middleE, ringE)
  const contrast = openPair - closedPair
  const score =
    (indexE >= 0.85 ? 1 : indexE / 0.85) * 0.3 +
    (pinkyE >= 0.75 ? 1 : pinkyE / 0.75) * 0.3 +
    (middleE <= 1.05 ? 1 : Math.max(0, 1.4 - middleE)) * 0.2 +
    (ringE <= 1.05 ? 1 : Math.max(0, 1.4 - ringE)) * 0.2

  const ily =
    indexE >= 0.9 &&
    pinkyE >= 0.75 &&
    middleE <= 1.15 &&
    ringE <= 1.15 &&
    indexE > middleE * 1.05 &&
    pinkyE > ringE * 1.0 &&
    contrast >= 0.05

  const soft =
    score >= 0.68 &&
    pinkyE >= 0.60 &&
    indexE >= 0.80 &&
    middleE < indexE * 1.05 &&
    contrast >= -0.02

  return {
    ily: ily || soft,
    score,
    indexE,
    middleE,
    ringE,
    pinkyE,
  }
}

/** Formas conjugadas de TE_AMO (no pisar con el rescate ILY). */
const TE_AMO_FORMS = new Set([
  'TE_AMO',
  'YO_TE_AMO',
  'ME_AMAS',
  'TU_ME_AMAS',
  'LO_AMO',
  'LA_AMO',
  'ME_AMA',
  'EL_ME_AMA',
  'ELLA_ME_AMA',
  'NOS_AMAMOS',
])

/** Si el modelo se equivocó pero la mano es ILY → TE_AMO (cita). */
export function maybeCorrectTeAmo(prediction, framesCompact) {
  const pred = String(prediction || '').toUpperCase()
  if (TE_AMO_FORMS.has(pred)) return prediction
  const hint = looksLikeIly(framesCompact)
  if (hint.ily) return 'TE_AMO'
  return prediction
}

function meanHandBlock(frames, side) {
  const kept = []
  for (const fr of frames) {
    const h = handFromCompact(fr, side)
    if (handPresent(h)) kept.push(h)
  }
  if (kept.length < 4) return null
  return meanHand(kept.slice(-Math.min(10, kept.length)))
}

function fShapeScore(hand) {
  const bone =
    Math.hypot(hand[INDEX_MCP].x - hand[0].x, hand[INDEX_MCP].y - hand[0].y) || 1e-4
  const indexE = fingerExt(hand, INDEX_MCP, INDEX_TIP)
  const it =
    Math.hypot(hand[INDEX_TIP].x - hand[4].x, hand[INDEX_TIP].y - hand[4].y) / bone
  const close = it <= 0.25 ? 1 : Math.max(0, 1 - (it - 0.25) / 0.55)
  const curled = indexE <= 0.55 ? 1 : Math.max(0, 1 - (indexE - 0.55) / 0.7)
  return 0.55 * close + 0.45 * curled
}

function wristTraj(frames, side) {
  const pts = []
  for (const fr of frames) {
    const h = handFromCompact(fr, side)
    if (handPresent(h)) pts.push({ x: h[0].x, y: h[0].y })
  }
  return pts.length >= 4 ? pts : null
}

/** Espejo de resolve_como_familia (API): forma F / separación — decide siempre. */
export function resolveComoFamilia(framesCompact) {
  if (!framesCompact?.length) return { preferred: null, familia: 0, como: 0 }
  const fScores = []
  const indexEs = []
  for (const side of ['lh', 'rh']) {
    const mh = meanHandBlock(framesCompact, side)
    if (!mh) continue
    fScores.push(fShapeScore(mh))
    indexEs.push(fingerExt(mh, INDEX_MCP, INDEX_TIP))
  }
  if (!fScores.length) return { preferred: null, familia: 0, como: 0 }

  const fShape = fScores.reduce((a, b) => a + b, 0) / fScores.length
  const indexOpen = indexEs.reduce((a, b) => a + b, 0) / indexEs.length

  const lh = wristTraj(framesCompact, 'lh')
  const rh = wristTraj(framesCompact, 'rh')
  let wristDist = 0.35
  let orbitRad = 0.08
  if (lh && rh) {
    const n = Math.min(lh.length, rh.length)
    const L = lh.slice(-n)
    const R = rh.slice(-n)
    let distSum = 0
    const rel = []
    for (let i = 0; i < n; i++) {
      const dx = L[i].x - R[i].x
      const dy = L[i].y - R[i].y
      distSum += Math.hypot(dx, dy)
      rel.push({ x: dx, y: dy })
    }
    wristDist = distSum / n
    const mx = rel.reduce((s, p) => s + p.x, 0) / n
    const my = rel.reduce((s, p) => s + p.y, 0) / n
    orbitRad = rel.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / n
  }

  const closeWrists = wristDist <= 0.28 ? 1 : Math.max(0, 1 - (wristDist - 0.28) / 0.22)
  const tightOrbit = orbitRad <= 0.04 ? 1 : Math.max(0, 1 - (orbitRad - 0.04) / 0.1)
  const familia = 0.5 * fShape + 0.3 * closeWrists + 0.2 * tightOrbit

  const openIdx = indexOpen >= 0.95 ? 1 : indexOpen / 0.95
  const farWrists = wristDist >= 0.36 ? 1 : Math.max(0, wristDist / 0.36)
  const wideOrbit = orbitRad >= 0.07 ? 1 : orbitRad / 0.07
  const como = 0.4 * openIdx + 0.4 * farWrists + 0.2 * wideOrbit

  let preferred
  const looksF = fShape >= 0.42 || (wristDist <= 0.3 && fShape >= 0.28)
  const clearComo =
    wristDist >= 0.38 &&
    indexOpen >= 0.95 &&
    fShape < 0.4 &&
    como >= familia + 0.12
  if (looksF && !clearComo) preferred = 'FAMILIA'
  else if (clearComo) preferred = 'COMO_ESTAS'
  else if (familia >= como) preferred = 'FAMILIA'
  else preferred = como < familia + 0.2 ? 'FAMILIA' : 'COMO_ESTAS'

  return { preferred, familia, como, wristDist, fShape }
}

/** Si el modelo cruzó COMO_ESTAS ↔ FAMILIA, corregir (sesgo anti-falso COMO). */
export function maybeCorrectComoFamilia(prediction, framesCompact) {
  const pred = String(prediction || '').toUpperCase()
  if (pred !== 'COMO_ESTAS' && pred !== 'FAMILIA') return prediction
  const geo = resolveComoFamilia(framesCompact)
  if (pred === 'FAMILIA') {
    // Solo pisar FAMILIA si la geo es COMO muy clara.
    if (
      geo.preferred === 'COMO_ESTAS' &&
      (geo.fShape ?? 0) < 0.35 &&
      (geo.wristDist ?? 0) >= 0.38
    ) {
      return 'COMO_ESTAS'
    }
    return 'FAMILIA'
  }
  // pred === COMO_ESTAS
  if ((geo.fShape ?? 0) >= 0.4 || (geo.wristDist ?? 1) <= 0.3) return 'FAMILIA'
  return geo.preferred || prediction
}

function letterFingerProfile(hand) {
  const ie = fingerExt(hand, INDEX_MCP, INDEX_TIP)
  const me = fingerExt(hand, MIDDLE_MCP, MIDDLE_TIP)
  const re = fingerExt(hand, RING_MCP, RING_TIP)
  const pe = fingerExt(hand, PINKY_MCP, PINKY_TIP)
  return { ie, me, re, pe, twoOpen: Math.min(ie, me) }
}

function looksLikeN(hand) {
  const { ie, me, re, pe, twoOpen } = letterFingerProfile(hand)
  if (ie < 0.55 || me < 0.50) return false
  if (me < ie * 0.72) return false
  const ringDown = re <= 1.05 && twoOpen - re >= 0.015
  const pinkyDown = pe <= 1.18
  return ringDown && pinkyDown
}

/** Regla checkpoint L3477: índice+medio juntos → N (GNN suele decir P). */
function isIndexMiddleNShape(hand) {
  const { ie, me } = letterFingerProfile(hand)
  return ie >= 0.50 && me >= ie * 0.68
}

function looksLikeP(hand) {
  const { ie, me, re, pe } = letterFingerProfile(hand)
  if (ie < 0.48) return false
  if (me >= ie * 0.72) return false
  return me <= 0.68 && re <= 1.12 && pe <= 1.12
}

function classifyMNÑ(hand, barrido = false) {
  const ie = fingerExt(hand, INDEX_MCP, INDEX_TIP)
  const me = fingerExt(hand, MIDDLE_MCP, MIDDLE_TIP)
  const re = fingerExt(hand, RING_MCP, RING_TIP)
  const pe = fingerExt(hand, PINKY_MCP, PINKY_TIP)
  if (ie < 0.65 || me < 0.65) return null
  const twoOpen = Math.min(ie, me)
  const ringOpen = re >= 0.72 && re >= twoOpen * 0.75
  const pinkyDown = pe <= 1.12 && Math.min(ie, me, re) > pe * 1.03
  if (ringOpen && pinkyDown) return 'M'
  const ringDown = re <= 1.0 && twoOpen - re >= 0.025 && re < twoOpen * 0.97
  if (ringDown && pe <= 1.15) return barrido ? 'Ñ' : 'N'
  return null
}

/**
 * Barrido deliberado de Ñ: meñique se mueve respecto a la muñeca en una
 * dirección sostenida, con índice y medio estables (forma N estática).
 * Umbrales viejos (total≥0.038 OR maxStep≥0.022) marcaban temblor como Ñ.
 */
function hasEnyeSweep(framesCompact) {
  const seq = pickActiveHand(framesCompact)
  if (!seq || seq.length < 6) return false

  const relPinky = []
  const relIndex = []
  const relMiddle = []
  for (const h of seq) {
    const wx = h[0].x
    const wy = h[0].y
    relPinky.push({ x: h[PINKY_TIP].x - wx, y: h[PINKY_TIP].y - wy })
    relIndex.push({ x: h[INDEX_TIP].x - wx, y: h[INDEX_TIP].y - wy })
    relMiddle.push({ x: h[MIDDLE_TIP].x - wx, y: h[MIDDLE_TIP].y - wy })
  }

  let indexMiddleJitter = 0
  for (let i = 1; i < seq.length; i++) {
    indexMiddleJitter = Math.max(
      indexMiddleJitter,
      Math.hypot(relIndex[i].x - relIndex[i - 1].x, relIndex[i].y - relIndex[i - 1].y),
      Math.hypot(relMiddle[i].x - relMiddle[i - 1].x, relMiddle[i].y - relMiddle[i - 1].y),
    )
  }
  if (indexMiddleJitter > 0.028) return false

  const n = relPinky.length
  const net = Math.hypot(
    relPinky[n - 1].x - relPinky[0].x,
    relPinky[n - 1].y - relPinky[0].y,
  )

  let bestRun = 0
  let run = 0
  let prevDx = 0
  let prevDy = 0
  for (let i = 1; i < n; i++) {
    const dx = relPinky[i].x - relPinky[i - 1].x
    const dy = relPinky[i].y - relPinky[i - 1].y
    const step = Math.hypot(dx, dy)
    if (step < 0.007) {
      run = 0
      continue
    }
    const sameDir = i === 1 || dx * prevDx + dy * prevDy > 0
    run = sameDir ? run + step : step
    bestRun = Math.max(bestRun, run)
    prevDx = dx
    prevDy = dy
  }

  return net >= 0.048 && bestRun >= 0.038
}

function looksLikeG(hand) {
  const ie = fingerExt(hand, INDEX_MCP, INDEX_TIP)
  const me = fingerExt(hand, MIDDLE_MCP, MIDDLE_TIP)
  const re = fingerExt(hand, RING_MCP, RING_TIP)
  const pe = fingerExt(hand, PINKY_MCP, PINKY_TIP)
  const closed = Math.max(me, re, pe)
  if (closed > 1.08 || ie < 0.52 || ie > 0.98) return false
  if (ie >= 0.74 && me >= 0.74) return false
  const bone =
    Math.hypot(hand[INDEX_MCP].x - hand[0].x, hand[INDEX_MCP].y - hand[0].y) || 1e-4
  const thumbToIndexTip =
    Math.hypot(hand[4].x - hand[INDEX_TIP].x, hand[4].y - hand[INDEX_TIP].y) / bone
  return ie >= 0.56 && ie <= 0.90 && closed <= 1.06 &&
    thumbToIndexTip >= 0.20 && thumbToIndexTip <= 0.58
}

function looksLikeX(hand) {
  const ie = fingerExt(hand, INDEX_MCP, INDEX_TIP)
  const closed = Math.max(
    fingerExt(hand, MIDDLE_MCP, MIDDLE_TIP),
    fingerExt(hand, RING_MCP, RING_TIP),
    fingerExt(hand, PINKY_MCP, PINKY_TIP),
  )
  if (closed > 1.1 || ie >= 0.72) return false
  return ie >= 0.38 && ie <= 0.68
}

/** Correcciones mínimas de deletreo: G↔X/S y M/N/Ñ. */
export function maybeCorrectSpellingGNMNÑ(prediction, framesCompact) {
  const pred = String(prediction || '').toUpperCase()
  const gConfused = pred === 'G' || pred === 'X' || pred === 'S'
  const mnConfused = new Set(['M', 'N', 'Ñ', 'P', 'SI', 'S', 'NO'])
  if (!gConfused && !mnConfused.has(pred)) return prediction
  if (!framesCompact?.length) return prediction

  const seq = pickActiveHand(framesCompact)
  if (!seq) return prediction
  const hand = meanHand(seq.slice(-Math.min(8, seq.length)))
  const enyeSweep = hasEnyeSweep(framesCompact)
  const { ie, me } = letterFingerProfile(hand)

  if (pred === 'P' || pred === 'N' || pred === 'Ñ' || pred === 'M' || mnConfused.has(pred)) {
    // Checkpoint L3477: medio ≥ 68 % del índice → N (aunque el GNN diga P).
    if (isIndexMiddleNShape(hand)) return enyeSweep ? 'Ñ' : 'N'
    if (looksLikeN(hand)) return enyeSweep ? 'Ñ' : 'N'
    if (pred === 'Ñ' && !enyeSweep) return 'N'
    if (pred === 'P' && me >= ie * 0.68 && ie >= 0.50) return enyeSweep ? 'Ñ' : 'N'
    if (looksLikeP(hand)) return 'P'
    const mn = classifyMNÑ(hand, enyeSweep)
    if (mn) return mn
  }

  if (gConfused) {
    if (looksLikeG(hand) && !looksLikeX(hand)) return 'G'
    if (pred === 'X' && looksLikeX(hand) && !looksLikeG(hand)) return 'X'
  }

  return prediction
}

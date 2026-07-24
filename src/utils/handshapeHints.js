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

  return {
    ily: ily || (score >= 0.72 && pinkyE >= 0.65 && indexE >= 0.85 && middleE < indexE),
    score,
    indexE,
    middleE,
    ringE,
    pinkyE,
  }
}

/** Si el modelo dijo NO/SI pero la mano es ILY → TE_AMO. */
export function maybeCorrectTeAmo(prediction, framesCompact) {
  const pred = String(prediction || '').toUpperCase()
  if (pred !== 'NO' && pred !== 'SI') return prediction
  const hint = looksLikeIly(framesCompact)
  if (hint.ily) return 'TE_AMO'
  return prediction
}

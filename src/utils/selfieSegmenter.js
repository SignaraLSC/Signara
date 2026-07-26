/**
 * ImageSegmenter (selfie) compartido — blur de fondo / máscara de persona.
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

const TASKS_VISION_VER = '0.10.35'
const VISION_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VER}/wasm`
const SELFIE_MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.task',
]

let sharedSegmenter = null
let sharedPromise = null
const SEGMENTER_REV = 8
let sharedRev = 0

async function createSegmenter(vision, modelAssetPath, delegate) {
  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })
}

export function getSharedSelfieSegmenter() {
  if (sharedSegmenter && sharedRev === SEGMENTER_REV) {
    return Promise.resolve(sharedSegmenter)
  }
  if (sharedPromise && sharedRev === SEGMENTER_REV) return sharedPromise
  sharedSegmenter = null
  sharedRev = SEGMENTER_REV
  sharedPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL)
    let lastErr
    for (const url of SELFIE_MODEL_URLS) {
      for (const delegate of ['GPU', 'CPU']) {
        try {
          const seg = await createSegmenter(vision, url, delegate)
          sharedSegmenter = seg
          return seg
        } catch (e) {
          lastErr = e
        }
      }
    }
    throw lastErr || new Error('No se pudo cargar ImageSegmenter')
  })()
  return sharedPromise
}

export function warmupSelfieSegmenter() {
  return getSharedSelfieSegmenter().catch(() => null)
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (edge1 === edge0 ? 0 : (x - edge0) / (edge1 - edge0))))
  return t * t * (3 - 2 * t)
}

/**
 * Máscara suave de persona (preview). Generosa para no comer pelo/manos/brazos.
 */
export function fillPersonMaskCanvas(
  maskCanvas,
  confidenceMask,
  // Umbral más alto = silueta limpia y opaca (tú delante, no “comida”).
  { invert = false, softLo = 0.35, softHi = 0.62 } = {},
) {
  if (!maskCanvas || !confidenceMask) return false
  const mw = confidenceMask.width
  const mh = confidenceMask.height
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas.width = mw
    maskCanvas.height = mh
  }
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  const img = ctx.createImageData(mw, mh)
  const data = img.data
  const conf = confidenceMask.getAsFloat32Array()
  for (let i = 0; i < conf.length; i++) {
    let c = conf[i]
    if (invert) c = 1 - c
    const a = Math.round(smoothstep(softLo, softHi, c) * 255)
    const o = i * 4
    data[o] = 255
    data[o + 1] = 255
    data[o + 2] = 255
    data[o + 3] = a
  }
  ctx.putImageData(img, 0, 0)
  return true
}

/** Elige la máscara cuyo centro tiene más confianza (evita canal invertido). */
export function pickPersonConfidenceMask(masks) {
  if (!masks?.length) return null
  if (masks.length === 1) return masks[0]

  let best = masks[0]
  let bestCenter = -1
  for (const m of masks) {
    const conf = m.getAsFloat32Array()
    const w = m.width
    const h = m.height
    let sum = 0
    let n = 0
    const y0 = Math.floor(h * 0.15)
    const y1 = Math.floor(h * 0.85)
    const x0 = Math.floor(w * 0.25)
    const x1 = Math.floor(w * 0.75)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += conf[y * w + x]
        n++
      }
    }
    const center = n ? sum / n : 0
    if (center > bestCenter) {
      bestCenter = center
      best = m
    }
  }
  return best
}

function _maskCenterAlpha(maskCanvas) {
  if (!maskCanvas?.width) return 0
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  const { width: w, height: h } = maskCanvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  let sum = 0
  let n = 0
  const y0 = Math.floor(h * 0.2)
  const y1 = Math.floor(h * 0.8)
  const x0 = Math.floor(w * 0.3)
  const x1 = Math.floor(w * 0.7)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += d[(y * w + x) * 4 + 3]
      n++
    }
  }
  return n ? sum / (n * 255) : 0
}

/** Rellena máscara; invierte si el canal venía al revés. */
export function fillPersonMaskAuto(maskCanvas, confidenceMask, opts = {}) {
  if (!fillPersonMaskCanvas(maskCanvas, confidenceMask, opts)) return false
  if (_maskCenterAlpha(maskCanvas) < 0.28) {
    return fillPersonMaskCanvas(maskCanvas, confidenceMask, { ...opts, invert: true })
  }
  return true
}

/** Zona central de firma siempre protegida (manos extendidas). */
export function stampSigningZoneIntoMask(maskCanvas) {
  if (!maskCanvas?.width) return
  const ctx = maskCanvas.getContext('2d', { alpha: true })
  if (!ctx) return
  const mw = maskCanvas.width
  const mh = maskCanvas.height
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.globalCompositeOperation = 'source-over'
  ctx.beginPath()
  ctx.ellipse(mw * 0.5, mh * 0.46, mw * 0.44, mh * 0.48, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Máscara generosa desde selfie_segmenter para HandLandmarker (sin blur visual).
 */
export function buildInferenceMaskFromSelfie(workMask, confidenceMask) {
  if (!workMask || !confidenceMask) return false
  if (!fillPersonMaskAuto(workMask, confidenceMask, { softLo: 0.20, softHi: 0.50 })) {
    return false
  }
  if (_maskCenterAlpha(workMask) < 0.16) return false
  dilateMask(workMask, 8)
  stampSigningZoneIntoMask(workMask)
  return true
}

/**
 * Pinta gris neutro el fondo del canvas de inferencia; protege manos conocidas.
 */
export function applyInferenceMaskToDetectCanvas(ctx, w, h, workMask, leftHand, rightHand, scratch) {
  if (!ctx || !workMask?.width) return
  const protect = scratch || document.createElement('canvas')
  if (protect.width !== workMask.width || protect.height !== workMask.height) {
    protect.width = workMask.width
    protect.height = workMask.height
  }
  const pctx = protect.getContext('2d', { alpha: true })
  if (!pctx) return
  pctx.clearRect(0, 0, protect.width, protect.height)
  pctx.drawImage(workMask, 0, 0)
  stampHandsIntoMask(protect, leftHand, rightHand, {
    radiusNorm: 0.075,
    minRadiusPx: 10,
    maxRadiusPx: 28,
  })
  solidifyBackgroundFromMask(ctx, w, h, protect, [42, 40, 38], { alphaCut: 38 })
  return protect
}

/** Fondo virtual Signara (sin blur del cuarto). */
export function drawSignaraVirtualBackdrop(destCtx, w, h) {
  if (!destCtx || w < 1 || h < 1) return
  const g = destCtx.createLinearGradient(0, 0, w * 0.9, h)
  g.addColorStop(0, '#FAF6EC')
  g.addColorStop(0.42, '#F0E8F8')
  g.addColorStop(1, '#DDD0F0')
  destCtx.fillStyle = g
  destCtx.fillRect(0, 0, w, h)
  destCtx.globalAlpha = 0.32
  const blob = destCtx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, w * 0.55)
  blob.addColorStop(0, '#E8D4FF')
  blob.addColorStop(1, 'rgba(232, 212, 255, 0)')
  destCtx.fillStyle = blob
  destCtx.fillRect(0, 0, w, h)
  destCtx.globalAlpha = 1
}

/**
 * Preview visible: fondo Signara + persona recortada (misma máscara selfie).
 */
export function composeSelfiePreviewFrame({
  destCtx,
  video,
  personMask,
  workMask,
  featherCanvas,
  personLayer,
  leftHand,
  rightHand,
  w,
  h,
}) {
  if (!destCtx || !video || !personMask?.width || w < 1 || h < 1) return false

  if (workMask.width !== personMask.width || workMask.height !== personMask.height) {
    workMask.width = personMask.width
    workMask.height = personMask.height
  }
  const wctx = workMask.getContext('2d', { alpha: true })
  if (!wctx) return false
  wctx.setTransform(1, 0, 0, 1, 0, 0)
  wctx.globalCompositeOperation = 'source-over'
  wctx.clearRect(0, 0, workMask.width, workMask.height)
  wctx.drawImage(personMask, 0, 0)
  stampHandsIntoMask(workMask, leftHand, rightHand, {
    radiusNorm: 0.075,
    minRadiusPx: 10,
    maxRadiusPx: 28,
  })
  if (!featherMaskTo(workMask, featherCanvas, w, h, 1)) return false

  destCtx.setTransform(1, 0, 0, 1, 0, 0)
  destCtx.globalCompositeOperation = 'source-over'
  destCtx.imageSmoothingEnabled = true
  destCtx.imageSmoothingQuality = 'high'
  destCtx.clearRect(0, 0, w, h)
  drawSignaraVirtualBackdrop(destCtx, w, h)

  if (personLayer.width !== w || personLayer.height !== h) {
    personLayer.width = w
    personLayer.height = h
  }
  const pctx = personLayer.getContext('2d', { alpha: true })
  if (!pctx) return false
  pctx.setTransform(1, 0, 0, 1, 0, 0)
  pctx.globalCompositeOperation = 'source-over'
  pctx.imageSmoothingEnabled = true
  pctx.imageSmoothingQuality = 'high'
  pctx.clearRect(0, 0, w, h)
  pctx.drawImage(video, 0, 0, w, h)
  pctx.globalCompositeOperation = 'destination-in'
  pctx.drawImage(featherCanvas, 0, 0, w, h)
  pctx.globalCompositeOperation = 'source-over'

  destCtx.drawImage(personLayer, 0, 0)
  return true
}

/**
 * Para inferencia: quita otras personas lejanas, pero CONSERVA brazos/manos
 * de la persona principal (blobs satélite cercanos y más pequeños).
 */
export function keepPrimaryPersonOnly(maskCanvas, { alphaCut = 100, keepSatellites = true } = {}) {
  if (!maskCanvas) return false
  const mw = maskCanvas.width
  const mh = maskCanvas.height
  if (mw < 2 || mh < 2) return false
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  const img = ctx.getImageData(0, 0, mw, mh)
  const data = img.data
  const n = mw * mh
  const labels = new Int32Array(n)
  labels.fill(-1)

  const parent = []
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const unite = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  let nextId = 0
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x
      if (data[i * 4 + 3] < alphaCut) continue
      const left = x > 0 ? labels[i - 1] : -1
      const up = y > 0 ? labels[i - mw] : -1
      if (left < 0 && up < 0) {
        parent[nextId] = nextId
        labels[i] = nextId++
      } else if (left >= 0 && up < 0) {
        labels[i] = find(left)
      } else if (up >= 0 && left < 0) {
        labels[i] = find(up)
      } else {
        unite(left, up)
        labels[i] = find(left)
      }
    }
  }

  if (nextId === 0) return false

  const area = new Float64Array(nextId)
  const sumX = new Float64Array(nextId)
  const sumY = new Float64Array(nextId)
  for (let i = 0; i < n; i++) {
    let id = labels[i]
    if (id < 0) continue
    id = find(id)
    labels[i] = id
    area[id]++
    sumX[id] += i % mw
    sumY[id] += (i / mw) | 0
  }

  const cx = mw * 0.5
  const cy = mh * 0.55
  let bestId = -1
  let bestScore = -1
  for (let id = 0; id < nextId; id++) {
    if (area[id] < n * 0.01) continue
    const mx = sumX[id] / area[id]
    const my = sumY[id] / area[id]
    const dx = (mx - cx) / mw
    const dy = (my - cy) / mh
    const score = area[id] / (1 + 5 * (dx * dx + dy * dy))
    if (score > bestScore) {
      bestScore = score
      bestId = id
    }
  }
  if (bestId < 0) {
    for (let id = 0; id < nextId; id++) {
      if (area[id] > bestScore) {
        bestScore = area[id]
        bestId = id
      }
    }
  }
  if (bestId < 0) return false

  const keep = new Set([bestId])
  if (keepSatellites) {
    const pCx = sumX[bestId] / area[bestId]
    const pCy = sumY[bestId] / area[bestId]
    const pArea = area[bestId]
    for (let id = 0; id < nextId; id++) {
      if (id === bestId || area[id] < n * 0.003) continue
      // Otra persona casi igual de grande → blur (no satélite).
      if (area[id] >= pArea * 0.55) continue
      const mx = sumX[id] / area[id]
      const my = sumY[id] / area[id]
      const dist = Math.hypot((mx - pCx) / mw, (my - pCy) / mh)
      // Brazo/mano alzada suele estar a <~0.45 del torso.
      if (dist <= 0.48) keep.add(id)
    }
  }

  for (let i = 0; i < n; i++) {
    if (!keep.has(labels[i])) data[i * 4 + 3] = 0
  }
  ctx.putImageData(img, 0, 0)
  return true
}

const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
]

/**
 * Silueta de mano lo bastante gruesa para no “comerse” dedos,
 * pero sin elipse gigante que apague el blur del fondo.
 */
export function stampHandsIntoMask(maskCanvas, leftLms, rightLms, {
  radiusNorm = 0.045,
  minRadiusPx = 6,
  maxRadiusPx = 16,
} = {}) {
  if (!maskCanvas) return
  const ctx = maskCanvas.getContext('2d', { alpha: true })
  if (!ctx) return
  const mw = maskCanvas.width
  const mh = maskCanvas.height
  const r = Math.max(minRadiusPx, Math.min(maxRadiusPx, radiusNorm * Math.min(mw, mh)))

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = r * 2.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const lms of [leftLms, rightLms]) {
    if (!lms?.length) continue
    ctx.beginPath()
    for (const [a, b] of HAND_BONES) {
      const pa = lms[a]
      const pb = lms[b]
      if (!pa || !pb || pa.x == null || pb.x == null) continue
      ctx.moveTo(pa.x * mw, pa.y * mh)
      ctx.lineTo(pb.x * mw, pb.y * mh)
    }
    ctx.stroke()
    for (const p of lms) {
      if (!p || p.x == null) continue
      ctx.beginPath()
      ctx.arc(p.x * mw, p.y * mh, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // Palma: disco entre muñeca y nudillos.
    const wrist = lms[0]
    const mid = lms[9]
    if (wrist && mid && wrist.x != null && mid.x != null) {
      const px = ((wrist.x + mid.x) / 2) * mw
      const py = ((wrist.y + mid.y) / 2) * mh
      ctx.beginPath()
      ctx.arc(px, py, r * 2.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function autoExposeCanvas(ctx, w, h, { targetMean = 120, maxGain = 1.9 } = {}) {
  if (!ctx || w < 1 || h < 1) return
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  let sum = 0
  const pixels = w * h
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  const mean = sum / pixels
  if (!(mean > 1)) return
  let gain = targetMean / mean
  gain = Math.min(maxGain, Math.max(0.9, gain))
  if (Math.abs(gain - 1) < 0.06) return
  const contrast = mean < 90 ? 1.12 : 1.0
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = d[i + c] * gain
      v = (v - 128) * contrast + 128
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Endurece la máscara: casi binaria (persona 100% opaca).
 * Así no te “comes” al fondo ni pareces parte de él.
 */
export function hardenMaskOpaque(maskCanvas, { cut = 110 } = {}) {
  if (!maskCanvas) return
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const { width: mw, height: mh } = maskCanvas
  const img = ctx.getImageData(0, 0, mw, mh)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) {
    d[i] = d[i] >= cut ? 255 : 0
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Dilata la silueta (pixeles) para no cortar pelo/manos.
 */
export function dilateMask(maskCanvas, radiusPx = 4) {
  if (!maskCanvas || radiusPx < 1) return
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const { width: w, height: h } = maskCanvas
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d')
  tctx.filter = `blur(${radiusPx}px)`
  tctx.drawImage(maskCanvas, 0, 0)
  tctx.filter = 'none'
  const img = tctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) {
    d[i] = d[i] > 20 ? 255 : 0
  }
  tctx.putImageData(img, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(tmp, 0, 0)
}

export function featherMaskTo(maskCanvas, outCanvas, outW, outH, featherPx = 1) {
  if (!maskCanvas || !outCanvas) return false
  if (outCanvas.width !== outW || outCanvas.height !== outH) {
    outCanvas.width = outW
    outCanvas.height = outH
  }
  const ctx = outCanvas.getContext('2d', { alpha: true })
  if (!ctx) return false
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, outW, outH)
  // Solo un pelín de suavizado en el borde (1px), sin halo grande.
  if (featherPx > 0) {
    ctx.filter = `blur(${featherPx}px)`
  }
  ctx.drawImage(maskCanvas, 0, 0, outW, outH)
  ctx.filter = 'none'
  const img = ctx.getImageData(0, 0, outW, outH)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) {
    // Re-opacar: casi todo el cuerpo a 255.
    if (d[i] < 50) d[i] = 0
    else if (d[i] > 120) d[i] = 255
    else d[i] = Math.round(((d[i] - 50) / 70) * 255)
  }
  ctx.putImageData(img, 0, 0)
  return true
}

/**
 * Fondo estudio estilo Meet, desde cero:
 * 1) Fondo = video muy reducido + upscale (blur barato) + lavado azul (no gris).
 * 2) Persona = video nítido recortado con máscara suave (manos selladas).
 * Sin sombra de color (antes teñía la piel de azul).
 */
export function composeStudioFrame({
  destCtx,
  video,
  personMask,
  workMask,
  featherCanvas,
  personLayer,
  bgCanvas,
  leftHand,
  rightHand,
  w,
  h,
}) {
  if (!destCtx || !video || !personMask || w < 1 || h < 1) return false

  // ── Máscara ──────────────────────────────────────────────────────────────
  if (workMask.width !== personMask.width || workMask.height !== personMask.height) {
    workMask.width = personMask.width
    workMask.height = personMask.height
  }
  const wctx = workMask.getContext('2d', { alpha: true })
  if (!wctx) return false
  wctx.setTransform(1, 0, 0, 1, 0, 0)
  wctx.globalCompositeOperation = 'source-over'
  wctx.clearRect(0, 0, workMask.width, workMask.height)
  wctx.drawImage(personMask, 0, 0)
  stampHandsIntoMask(workMask, leftHand, rightHand, {
    radiusNorm: 0.05,
    minRadiusPx: 5,
    maxRadiusPx: 14,
  })
  // Expandir un poco para pelo/orejas; feather corto = borde limpio sin halo.
  dilateMask(workMask, 3)
  if (!featherMaskTo(workMask, featherCanvas, w, h, 2)) return false

  // ── Fondo: blur por downscale + tinte azul (evita el “gris fangoso”) ──────
  const bw = Math.max(10, Math.round(w / 14))
  const bh = Math.max(8, Math.round(h / 14))
  if (bgCanvas.width !== bw || bgCanvas.height !== bh) {
    bgCanvas.width = bw
    bgCanvas.height = bh
  }
  const bctx = bgCanvas.getContext('2d', { alpha: false })
  if (!bctx) return false
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = 'low'
  bctx.globalCompositeOperation = 'source-over'
  bctx.drawImage(video, 0, 0, bw, bh)
  // Lavado azul pastel encima del blur (mantiene algo de escena, no flat).
  bctx.globalCompositeOperation = 'source-atop'
  bctx.fillStyle = 'rgba(168, 206, 242, 0.78)'
  bctx.fillRect(0, 0, bw, bh)
  bctx.globalCompositeOperation = 'screen'
  bctx.fillStyle = 'rgba(234, 243, 252, 0.35)'
  bctx.fillRect(0, 0, bw, bh)
  bctx.globalCompositeOperation = 'source-over'

  destCtx.setTransform(1, 0, 0, 1, 0, 0)
  destCtx.globalCompositeOperation = 'source-over'
  destCtx.imageSmoothingEnabled = true
  destCtx.imageSmoothingQuality = 'high'
  destCtx.drawImage(bgCanvas, 0, 0, w, h)
  // Velo azul suave (marca Signara, sin tapar del todo).
  destCtx.fillStyle = 'rgba(212, 230, 251, 0.28)'
  destCtx.fillRect(0, 0, w, h)

  // ── Persona nítida ───────────────────────────────────────────────────────
  if (personLayer.width !== w || personLayer.height !== h) {
    personLayer.width = w
    personLayer.height = h
  }
  const pctx = personLayer.getContext('2d', { alpha: true })
  if (!pctx) return false
  pctx.setTransform(1, 0, 0, 1, 0, 0)
  pctx.globalCompositeOperation = 'source-over'
  pctx.imageSmoothingEnabled = true
  pctx.imageSmoothingQuality = 'high'
  pctx.clearRect(0, 0, w, h)
  pctx.drawImage(video, 0, 0, w, h)
  pctx.globalCompositeOperation = 'destination-in'
  pctx.drawImage(featherCanvas, 0, 0, w, h)
  pctx.globalCompositeOperation = 'source-over'

  destCtx.drawImage(personLayer, 0, 0)
  return true
}

/** @deprecated — usar composeStudioFrame */
export function drawSoftBlueBackdrop(destCtx, w, h) {
  const g = destCtx.createLinearGradient(0, 0, w * 0.2, h)
  g.addColorStop(0, '#EAF3FC')
  g.addColorStop(0.4, '#D4E6FB')
  g.addColorStop(1, '#BDD9F5')
  destCtx.fillStyle = g
  destCtx.fillRect(0, 0, w, h)
}

/** @deprecated */
export function drawMeetBlueBlurBackground(destCtx, video, w, h) {
  drawSoftBlueBackdrop(destCtx, w, h)
}

/** @deprecated */
export function drawPastelStudioBackground(destCtx, w, h) {
  drawSoftBlueBackdrop(destCtx, w, h)
}

/** @deprecated */
export function drawSoftBackgroundBlur(destCtx, source, w, h) {
  drawSoftBlueBackdrop(destCtx, w, h)
}

export function solidifyBackgroundFromMask(ctx, w, h, maskCanvas, rgb = [42, 40, 38], { alphaCut = 90 } = {}) {
  if (!ctx || !maskCanvas) return
  const mw = maskCanvas.width
  const mh = maskCanvas.height
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!mctx) return
  const mask = mctx.getImageData(0, 0, mw, mh).data
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const [r, g, b] = rgb
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / h))
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mw - 1, Math.floor((x * mw) / w))
      const a = mask[(my * mw + mx) * 4 + 3]
      if (a < alphaCut) {
        const i = (y * w + x) * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = 255
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

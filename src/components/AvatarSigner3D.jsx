/**
 * AvatarSigner3D
 * Reproduce animaciones de señas grabadas con 00_capture.py, servidas por la API
 * ML en /sign/{token} como { token, fps, frames:[{lh, rh, pose, face}] }.
 *
 * Acabado profesional:
 *  - Cara como malla de contornos (óvalo, ojos, cejas, labios, nariz).
 *  - Suavizado temporal (media móvil) para quitar el tembleque de MediaPipe.
 *  - Manos ausentes: se ocultan (si nunca aparecen) o se mantienen (si parpadean),
 *    en vez de saltar al origen.
 *  - Reproducción por tiempo con interpolación entre frames → fluido a 60fps.
 *
 * API imperativa (via ref): queue(token) · replace([tokens]) · clear()
 */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import * as THREE from 'three'

// ─── Conexiones ────────────────────────────────────────────────────────────────
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17],
]
// Pose: solo hombros, codos y muñecas (la cara la dibuja la malla facial; se
// omiten las caderas porque suelen quedar fuera de cuadro y dan valores extremos)
const POSE_POINTS = [11, 12, 13, 14, 15, 16]
const POSE_CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16]]

// Cara: tamaños de cada grupo de contorno (deben coincidir con regen_face.js)
const FACE_SPANS = [
  { count: 36, loop: true },  { count: 16, loop: true },  { count: 16, loop: true },
  { count: 5,  loop: false }, { count: 5,  loop: false }, { count: 20, loop: true },
  { count: 20, loop: true },  { count: 6,  loop: false },
]
function buildFaceEdges(spans) {
  const edges = []; let off = 0
  for (const g of spans) {
    for (let i = 0; i < g.count - 1; i++) edges.push([off + i, off + i + 1])
    if (g.loop && g.count > 2) edges.push([off + g.count - 1, off])
    off += g.count
  }
  return edges
}
const FACE_EDGES = buildFaceEdges(FACE_SPANS)

const FPS = 30
const Z_SCALE = 0.7   // profundidad (se lee mejor con la cámara en ángulo 3/4)
const LOOP_GAP_MS = 700   // pausa entre repeticiones al hacer loop

// ─── Preproceso de datos ────────────────────────────────────────────────────────
const isZeroPt = (p) => !p || (p[0] === 0 && p[1] === 0 && p[2] === 0)
const handAllZero = (arr) => !arr || arr.every(isZeroPt)
const anyHand = (frames, key) => frames.some((f) => !handAllZero(f[key]))

function fillHand(frames, key) {
  let last = null
  for (const f of frames) {
    if (!handAllZero(f[key])) last = f[key]
    else if (last) f[key] = last.map((p) => [...p])
  }
  last = null
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    if (!handAllZero(f[key])) last = f[key]
    else if (last) f[key] = last.map((p) => [...p])
  }
}

function smoothStream(frames, key, win) {
  const n = frames.length
  if (!n || !frames[0][key] || !frames[0][key].length) return
  const L = frames[0][key].length
  const h = Math.floor(win / 2)
  const out = frames.map(() => new Array(L))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < L; j++) {
      let sx = 0, sy = 0, sz = 0, c = 0
      for (let k = i - h; k <= i + h; k++) {
        if (k < 0 || k >= n) continue
        const p = frames[k][key][j]; sx += p[0]; sy += p[1]; sz += p[2]; c++
      }
      out[i][j] = [sx / c, sy / c, sz / c]
    }
  }
  for (let i = 0; i < n; i++) frames[i][key] = out[i]
}

// Recorta coordenadas fuera de rango (glitches de MediaPipe cuando una parte
// del cuerpo sale del cuadro) para que el esqueleto no se salga de cámara.
const clampPt = (p) => [
  Math.max(-0.3, Math.min(1.3, p[0])),
  Math.max(-0.3, Math.min(1.4, p[1])),
  Math.max(-1, Math.min(1, p[2])),
]

function preprocess(raw) {
  const frames = raw.map((f) => ({
    lh: f.lh, rh: f.rh,
    pose: f.pose.map(clampPt),
    face: (f.face || []).map(clampPt),
  }))
  const lhActive = anyHand(frames, 'lh')
  const rhActive = anyHand(frames, 'rh')
  if (lhActive) { fillHand(frames, 'lh'); smoothStream(frames, 'lh', 5) }
  if (rhActive) { fillHand(frames, 'rh'); smoothStream(frames, 'rh', 5) }
  smoothStream(frames, 'pose', 5)
  if (frames[0].face.length) smoothStream(frames, 'face', 3)
  return { frames, lhActive, rhActive, hasFace: frames[0].face.length > 0 }
}

const lerpArr = (a, b, t) =>
  a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t, p[2] + (b[i][2] - p[2]) * t])
const lerpFrame = (A, B, t) => ({
  lh: lerpArr(A.lh, B.lh, t), rh: lerpArr(A.rh, B.rh, t),
  pose: lerpArr(A.pose, B.pose, t), face: A.face.length ? lerpArr(A.face, B.face, t) : [],
})

// ─── Three.js ────────────────────────────────────────────────────────────────
function makeDots(count, color, size) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.95 }))
}
function makeLines(edgeCount, color, opacity) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeCount * 2 * 3), 3))
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
}
function setDots(points, list) {
  const a = points.geometry.attributes.position
  for (let i = 0; i < list.length; i++) { const [x, y, z] = list[i]; a.setXYZ(i, x, -y, z * Z_SCALE) }
  a.needsUpdate = true
}
function setDotsSubset(points, list, idxs) {
  const a = points.geometry.attributes.position
  for (let i = 0; i < idxs.length; i++) { const [x, y, z] = list[idxs[i]]; a.setXYZ(i, x, -y, z * Z_SCALE) }
  a.needsUpdate = true
}
function setLines(lines, list, edges) {
  const a = lines.geometry.attributes.position
  for (let i = 0; i < edges.length; i++) {
    const [u, v] = edges[i]; const A = list[u], B = list[v]
    a.setXYZ(i * 2, A[0], -A[1], A[2] * Z_SCALE)
    a.setXYZ(i * 2 + 1, B[0], -B[1], B[2] * Z_SCALE)
  }
  a.needsUpdate = true
}

const AvatarSigner3D = forwardRef(function AvatarSigner3D({ apiUrl, onSign, onFinish }, ref) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const cacheRef = useRef({})
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const timerRef = useRef(null)
  const loopTokensRef = useRef([])   // secuencia a repetir en bucle
  const loopTimerRef = useRef(null)  // pausa entre repeticiones
  const [status, setStatus] = useState('idle')
  const [everPlayed, setEverPlayed] = useState(false)

  const fetchAnim = useCallback(async (token) => {
    if (cacheRef.current[token]) return cacheRef.current[token]
    const res = await fetch(`${apiUrl}/sign/${token}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const proc = preprocess(data.frames)
    cacheRef.current[token] = proc
    return proc
  }, [apiUrl])

  // ─── Init escena ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const w = canvas.clientWidth, h = canvas.clientHeight
    renderer.setSize(w, h, false)

    const scene = new THREE.Scene()
    // Cámara en ángulo 3/4 (no de frente): así se percibe la profundidad.
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 10)
    camera.position.set(0.86, -0.48, 1.55)
    camera.lookAt(0.45, -0.5, 0)

    const faceLines = makeLines(FACE_EDGES.length, 0x9aa6bc, 0.85)
    const faceDots  = makeDots(124, 0xc7d0e0, 0.004)
    const poseLines = makeLines(POSE_CONNECTIONS.length, 0x8a94a8, 0.9)
    const poseDots  = makeDots(POSE_POINTS.length, 0xaab2c4, 0.018)
    const lhLines   = makeLines(HAND_CONNECTIONS.length, 0x6366f1, 0.95)
    const lhDots    = makeDots(21, 0xa5b4fc, 0.02)
    const rhLines   = makeLines(HAND_CONNECTIONS.length, 0x8b5cf6, 0.95)
    const rhDots    = makeDots(21, 0xc4b5fd, 0.02)

    scene.add(faceLines, faceDots, poseLines, poseDots, lhLines, lhDots, rhLines, rhDots)

    let animId
    const render = () => { animId = requestAnimationFrame(render); renderer.render(scene, camera) }
    render()

    sceneRef.current = { scene, camera, renderer, faceLines, faceDots, poseLines, poseDots, lhLines, lhDots, rhLines, rhDots }

    const onResize = () => {
      const w2 = canvas.clientWidth, h2 = canvas.clientHeight
      renderer.setSize(w2, h2, false); camera.aspect = w2 / h2; camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(animId); window.removeEventListener('resize', onResize)
      renderer.dispose(); sceneRef.current = null
    }
  }, [])

  const drawFrame = useCallback((f) => {
    const s = sceneRef.current
    if (!s) return
    if (s.faceDots.visible && f.face.length) { setDots(s.faceDots, f.face); setLines(s.faceLines, f.face, FACE_EDGES) }
    setDotsSubset(s.poseDots, f.pose, POSE_POINTS); setLines(s.poseLines, f.pose, POSE_CONNECTIONS)
    if (s.lhDots.visible) { setDots(s.lhDots, f.lh); setLines(s.lhLines, f.lh, HAND_CONNECTIONS) }
    if (s.rhDots.visible) { setDots(s.rhDots, f.rh); setLines(s.rhLines, f.rh, HAND_CONNECTIONS) }
  }, [])

  // Reproduce una animación procesada por TIEMPO (interpola entre frames → fluido)
  const playProcessed = useCallback((proc, onDone) => {
    const { frames } = proc
    if (!frames.length) { onDone(); return }

    let start = null
    let visSet = false
    const step = (now) => {
      const s = sceneRef.current
      if (!s) { timerRef.current = requestAnimationFrame(step); return }  // esperar init de escena
      if (!visSet) {
        s.lhDots.visible = s.lhLines.visible = proc.lhActive
        s.rhDots.visible = s.rhLines.visible = proc.rhActive
        s.faceDots.visible = s.faceLines.visible = proc.hasFace
        visSet = true
      }
      if (start === null) start = now
      const pos = ((now - start) / 1000) * FPS
      if (pos >= frames.length - 1) { drawFrame(frames[frames.length - 1]); onDone(); return }
      const i = Math.floor(pos), t = pos - i
      drawFrame(lerpFrame(frames[i], frames[i + 1], t))
      timerRef.current = requestAnimationFrame(step)
    }
    timerRef.current = requestAnimationFrame(step)
  }, [drawFrame])

  const processQueue = useCallback(async () => {
    if (playingRef.current) return
    if (queueRef.current.length === 0) {
      // Fin de la secuencia: si hay loop, reinicia tras una pausa; si no, termina.
      if (loopTokensRef.current.length) {
        setStatus('idle')
        loopTimerRef.current = setTimeout(() => {
          queueRef.current = [...loopTokensRef.current]
          processQueue()
        }, LOOP_GAP_MS)
        return
      }
      setStatus('idle'); onFinish?.(); return
    }
    playingRef.current = true
    const token = queueRef.current.shift()
    onSign?.(token)
    try {
      setStatus('loading')
      const proc = await fetchAnim(token)
      setStatus('playing')
      setEverPlayed(true)
      playProcessed(proc, () => { playingRef.current = false; processQueue() })
    } catch {
      playingRef.current = false
      processQueue()
    }
  }, [fetchAnim, playProcessed, onSign, onFinish])

  useImperativeHandle(ref, () => ({
    queue(token) { if (!token) return; queueRef.current.push(token); processQueue() },
    replace(tokens) {
      if (timerRef.current) cancelAnimationFrame(timerRef.current)
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current)
      playingRef.current = false
      loopTokensRef.current = [...(tokens || [])]   // repetir esta secuencia en bucle
      queueRef.current = [...(tokens || [])]
      processQueue()
    },
    clear() {
      if (timerRef.current) cancelAnimationFrame(timerRef.current)
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current)
      playingRef.current = false
      loopTokensRef.current = []
      queueRef.current = []
      setStatus('idle')
    },
  }), [processQueue])

  return (
    <div className="relative w-full h-full rounded-4xl overflow-hidden bg-white border border-white/90 shadow-soft">
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-signara-navy/50">Cargando animación…</span>
        </div>
      )}
      {status === 'idle' && !everPlayed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-signara-navy/35">Avatar 3D listo</span>
        </div>
      )}
    </div>
  )
})

export default AvatarSigner3D

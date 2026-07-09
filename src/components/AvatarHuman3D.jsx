/**
 * AvatarHuman3D  (Camino 2 — avatar humano)
 * Carga un modelo humano riggeado (GLB Mixamo) y lo anima con las MISMAS
 * animaciones de /sign/{token} usando Kalidokit (landmarks → rotaciones de hueso).
 *
 * Misma API imperativa que AvatarSigner3D (queue/replace/clear) → intercambiable.
 *
 * ⚠️ v1 / scaffold: el mapeo de ejes Kalidokit→Mixamo es aproximado y se afina
 * con las constantes FLIP_* de abajo (Kalidokit está calibrado para VRM).
 */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as Kalidokit from 'kalidokit'

const FPS = 30
const MODEL_URL = '/avatars/human.glb'
const LERP = 0.4          // suavizado al aplicar rotaciones a huesos
const DAMP = 0.9          // atenuación de la rotación

// Kalidokit produce rotaciones pensadas para VRM. Para el rig Mixamo se ajustan
// aquí (probar y cambiar signos si un brazo/dedo va al revés).
const FLIP_ARM = { x: 1, y: 1, z: 1 }
const FLIP_HAND = { x: 1, y: 1, z: 1 }

// ─── Mapa Kalidokit → huesos Mixamo ─────────────────────────────────────────────
const ARM_MAP = [
  ['LeftUpperArm', 'mixamorig:LeftArm'],
  ['LeftLowerArm', 'mixamorig:LeftForeArm'],
  ['RightUpperArm', 'mixamorig:RightArm'],
  ['RightLowerArm', 'mixamorig:RightForeArm'],
  ['Spine', 'mixamorig:Spine'],
]
function buildFingerMap(side) {
  const fingers = [['Thumb', 'Thumb'], ['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Little', 'Pinky']]
  const joints = [['Proximal', '1'], ['Intermediate', '2'], ['Distal', '3']]
  const map = { [`${side}Wrist`]: `mixamorig:${side}Hand` }
  for (const [kf, mf] of fingers)
    for (const [kj, mj] of joints)
      map[`${side}${kf}${kj}`] = `mixamorig:${side}Hand${mf}${mj}`
  return map
}
const HAND_MAP_L = buildFingerMap('Left')
const HAND_MAP_R = buildFingerMap('Right')

// ─── Preproceso de landmarks (igual que AvatarSigner3D) ─────────────────────────
const isZeroPt = (p) => !p || (p[0] === 0 && p[1] === 0 && p[2] === 0)
const handAllZero = (arr) => !arr || arr.every(isZeroPt)
const anyHand = (frames, key) => frames.some((f) => !handAllZero(f[key]))

function fillHand(frames, key) {
  let last = null
  for (const f of frames) { if (!handAllZero(f[key])) last = f[key]; else if (last) f[key] = last.map((p) => [...p]) }
  last = null
  for (let i = frames.length - 1; i >= 0; i--) { const f = frames[i]; if (!handAllZero(f[key])) last = f[key]; else if (last) f[key] = last.map((p) => [...p]) }
}
function smoothStream(frames, key, win) {
  const n = frames.length; if (!n || !frames[0][key] || !frames[0][key].length) return
  const L = frames[0][key].length, h = Math.floor(win / 2)
  const out = frames.map(() => new Array(L))
  for (let i = 0; i < n; i++) for (let j = 0; j < L; j++) {
    let sx = 0, sy = 0, sz = 0, c = 0
    for (let k = i - h; k <= i + h; k++) { if (k < 0 || k >= n) continue; const p = frames[k][key][j]; sx += p[0]; sy += p[1]; sz += p[2]; c++ }
    out[i][j] = [sx / c, sy / c, sz / c]
  }
  for (let i = 0; i < n; i++) frames[i][key] = out[i]
}
function preprocess(raw) {
  const frames = raw.map((f) => ({ lh: f.lh, rh: f.rh, pose: f.pose }))
  const lhActive = anyHand(frames, 'lh'), rhActive = anyHand(frames, 'rh')
  if (lhActive) { fillHand(frames, 'lh'); smoothStream(frames, 'lh', 5) }
  if (rhActive) { fillHand(frames, 'rh'); smoothStream(frames, 'rh', 5) }
  smoothStream(frames, 'pose', 5)
  return { frames, lhActive, rhActive }
}
const lerpArr = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t, p[2] + (b[i][2] - p[2]) * t])
const lerpFrame = (A, B, t) => ({ lh: lerpArr(A.lh, B.lh, t), rh: lerpArr(A.rh, B.rh, t), pose: lerpArr(A.pose, B.pose, t) })

const toObj = (arr) => arr.map(([x, y, z]) => ({ x, y, z }))

// ─── Aplicar rotaciones de Kalidokit a los huesos ───────────────────────────────
function rigBone(bones, name, rot, flip) {
  const bone = bones[name]
  if (!bone || !rot) return
  const e = new THREE.Euler((rot.x || 0) * DAMP * flip.x, (rot.y || 0) * DAMP * flip.y, (rot.z || 0) * DAMP * flip.z)
  bone.quaternion.slerp(new THREE.Quaternion().setFromEuler(e), LERP)
}
function applyRig(bones, rig, map, flip) {
  if (!rig) return
  for (const key in map) rigBone(bones, map[key], rig[key], flip)
}

const AvatarHuman3D = forwardRef(function AvatarHuman3D({ apiUrl, onSign, onFinish }, ref) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)          // { renderer, scene, camera, bones, restQuat }
  const cacheRef = useRef({})
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const timerRef = useRef(null)
  const [status, setStatus] = useState('loading')  // loading | idle | playing | error

  const fetchAnim = useCallback(async (token) => {
    if (cacheRef.current[token]) return cacheRef.current[token]
    const res = await fetch(`${apiUrl}/sign/${token}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const proc = preprocess(data.frames)
    cacheRef.current[token] = proc
    return proc
  }, [apiUrl])

  // ─── Init: escena + carga del modelo ───────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const w = canvas.clientWidth, h = canvas.clientHeight
    renderer.setSize(w, h, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100)
    camera.position.set(0, 1.45, 2.4)
    camera.lookAt(0, 1.35, 0)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1))
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(1.5, 3, 2)
    scene.add(dir)

    let animId
    const state = { renderer, scene, camera, bones: null, restQuat: null }
    sceneRef.current = state

    const render = () => { animId = requestAnimationFrame(render); renderer.render(scene, camera) }
    render()

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene
        model.traverse((o) => { if (o.isMesh) o.frustumCulled = false })
        model.position.set(0, 0, 0)
        scene.add(model)

        // Indexar huesos + guardar su rotación de reposo (para poder resetear)
        const bones = {}, restQuat = {}
        model.traverse((o) => {
          if (o.isBone || o.type === 'Bone') { bones[o.name] = o; restQuat[o.name] = o.quaternion.clone() }
        })
        state.bones = bones
        state.restQuat = restQuat
        setStatus('idle')
      },
      undefined,
      (err) => { console.error('[AvatarHuman3D] no se pudo cargar el modelo', err); setStatus('error') },
    )

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

  const resetPose = useCallback(() => {
    const s = sceneRef.current
    if (!s?.bones) return
    for (const name in s.restQuat) s.bones[name].quaternion.copy(s.restQuat[name])
  }, [])

  const applyFrame = useCallback((f, active) => {
    const s = sceneRef.current
    if (!s?.bones) return
    try {
      const pose = Kalidokit.Pose.solve(toObj(f.pose), toObj(f.pose), { runtime: 'mediapipe' })
      applyRig(s.bones, pose, Object.fromEntries(ARM_MAP), FLIP_ARM)
      if (active.lh) applyRig(s.bones, Kalidokit.Hand.solve(toObj(f.lh), 'Left'), HAND_MAP_L, FLIP_HAND)
      if (active.rh) applyRig(s.bones, Kalidokit.Hand.solve(toObj(f.rh), 'Right'), HAND_MAP_R, FLIP_HAND)
    } catch (e) { /* solve puntual puede fallar; ignorar ese frame */ }
  }, [])

  const playProcessed = useCallback((proc, onDone) => {
    const { frames } = proc
    if (!frames.length) { onDone(); return }
    const active = { lh: proc.lhActive, rh: proc.rhActive }
    let start = null
    const step = (now) => {
      const s = sceneRef.current
      if (!s?.bones) { timerRef.current = requestAnimationFrame(step); return }
      if (start === null) start = now
      const pos = ((now - start) / 1000) * FPS
      if (pos >= frames.length - 1) { applyFrame(frames[frames.length - 1], active); onDone(); return }
      const i = Math.floor(pos), t = pos - i
      applyFrame(lerpFrame(frames[i], frames[i + 1], t), active)
      timerRef.current = requestAnimationFrame(step)
    }
    timerRef.current = requestAnimationFrame(step)
  }, [applyFrame])

  const processQueue = useCallback(async () => {
    if (playingRef.current) return
    if (queueRef.current.length === 0) { setStatus('idle'); onFinish?.(); return }
    playingRef.current = true
    const token = queueRef.current.shift()
    onSign?.(token)
    try {
      const proc = await fetchAnim(token)
      setStatus('playing')
      playProcessed(proc, () => { playingRef.current = false; processQueue() })
    } catch { playingRef.current = false; processQueue() }
  }, [fetchAnim, playProcessed, onSign, onFinish])

  useImperativeHandle(ref, () => ({
    queue(token) { if (!token) return; queueRef.current.push(token); processQueue() },
    replace(tokens) {
      if (timerRef.current) cancelAnimationFrame(timerRef.current)
      playingRef.current = false
      resetPose()
      queueRef.current = [...(tokens || [])]
      processQueue()
    },
    clear() {
      if (timerRef.current) cancelAnimationFrame(timerRef.current)
      playingRef.current = false
      queueRef.current = []
      resetPose()
      setStatus('idle')
    },
  }), [processQueue, resetPose])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-4xl border border-white/90 shadow-soft"
      style={{ background: 'radial-gradient(120% 95% at 50% 12%, #F1EEFB 0%, #FBFAFE 55%, #F4F1FA 100%)' }}>
      <canvas ref={canvasRef} className="h-full w-full" style={{ display: 'block' }} />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-signara-navy/50">Cargando avatar…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center pointer-events-none">
          <span className="text-xs text-signara-navy/50">No se pudo cargar el avatar 3D (public/avatars/human.glb)</span>
        </div>
      )}
    </div>
  )
})

export default AvatarHuman3D

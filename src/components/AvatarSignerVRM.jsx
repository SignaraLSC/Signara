/**
 * AvatarSignerVRM
 * Reproduce animaciones de señas grabadas con 00_capture.py, servidas por la
 * API ML en /sign/{token}, sobre un avatar VRM humanoide (en vez del
 * esqueleto de puntos que usaba el AvatarSigner3D anterior). Toda la lógica
 * de conversión landmarks → huesos (solver geométrico, IK de brazo, evitar
 * torso, orientación de muñeca desde 21 landmarks, dedos, cabeza) viene del
 * laboratorio `public/vrm-lab/`, portada a src/utils/vrmSolver.js +
 * vrmBaker.js + vrmPlayer.js.
 *
 * API imperativa (via ref): queue(token) · replace([tokens]) · clear()
 * — igual contrato que el componente anterior, para no tocar TranslationScreen.
 */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import { setIdlePose } from '../utils/vrmIdlePose.js'
import { createBaker } from '../utils/vrmBaker.js'
import { playSolverAnim } from '../utils/vrmPlayer.js'
import { parsePlayToken } from '../utils/directionalVerbs.js'

const AVATAR_URL = '/avatar/signara-avatar.vrm'
// Subir esto invalida el cache en memoria tras cambios del baker (SED/cuello, etc.).
const BAKE_CACHE_VER = 54 // PERDON: no inventar pila de manos
/** @type {Record<string, unknown>} */
const sharedBakeCache = {}
/** @type {Record<string, unknown>} */
const sharedDatasetCache = {}

// Señales frecuentes: hornear en idle para que la 1ª reproducción no espere bake.
const PREFETCH_TOKENS = [
  'HOLA', 'SI', 'NO', 'GRACIAS', 'POR_FAVOR', 'TENGO_SED', 'BIEN', 'MAL',
  'COMO_ESTAS', 'DE_NADA', 'ADIOS', 'SCOOBA', 'TE_AMO',
]

const AvatarSignerVRM = forwardRef(function AvatarSignerVRM({ apiUrl, onSign, onFinish }, ref) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const vrmRef = useRef(null)
  const bakerRef = useRef(null)
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const cancelPlayRef = useRef(null)
  const [avatarReady, setAvatarReady] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  // citationToken: la grabación real en el servidor (una sola por verbo,
  // sin importar la dirección) — 'AYUDAR::self' y 'AYUDAR' piden el MISMO
  // /sign/AYUDAR y comparten caché de dataset; solo el HORNEADO difiere.
  const fetchDataset = useCallback(async (citationToken) => {
    if (sharedDatasetCache[citationToken]) return sharedDatasetCache[citationToken]
    const res = await fetch(`${apiUrl}/sign/${citationToken}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    sharedDatasetCache[citationToken] = data
    return data
  }, [apiUrl])

  // ─── Init escena + carga del VRM ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    // Nitidez en card: antialias + pixelRatio hasta 2 (el blur venía de
    // forzar 1× sin AA en pantallas HiDPI).
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    const w = canvas.clientWidth, h = canvas.clientHeight
    renderer.setSize(w, h, false)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 20)

    // Cámara fija — encuadre cerrado a medio cuerpo (pecho/cara), no de
    // cuerpo entero, para que la seña se vea grande y clara.
    const target = new THREE.Vector3(0, 1.3, 0)
    const R = 1.85
    camera.position.set(target.x, target.y + 0.05, target.z + R)
    camera.lookAt(target)

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const key = new THREE.DirectionalLight(0xfff5e8, 1.0)
    key.position.set(1.5, 3, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35)
    fill.position.set(-3, 1, -2)
    scene.add(fill)

    sceneRef.current = { scene, camera, renderer }

    let lastMs = performance.now()
    let animId
    let lastDrawMs = 0
    const render = (nowMs) => {
      animId = requestAnimationFrame(render)
      // Idle ~20 fps; al reproducir seña, full rAF.
      const playing = playingRef.current
      if (!playing && nowMs - lastDrawMs < 50) return
      lastDrawMs = nowMs
      const dt = (nowMs - lastMs) / 1000
      lastMs = nowMs
      if (vrmRef.current) vrmRef.current.update(dt)
      renderer.render(scene, camera)
    }
    animId = requestAnimationFrame(render)

    THREE.Cache.enabled = true
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.loadAsync(AVATAR_URL).then((gltf) => {
      if (cancelled) return
      const vrm = gltf.userData.vrm
      vrm.scene.traverse((obj) => {
        if (obj.isMesh) {
          obj.frustumCulled = true
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
            for (const m of mats) {
              if (m) m.toneMapped = false
            }
          }
        }
      })
      scene.add(vrm.scene)
      setIdlePose(vrm)
      vrmRef.current = vrm
      bakerRef.current = createBaker(vrm)
      setAvatarReady(true)
    }).catch((e) => {
      console.error(e)
      if (!cancelled) setAvatarError(true)
    })

    const onResize = () => {
      const w2 = canvas.clientWidth, h2 = canvas.clientHeight
      if (!w2 || !h2) return
      renderer.setSize(w2, h2, false)
      camera.aspect = w2 / h2
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      sceneRef.current = null
      vrmRef.current = null
      bakerRef.current = null
    }
  }, [])

  // Precarga bake de señas frecuentes en idle (sin mensaje en UI).
  useEffect(() => {
    if (!avatarReady || !bakerRef.current) return
    let cancelled = false
    ;(async () => {
      for (const token of PREFETCH_TOKENS) {
        if (cancelled) return
        const key = `${BAKE_CACHE_VER}:${token}`
        if (sharedBakeCache[key]) continue
        try {
          const dataset = await fetchDataset(token) // tokens de prefetch son siempre formas neutras
          if (cancelled || !bakerRef.current) return
          sharedBakeCache[key] = bakerRef.current.bakeSolver(dataset)
        } catch {
          // Token no disponible en esta API — seguir con el resto.
        }
        // Ceder un frame entre bakes para no congelar la UI.
        await new Promise((r) => requestAnimationFrame(r))
      }
    })()
    return () => { cancelled = true }
  }, [avatarReady, fetchDataset])

  const processQueue = useCallback(async () => {
    if (playingRef.current) return
    if (queueRef.current.length === 0) { onFinish?.(); return }
    if (!vrmRef.current || !bakerRef.current) return
    playingRef.current = true
    const token = queueRef.current.shift() // ej. 'AYUDAR' o 'AYUDAR::self'
    onSign?.(token)
    try {
      // El horneado SÍ depende de la dirección (misma grabación, distinto
      // resultado) — la caché de bake usa el token COMPUESTO completo.
      const { citationToken, direction } = parsePlayToken(token)
      const key = `${BAKE_CACHE_VER}:${token}`
      let keyframes = sharedBakeCache[key]
      if (!keyframes) {
        const dataset = await fetchDataset(citationToken)
        keyframes = bakerRef.current.bakeSolver(dataset, { direction })
        sharedBakeCache[key] = keyframes
      }
      setIdlePose(vrmRef.current)
      cancelPlayRef.current = playSolverAnim(vrmRef.current, keyframes, () => {
        playingRef.current = false
        processQueue()
      })
    } catch (e) {
      console.error(e)
      playingRef.current = false
      processQueue()
    }
  }, [fetchDataset, onSign, onFinish])

  useEffect(() => {
    if (avatarReady && queueRef.current.length && !playingRef.current) processQueue()
  }, [avatarReady, processQueue])

  useImperativeHandle(ref, () => ({
    queue(token) { if (!token) return; queueRef.current.push(token); processQueue() },
    replace(tokens) {
      if (cancelPlayRef.current) cancelPlayRef.current()
      playingRef.current = false
      queueRef.current = [...(tokens || [])]
      processQueue()
    },
    clear() {
      if (cancelPlayRef.current) cancelPlayRef.current()
      playingRef.current = false
      queueRef.current = []
      if (vrmRef.current) setIdlePose(vrmRef.current)
    },
  }), [processQueue])

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      <canvas ref={canvasRef} className="h-full w-full" style={{ display: 'block' }} />
      {!avatarReady && !avatarError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-pastel-sub">Cargando avatar…</span>
        </div>
      )}
      {avatarError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-pastel-pink">No se pudo cargar el avatar 3D</span>
        </div>
      )}
    </div>
  )
})

export default AvatarSignerVRM

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
import { bakePreservingPose, playSolverAnim } from '../utils/vrmPlayer.js'
import { parsePlayToken } from '../utils/directionalVerbs.js'
import { isLetterToken } from '../utils/fingerspell.js'

const AVATAR_URL = '/avatar/signara-avatar.vrm'
// Subir esto invalida el cache en memoria tras cambios del baker (SED/cuello, etc.).
const BAKE_CACHE_VER = 310 // empalme de frases con pose sostenida y salida diferida
const PHRASE_HOLD_MS = 650
const LIVE_PHRASE_HOLD_MS = 1300
/** LL / RR: misma forma, rebote al FRENTE en UNA sola mano (se leen 2 letras). */
const SPELL_BOUNCE_FWD_MS = 140
const SPELL_BOUNCE_BACK_MS = 120
const SPELL_BOUNCE_AMOUNT = 0.32

/** Mano que lleva la letra (la otra no se toca). */
function spellActiveSide(pose) {
  if (!pose) return 'right'
  if (pose.rightIndexProximal || pose.rightMiddleProximal || pose.rightThumbProximal) return 'right'
  if (pose.leftIndexProximal || pose.leftMiddleProximal || pose.leftThumbProximal) return 'left'
  if (pose.rightHand || pose.rightUpperArm) return 'right'
  if (pose.leftHand || pose.leftUpperArm) return 'left'
  return 'right'
}

/** Rebote al frente (misma L) y vuelta — solo la mano activa. */
function bounceLetterPose(pose, amount = SPELL_BOUNCE_AMOUNT) {
  if (!pose) return pose
  const side = spellActiveSide(pose)
  const out = { ...pose }
  const u = pose[`${side}UpperArm`]
  const l = pose[`${side}LowerArm`]
  const signY = side === 'right' ? -1 : 1
  if (u) {
    out[`${side}UpperArm`] = {
      x: (u.x || 0) - amount * 0.28,
      y: (u.y || 0) + signY * amount * 0.1,
      z: (u.z || 0) + amount * 0.45,
    }
  }
  if (l) {
    out[`${side}LowerArm`] = {
      x: (l.x || 0) - amount * 0.18,
      y: l.y || 0,
      z: (l.z || 0) + amount * 0.28,
    }
  }
  return out
}
/** @type {Record<string, unknown>} */
const sharedBakeCache = {}
/** @type {Record<string, unknown>} */
const sharedDatasetCache = {}
const sharedDatasetPending = {}

// Señales frecuentes: hornear en idle para que la 1ª reproducción no espere bake.
const PREFETCH_TOKENS = [
  'HOLA', 'SI', 'NO', 'GRACIAS', 'POR_FAVOR', 'TENGO_SED', 'BIEN', 'MAL',
  'COMO_ESTAS', 'DE_NADA', 'ADIOS', 'SCOOBA', 'TE_AMO',
]

function tokenIsLetter(token) {
  return isLetterToken(parsePlayToken(token).citationToken)
}

const AvatarSignerVRM = forwardRef(function AvatarSignerVRM({ apiUrl, onSign, onFinish, live = false }, ref) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const vrmRef = useRef(null)
  const bakerRef = useRef(null)
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const cancelPlayRef = useRef(null)
  const releaseTimerRef = useRef(null)
  const releasingRef = useRef(false)
  const activeTokenRef = useRef(null)
  const generationRef = useRef(0)
  const finishedRef = useRef(true)
  const liveRef = useRef(live)
  liveRef.current = live
  const [avatarReady, setAvatarReady] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  // citationToken: la grabación real en el servidor (una sola por verbo,
  // sin importar la dirección) — 'AYUDAR::self' y 'AYUDAR' piden el MISMO
  // /sign/AYUDAR y comparten caché de dataset; solo el HORNEADO difiere.
  const fetchDataset = useCallback(async (citationToken) => {
    const dkey = `${BAKE_CACHE_VER}:${apiUrl}:${citationToken}`
    if (sharedDatasetCache[dkey]) return sharedDatasetCache[dkey]
    if (sharedDatasetPending[dkey]) return sharedDatasetPending[dkey]
    sharedDatasetPending[dkey] = fetch(`${apiUrl}/sign/${encodeURIComponent(citationToken)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        sharedDatasetCache[dkey] = data
        return data
      })
      .finally(() => { delete sharedDatasetPending[dkey] })
    return sharedDatasetPending[dkey]
  }, [apiUrl])

  const warmDataset = useCallback((token) => {
    const { citationToken } = parsePlayToken(token)
    const cite = String(citationToken || '').toUpperCase().normalize('NFC')
    const motionToken = cite === 'M' ? 'N' : cite === 'O' ? 'D' : citationToken
    void fetchDataset(motionToken).catch(() => {})
    if (cite === 'Ñ') void fetchDataset('N').catch(() => {})
  }, [fetchDataset])

  // ─── Init escena + carga del VRM ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const playbackGeneration = generationRef
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

    const root = canvas.parentElement
    const onResize = () => {
      const box = root || canvas
      const w2 = Math.max(1, Math.floor(box.clientWidth))
      const h2 = Math.max(1, Math.floor(box.clientHeight))
      renderer.setSize(w2, h2, false)
      camera.aspect = w2 / h2
      camera.updateProjectionMatrix()
    }
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => onResize())
      : null
    if (ro) ro.observe(root || canvas)
    else window.addEventListener('resize', onResize)
    requestAnimationFrame(onResize)
    return () => {
      cancelled = true
      playbackGeneration.current++
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
      cancelPlayRef.current?.()
      cancelPlayRef.current = null
      playingRef.current = false
      releasingRef.current = false
      activeTokenRef.current = null
      cancelAnimationFrame(animId)
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', onResize)
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
        const key = `${BAKE_CACHE_VER}:${apiUrl}:${token}:phrase-start`
        if (sharedBakeCache[key]) continue
        try {
          const dataset = await fetchDataset(token) // tokens de prefetch son siempre formas neutras
          if (cancelled || !bakerRef.current) return
          // El baker usa el rig real. No interrumpir un clip ni el sostén
          // entre señas para preparar una animación futura.
          if (!playingRef.current && !activeTokenRef.current && !queueRef.current.length) {
            sharedBakeCache[key] = bakePreservingPose(
              vrmRef.current,
              () => bakerRef.current.bakeSolver(dataset, { chain: 'phrase-start' }),
            )
          }
        } catch {
          // Token no disponible en esta API — seguir con el resto.
        }
        // Ceder un frame entre bakes para no congelar la UI.
        await new Promise((r) => requestAnimationFrame(r))
      }
    })()
    return () => { cancelled = true }
  }, [avatarReady, apiUrl, fetchDataset])

  const bakeCached = useCallback(async (token, chain) => {
    const { citationToken, direction } = parsePlayToken(token)
    const key = `${BAKE_CACHE_VER}:${apiUrl}:${token}:${chain}`
    if (sharedBakeCache[key]) return sharedBakeCache[key]
    // Ñ: movimiento Ñ.json + mano de N.
    // M: movimiento de N.json + mano N con 3 dedos (anular = corazón).
    // O: círculo de D.json + mano O (como D sin dedo alzado).
    const cite = String(citationToken || '').toUpperCase().normalize('NFC')
    const motionToken = cite === 'M' ? 'N' : cite === 'O' ? 'D' : citationToken
    const dataset = await fetchDataset(motionToken)
    const handShapeDataset = (cite === 'Ñ' || cite === 'M') ? await fetchDataset('N') : null
    const bakeTok = (cite === 'Ñ' || cite === 'M' || cite === 'O') ? cite : citationToken
    const keyframes = bakePreservingPose(vrmRef.current, () => bakerRef.current.bakeSolver(dataset, {
      direction,
      chain,
      token: bakeTok,
      handShapeDataset,
    }))
    sharedBakeCache[key] = keyframes
    return keyframes
  }, [apiUrl, fetchDataset])

  /**
   * Deletreo: consume TODA la corrida de letras y la reproduce como UN solo
   * clip — sube desde idle una vez, morph entre letras (manos arriba), baja
   * al idle solo al final. Letras repetidas (LL, RR…) hacen un rebote en
   * la misma mano (como hacer la seña 2 veces) para leerse como dos letras.
   */
  const bakeSpellRun = useCallback(async (run, follow) => {
    if (run.length === 1) return bakeCached(run[0], follow ? 'phrase-follow' : 'phrase-start')

    const stitched = []
    stitched.push(...(await bakeCached(run[0], follow ? 'phrase-follow' : 'phrase-start')))

    for (let i = 1; i < run.length; i++) {
      const sameAsPrev = String(run[i]).toUpperCase() === String(run[i - 1]).toUpperCase()
      const chain = sameAsPrev ? 'hold' : 'middle'
      const kfs = await bakeCached(run[i], chain)
      if (!kfs?.length) continue

      if (sameAsPrev) {
        const pose = kfs[0].pose
        // Rebote al frente → vuelta (2ª L), solo la mano de la letra.
        stitched.push({ duration: SPELL_BOUNCE_FWD_MS, pose: bounceLetterPose(pose) })
        stitched.push({ duration: SPELL_BOUNCE_BACK_MS, pose: { ...pose } })
        if (kfs.length > 1) stitched.push(...kfs.slice(1))
        else stitched.push({ duration: kfs[0].duration, pose: { ...pose } })
        continue
      }

      stitched.push(...kfs)
    }
    return stitched
  }, [bakeCached])

  const interruptPlayback = useCallback(() => {
    generationRef.current++
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = null
    cancelPlayRef.current?.()
    cancelPlayRef.current = null
    playingRef.current = false
    releasingRef.current = false
  }, [])

  const processQueue = useCallback(async () => {
    if (playingRef.current || !vrmRef.current || !bakerRef.current) return

    if (queueRef.current.length === 0) {
      if (!activeTokenRef.current) {
        if (!finishedRef.current) {
          finishedRef.current = true
          onFinish?.()
        }
        return
      }
      if (releaseTimerRef.current) return
      // La voz puede entregar la siguiente palabra mientras termina esta.
      // Conservar las manos arriba un instante y salir a reposo solo si no llega.
      const generation = generationRef.current
      releaseTimerRef.current = setTimeout(async () => {
        releaseTimerRef.current = null
        if (generation !== generationRef.current) return
        if (queueRef.current.length) { processQueue(); return }
        playingRef.current = true
        releasingRef.current = true
        try {
          const release = await bakeCached(activeTokenRef.current, 'phrase-release')
          if (generation !== generationRef.current || !vrmRef.current) return
          cancelPlayRef.current = playSolverAnim(vrmRef.current, release, () => {
            if (generation !== generationRef.current) return
            cancelPlayRef.current = null
            playingRef.current = false
            releasingRef.current = false
            activeTokenRef.current = null
            processQueue()
          })
        } catch (error) {
          if (generation !== generationRef.current) return
          console.error(error)
          setIdlePose(vrmRef.current)
          playingRef.current = false
          releasingRef.current = false
          activeTokenRef.current = null
          processQueue()
        }
      }, liveRef.current ? LIVE_PHRASE_HOLD_MS : PHRASE_HOLD_MS)
      return
    }

    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = null
    playingRef.current = true
    const generation = generationRef.current
    const follow = Boolean(activeTokenRef.current)
    const token = queueRef.current.shift()
    let lastToken = token

    try {
      let keyframes
      if (tokenIsLetter(token)) {
        const run = [token]
        while (queueRef.current.length && tokenIsLetter(queueRef.current[0])) {
          run.push(queueRef.current.shift())
        }
        lastToken = run[run.length - 1]
        onSign?.(run.length > 1 ? run.join('-') : token)
        keyframes = await bakeSpellRun(run, follow)
      } else {
        onSign?.(token)
        keyframes = await bakeCached(token, follow ? 'phrase-follow' : 'phrase-start')
      }
      if (generation !== generationRef.current || !vrmRef.current) return
      activeTokenRef.current = lastToken
      cancelPlayRef.current = playSolverAnim(vrmRef.current, keyframes, () => {
        if (generation !== generationRef.current) return
        cancelPlayRef.current = null
        playingRef.current = false
        processQueue()
      })
    } catch (error) {
      if (generation !== generationRef.current) return
      console.error(error)
      playingRef.current = false
      processQueue()
    }
  }, [bakeCached, bakeSpellRun, onSign, onFinish])

  useEffect(() => {
    if (avatarReady && queueRef.current.length && !playingRef.current) processQueue()
  }, [avatarReady, processQueue])

  useImperativeHandle(ref, () => ({
    // Microtask: si encolan varias letras seguidas (deletreo), se acumulan
    // en la cola ANTES de processQueue — así se cosen en un solo clip.
    queue(token) {
      if (!token) return
      if (releasingRef.current) interruptPlayback()
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
      finishedRef.current = false
      queueRef.current.push(token)
      warmDataset(token)
      queueMicrotask(() => { if (!playingRef.current) processQueue() })
    },
    replace(tokens) {
      interruptPlayback()
      queueRef.current = [...(tokens || [])]
      queueRef.current.forEach(warmDataset)
      finishedRef.current = !queueRef.current.length
      if (!queueRef.current.length) {
        activeTokenRef.current = null
        if (vrmRef.current) setIdlePose(vrmRef.current)
        return
      }
      processQueue()
    },
    clear() {
      interruptPlayback()
      queueRef.current = []
      activeTokenRef.current = null
      finishedRef.current = true
      if (vrmRef.current) setIdlePose(vrmRef.current)
    },
  }), [interruptPlayback, processQueue, warmDataset])

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

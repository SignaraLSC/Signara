import { useEffect, useRef, useState, useCallback } from 'react'
import { ResetButton, SectionLabel } from './AppShell.jsx'
import ModeTutorial, { TutorialHelpButton } from './ModeTutorial.jsx'
import Icon from './Icon.jsx'
import {
  AppPage,
  AppPageFooter,
  AppPageHeader,
  AppPageHeading,
  AppPageMain,
  AppPagePanel,
  AppPageStagger,
} from './PageMotion.jsx'
import { INTERPRET_TUTORIAL_STEPS } from '../data/modeTutorialSteps.js'
import { useModeTutorial } from '../hooks/useModeTutorial.js'
import { ML_API_URL, checkMlApiHealth, getMlApiCache } from '../utils/mlApi.js'

const MEDIAPIPE_HOLISTIC_VER = '0.5.1675471629'
const MEDIAPIPE_CAM_VER      = '0.3.1675466862'
const MEDIAPIPE_DRAW_VER     = '0.3.1675466124'

const MP_SCRIPTS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@${MEDIAPIPE_HOLISTIC_VER}/holistic.js`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@${MEDIAPIPE_CAM_VER}/camera_utils.js`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@${MEDIAPIPE_DRAW_VER}/drawing_utils.js`,
]

// ── Parámetros (alineados con sign_ai/07_gnn_predict.py) ─────────────────────
// SEQ_LEN debe coincidir exactamente con sign_ai/core/gnn_model.SEQ_LEN y
// sign_ai/core/config.SEQ_LEN — si no coinciden, /predict rechaza el shape.
// Bajado de 40 a 24 (validado: misma val acc, 97.8%, con datos reales) para
// que Interpretar reconozca ~40% más rápido sin perder precisión.
const SEQ_LEN        = 24
const HAND_COUNT     = 21
const UMBRAL         = 0.75
const STABILITY_NEED = 3
const NO_HAND_RESET  = 12
// Tolerancia a pérdida MOMENTÁNEA de tracking (parpadeo típico de MediaPipe
// en medio de un gesto rápido). Sin esto, un solo frame sin manos detectadas
// vaciaba el buffer entero y obligaba a reiniciar la seña desde cero — por
// eso la primera seña (hecha con más cuidado/lentitud) se reconocía rápido
// y las siguientes parecían "esperar hasta 24": en realidad se reiniciaban
// varias veces hasta que por casualidad el tracking aguantaba sin cortes.
const NO_HAND_GRACE  = 4
const SAME_SIGN_WAIT = 30
const MIN_FRAMES     = 8

// ── Detección de FIN DE SEÑA (predecir al terminar, no en un conteo fijo) ────
// El problema con un umbral fijo de "quietud": los landmarks de MediaPipe
// tiemblan, así que una mano quieta registra micro-movimiento que reinicia el
// contador y nunca se detecta el final. Solución: umbral ADAPTATIVO relativo
// al pico de movimiento de ESTA seña. Se considera "detenido" cuando el
// movimiento cae por debajo de STOP_FRAC del pico (o por debajo de un piso
// absoluto), durante STOP_FRAMES frames seguidos, y solo si antes hubo un
// gesto real (el pico superó MOVED_MIN). Así funciona con señas rápidas o
// lentas y no se engaña con el tembleque.
const STOP_FRAMES = 3      // frames consecutivos "detenido" para confirmar el fin
const STOP_FRAC   = 0.4    // detenido si el movimiento < 40% del pico de la seña
const STOP_ABS    = 0.006  // …o por debajo de este piso absoluto (mano casi quieta)
const MOVED_MIN   = 0.012  // el pico debe superar esto para contar como "hubo seña"

// Predicción en vivo (respaldo): si el gesto sigue en movimiento continuo sin
// detenerse, se evalúa la ventana completa igual (con el control de estabilidad
// de 3 predicciones seguidas, que evita confirmar de más).
const LIVE_MIN_FRAMES = SEQ_LEN

// Conexiones MediaPipe para dibujar el esqueleto de la mano (no viene en drawing_utils).
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
].map(([start, end]) => ({ start, end }))

// ── Script loader ─────────────────────────────────────────────────────────────

function loadScript(url) {
  return new Promise((resolve, reject) => {
    let s = document.querySelector(`script[data-signara="${url}"]`)
    if (s) {
      if (s.getAttribute('data-loaded') === 'true') return resolve()
      s.addEventListener('load', resolve)
      s.addEventListener('error', () => reject(new Error('Failed: ' + url)))
      return
    }
    s = document.createElement('script')
    s.src = url; s.async = true; s.crossOrigin = 'anonymous'
    s.dataset.signara = url
    s.addEventListener('load', () => { s.setAttribute('data-loaded', 'true'); resolve() })
    s.addEventListener('error', () => reject(new Error('Failed: ' + url)))
    document.head.appendChild(s)
  })
}

async function loadMediaPipe() {
  for (const url of MP_SCRIPTS) await loadScript(url)
}

// ── Extracción de landmarks ───────────────────────────────────────────────────
//
// CORRECCIÓN DE ESPEJO:
// Python hace cv2.flip(frame,1) ANTES de MediaPipe → landmarks tienen x espejado.
// El navegador pasa el frame crudo (sin flip) a MediaPipe.
// Fix: x = 1 - x  +  swap left↔right (en frame crudo, la mano derecha anatómica
// aparece a la izquierda → leftHandLandmarks; en frame flipado aparece a la derecha
// → right_hand_landmarks).
//
// Resultado: slot lh (primeros 63) = mano izquierda anatómica de la persona
//            slot rh (últimos 63)  = mano derecha anatómica de la persona
// Igual que en el entrenamiento.

function extractLandmarks(results) {
  const handCoords = (landmarks) => {
    const arr = new Array(HAND_COUNT * 3).fill(0)
    if (landmarks && landmarks.length > 0) {
      const n = Math.min(landmarks.length, HAND_COUNT)
      for (let i = 0; i < n; i++) {
        arr[i * 3]     = 1.0 - (landmarks[i]?.x ?? 0)  // flip x (espejo Python)
        arr[i * 3 + 1] = landmarks[i]?.y ?? 0
        arr[i * 3 + 2] = landmarks[i]?.z ?? 0
      }
    }
    return arr
  }
  // Swap: rightHandLandmarks del navegador = mano izq anatómica → slot lh
  //       leftHandLandmarks  del navegador = mano der anatómica → slot rh
  return [
    ...handCoords(results.rightHandLandmarks),  // slot lh (primeros 63)
    ...handCoords(results.leftHandLandmarks),   // slot rh (últimos 63)
  ]
}

// Ajusta el buffer a exactamente SEQ_LEN frames para /predict.
//  - Si sobran: se queda con los últimos SEQ_LEN.
//  - Si faltan: REMUESTREA (interpola linealmente) la secuencia real a SEQ_LEN,
//    en vez de rellenar repitiendo un frame. Así una seña corta se "estira"
//    suavemente a la longitud que el modelo espera, conservando su forma real
//    (el relleno viejo creaba un tramo congelado al inicio que no se parecía a
//    ninguna muestra de entrenamiento).
function padBuffer(buffer) {
  const n = buffer.length
  if (n >= SEQ_LEN) return buffer.slice(-SEQ_LEN)
  if (n === 0) return buffer
  if (n === 1) return Array.from({ length: SEQ_LEN }, () => buffer[0])
  const out = new Array(SEQ_LEN)
  for (let i = 0; i < SEQ_LEN; i++) {
    const t  = (i * (n - 1)) / (SEQ_LEN - 1)  // posición en 0..n-1
    const lo = Math.floor(t)
    const hi = Math.min(lo + 1, n - 1)
    const f  = t - lo
    const a  = buffer[lo], b = buffer[hi]
    out[i] = a.map((v, k) => v + (b[k] - v) * f)
  }
  return out
}

// Movimiento medio (x,y) entre dos frames — igual que mov_entre() en
// 07_gnn_predict.py. Sin frame previo se considera "sin movimiento" (0),
// igual que el script de referencia (evita un salto espurio al reaparecer
// la mano). 42 landmarks × [x,y,z] → compara solo x,y, ignora z.
function frameMovement(prev, curr) {
  if (!prev) return 0
  let sum = 0
  for (let i = 0; i < curr.length; i += 3) {
    sum += Math.abs(curr[i] - prev[i]) + Math.abs(curr[i + 1] - prev[i + 1])
  }
  return sum / ((curr.length / 3) * 2)
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function InterpretScreen({ onBack, onHome }) {
  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const holisticRef  = useRef(null)
  const cameraRef    = useRef(null)
  const runningRef   = useRef(false)
  const audioRef     = useRef(true)

  // Pipeline refs (sin re-render)
  const landmarkBufferRef = useRef([])   // frames con movimiento, maxlen=SEQ_LEN
  const predHistRef       = useRef([])   // historial de predicciones para estabilidad
  const prevFrameRef      = useRef(null) // frame anterior para calcular movimiento
  const noHandCountRef    = useRef(0)    // frames consecutivos sin manos
  const stillCountRef     = useRef(0)    // frames consecutivos "detenido" (mano visible)
  const peakMovementRef   = useRef(0)    // pico de movimiento de la seña en curso (umbral adaptativo)
  const cooldownRef       = useRef(0)    // cooldown frame-based
  const lastSignRef       = useRef('')   // última seña confirmada (evita repetir)
  const apiInFlightRef    = useRef(false)
  const mlAvailableRef    = useRef(false)
  const sentenceClearRef  = useRef(null)
  const handleResultsRef  = useRef(() => {})
  const handWasVisibleRef = useRef(false)
  const handVisibleRef      = useRef(false)
  const inCooldownRef       = useRef(false)
  const bufferHudRef        = useRef(null)
  const bufferBarRef        = useRef(null)
  const bufferTextRef       = useRef(null)
  const statusTextRef       = useRef(null)

  // UI state
  const [scriptsLoaded, setScriptsLoaded] = useState(false)
  const [scriptsError,  setScriptsError]  = useState(null)
  const [cameraConsent, setCameraConsent] = useState(null)
  const [cameraRetryKey, setCameraRetryKey] = useState(0)
  const [cameraOk,      setCameraOk]      = useState(false)
  const [cameraError,   setCameraError]   = useState(null)
  const [running,       setRunning]       = useState(false)
  const [mlMode,        setMlMode]        = useState(false)
  const [mlConnecting,  setMlConnecting]  = useState(false)
  const [audioOn,       setAudioOn]       = useState(true)
  const [handVisible,   setHandVisible]   = useState(false)
  const [bufferLen,     setBufferLen]     = useState(0)
  const [inCooldown,    setInCooldown]    = useState(false)
  const [displaySign,   setDisplaySign]   = useState('')
  const [displayConf,   setDisplayConf]   = useState(0)
  const [latest,        setLatest]        = useState(null)
  const [history,       setHistory]       = useState([])
  const [sentence,      setSentence]      = useState([])

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { audioRef.current   = audioOn  }, [audioOn])

  // ── Verificar API ML ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const cached = getMlApiCache()

    if (cached) {
      mlAvailableRef.current = cached.ok
      setMlMode(cached.ok)
      setMlConnecting(false)
    } else {
      setMlConnecting(true)
    }

    checkMlApiHealth().then((result) => {
      if (cancelled) return
      mlAvailableRef.current = result.ok
      setMlMode(result.ok)
      setMlConnecting(false)
    })

    return () => { cancelled = true }
  }, [])

  // ── Cargar MediaPipe ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    loadMediaPipe()
      .then(() => { if (!cancelled) setScriptsLoaded(true) })
      .catch(e  => { if (!cancelled) setScriptsError(String(e.message || e)) })
    return () => { cancelled = true }
  }, [])

  // ── Inicializar Holistic + cámara (solo tras consentimiento del usuario) ───
  useEffect(() => {
    if (!scriptsLoaded || cameraConsent !== 'accepted') return
    const HolisticCtor = window.Holistic
    const CameraCtor   = window.Camera
    if (!HolisticCtor || !CameraCtor) {
      setScriptsError('MediaPipe no se cargó correctamente.')
      return
    }
    const videoEl = videoRef.current
    if (!videoEl) return

    const holistic = new HolisticCtor({
      locateFile: f =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@${MEDIAPIPE_HOLISTIC_VER}/${f}`
    })
    holistic.setOptions({
      modelComplexity:        0,
      // 00_capture.py (con el que se grabaron los datos de entrenamiento) usa
      // el filtro de suavizado temporal de MediaPipe por defecto (True). Acá
      // estaba apagado — eso desalinea el ruido/tembleque de los landmarks en
      // vivo respecto a los datos con los que se entrenó el modelo.
      smoothLandmarks:        true,
      enableSegmentation:     false,
      refineFaceLandmarks:    false,
      // Alineado con min_detection_confidence/min_tracking_confidence=0.6 de
      // 00_capture.py. Bajar minTrackingConfidence de 0.65 a 0.6 hace que
      // MediaPipe no suelte el tracking de la mano ante frames ligeramente
      // ruidosos, reduciendo el parpadeo que cortaba el buffer a la mitad.
      minDetectionConfidence: 0.6,
      minTrackingConfidence:  0.6,
    })
    holistic.onResults((results) => handleResultsRef.current(results))
    holisticRef.current = holistic

    const camera = new CameraCtor(videoEl, {
      onFrame: async () => {
        if (!holisticRef.current || videoEl.readyState < 2) return
        try {
          await holisticRef.current.send({ image: videoEl })
        } catch (_) {
          // ignorar frame fallido
        }
      },
      width: 480, height: 360,
    })
    cameraRef.current = camera

    camera.start()
      .then(() => setCameraOk(true))
      .catch(e => setCameraError(
        e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilítalo en tu navegador.'
          : 'No se pudo acceder a la cámara.'
      ))

    return () => {
      try { camera.stop()    } catch (_) {}
      try { holistic.close() } catch (_) {}
      holisticRef.current = null
      cameraRef.current   = null
      setCameraOk(false)
    }
  }, [scriptsLoaded, cameraConsent, cameraRetryKey])

  function acceptCameraPermission() {
    setCameraConsent('accepted')
    setCameraError(null)
    setCameraOk(false)
  }

  function declineCameraPermission() {
    setCameraConsent('declined')
    setCameraError(null)
    setCameraOk(false)
    setRunning(false)
  }

  function retryCameraAccess() {
    setCameraError(null)
    setCameraOk(false)
    setCameraRetryKey((k) => k + 1)
  }

  // ── Voz ───────────────────────────────────────────────────────────────────
  function speak(text) {
    if (!audioRef.current || !text) return
    if (!window?.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
      const u = new window.SpeechSynthesisUtterance(text)
      u.lang = 'es-ES'; u.rate = 1; u.pitch = 1
      window.speechSynthesis.speak(u)
    } catch (e) { console.warn(e) }
  }

  // ── Confirmar seña ────────────────────────────────────────────────────────
  function triggerRecognition(sign, confidence) {
    const text = sign.replace(/_/g, ' ')
    const det  = { sign, text, confidence }
    setLatest(det)
    setHistory(h => [det, ...h].slice(0, 8))
    setSentence(prev => [...prev, sign].slice(-10))
    if (sentenceClearRef.current) clearTimeout(sentenceClearRef.current)
    sentenceClearRef.current = setTimeout(() => setSentence([]), 6000)
    speak(text)
  }

  function updateCaptureHud(len, { showHud, status }) {
    if (statusTextRef.current && status) {
      statusTextRef.current.textContent = status
    }
    if (!bufferHudRef.current) return
    bufferHudRef.current.style.display = showHud ? 'block' : 'none'
    if (!showHud) return
    const pct = Math.min(100, (len / LIVE_MIN_FRAMES) * 100)
    if (bufferBarRef.current) {
      bufferBarRef.current.style.width = `${pct}%`
      bufferBarRef.current.style.background = len >= LIVE_MIN_FRAMES ? '#94D08E' : '#E9CF7E'
    }
    if (bufferTextRef.current) {
      bufferTextRef.current.textContent = `${len}/${LIVE_MIN_FRAMES}`
    }
  }

  // Solo toca refs y setState setters (identidades estables) → useCallback
  // con deps vacías es correcto y permite referenciarla desde otros hooks.
  const resetPipelineState = useCallback(() => {
    landmarkBufferRef.current = []
    predHistRef.current       = []
    prevFrameRef.current      = null
    stillCountRef.current     = 0
    peakMovementRef.current   = 0
    lastSignRef.current       = ''
    cooldownRef.current       = 0
    apiInFlightRef.current    = false
    handVisibleRef.current    = false
    setHandVisible(false)
    setBufferLen(0)
    setInCooldown(false)
    inCooldownRef.current   = false
    updateCaptureHud(0, { showHud: false, status: 'Listo' })
    setDisplaySign('')
    setDisplayConf(0)
  }, [])

  function confirmSign(prediction, confidence) {
    lastSignRef.current       = prediction
    cooldownRef.current       = SAME_SIGN_WAIT
    landmarkBufferRef.current = []
    predHistRef.current       = []
    prevFrameRef.current      = null
    stillCountRef.current     = 0
    peakMovementRef.current   = 0

    setDisplaySign(prediction)
    setDisplayConf(confidence)
    inCooldownRef.current = true
    setBufferLen(0)
    setInCooldown(true)
    updateCaptureHud(0, { showHud: false, status: `${prediction.replace(/_/g, ' ')} · ${Math.round(confidence * 100)}%` })

    triggerRecognition(prediction, confidence)
  }

  function runPrediction(frames, { finalize = false } = {}) {
    if (!runningRef.current || !mlAvailableRef.current) return
    if (cooldownRef.current > 0 || apiInFlightRef.current) return
    if (frames.length < MIN_FRAMES) return

    const bufferCopy = padBuffer([...frames])
    apiInFlightRef.current = true

    ;(async () => {
      try {
        const resp = await fetch(`${ML_API_URL}/predict`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ frames: bufferCopy }),
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

        const { prediction, confidence, is_idle } = await resp.json()

        if (is_idle || !prediction) return

        // Al quitar la mano: confirmar de inmediato si la confianza es alta
        if (
          finalize &&
          confidence >= UMBRAL &&
          prediction !== lastSignRef.current
        ) {
          confirmSign(prediction, confidence)
          return
        }

        predHistRef.current.push(prediction)
        if (predHistRef.current.length > STABILITY_NEED) {
          predHistRef.current.shift()
        }

        if (
          predHistRef.current.length >= STABILITY_NEED &&
          new Set(predHistRef.current).size === 1 &&
          confidence >= UMBRAL &&
          prediction !== lastSignRef.current
        ) {
          confirmSign(prediction, confidence)
        }
      } catch {
        mlAvailableRef.current = false
        setMlMode(false)
      } finally {
        apiInFlightRef.current = false
      }
    })()
  }

  // ── Callback principal de MediaPipe ───────────────────────────────────────
  function handleResults(results) {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video) return

    const w = video.videoWidth  || 480
    const h = video.videoHeight || 360
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const hasLeft  = !!results.leftHandLandmarks
    const hasRight = !!results.rightHandLandmarks
    const hasHands = hasLeft || hasRight

    // ── Solo dibuja manos (igual que 07_gnn_predict.py) ─────────────────────
    const drawConn = window.drawConnectors
    const drawLm   = window.drawLandmarks
    if (drawConn && drawLm) {
      try {
        if (hasLeft) {
          drawConn(ctx, results.leftHandLandmarks, HAND_CONNECTIONS,
            { color: '#3b82f6', lineWidth: 3 })
          drawLm(ctx, results.leftHandLandmarks,
            { color: '#60a5fa', lineWidth: 1, radius: 3 })
        }
        if (hasRight) {
          drawConn(ctx, results.rightHandLandmarks, HAND_CONNECTIONS,
            { color: '#9333ea', lineWidth: 3 })
          drawLm(ctx, results.rightHandLandmarks,
            { color: '#c084fc', lineWidth: 1, radius: 3 })
        }
      } catch (e) {
        console.warn('Error dibujando landmarks:', e)
      }
    }

    ctx.restore()

    const wasHandVisible = handVisibleRef.current
    handVisibleRef.current = hasHands
    if (wasHandVisible !== hasHands) setHandVisible(hasHands)

    if (cooldownRef.current > 0) cooldownRef.current--

    const cooling = cooldownRef.current > 0
    if (inCooldownRef.current !== cooling) {
      inCooldownRef.current = cooling
      setInCooldown(cooling)
    }

    // ── Sin manos ────────────────────────────────────────────────────────────
    if (!hasHands) {
      noHandCountRef.current++

      // Parpadeo momentáneo en medio de un gesto: no tocar el buffer, solo
      // saltar el frame. MediaPipe casi siempre recupera el tracking en 1-3
      // frames; tratarlo como "se acabó la seña" de una vez rompe capturas
      // válidas a la mitad.
      if (handWasVisibleRef.current && noHandCountRef.current < NO_HAND_GRACE) {
        const status = mlMode ? 'Detectando…' : 'Servidor IA no conectado'
        updateCaptureHud(landmarkBufferRef.current.length, { showHud: true, status })
        return
      }

      // Pérdida sostenida: ahí sí se acabó la seña — predecir con lo
      // capturado y reiniciar el pipeline.
      const hadHands = handWasVisibleRef.current
      const snapshot = hadHands ? [...landmarkBufferRef.current] : []

      landmarkBufferRef.current = []
      prevFrameRef.current      = null
      stillCountRef.current     = 0
      peakMovementRef.current   = 0
      handWasVisibleRef.current = false

      const status = !runningRef.current
        ? (cameraOk ? 'Listo' : 'Conectando…')
        : (mlMode ? 'Muestra una mano' : 'Servidor IA no conectado')
      updateCaptureHud(0, { showHud: false, status })

      if (hadHands && snapshot.length >= MIN_FRAMES) {
        runPrediction(snapshot, { finalize: true })
      }

      if (noHandCountRef.current >= NO_HAND_RESET) {
        predHistRef.current = []
      }
      return
    }

    // ── Con manos ────────────────────────────────────────────────────────────
    noHandCountRef.current    = 0
    handWasVisibleRef.current = true

    const currFrame = extractLandmarks(results)
    const movement  = frameMovement(prevFrameRef.current, currFrame)
    prevFrameRef.current = currFrame

    let len = 0
    if (runningRef.current) {
      // Acumular el frame (mientras la mano esté visible). Se limita el buffer
      // a los últimos SEQ_LEN para no crecer sin fin en gestos largos.
      landmarkBufferRef.current.push(currFrame)
      if (landmarkBufferRef.current.length > SEQ_LEN) {
        landmarkBufferRef.current.shift()
      }
      len = landmarkBufferRef.current.length

      // Umbral ADAPTATIVO de "detenido": relativo al pico de movimiento de la
      // seña en curso, con un piso absoluto. Robusto al tembleque de MediaPipe
      // (una mano quieta que vibra un poco no cuenta como movimiento).
      if (movement > peakMovementRef.current) peakMovementRef.current = movement
      const stopThreshold = Math.max(STOP_ABS, peakMovementRef.current * STOP_FRAC)
      const gestureHappened = peakMovementRef.current >= MOVED_MIN

      if (movement < stopThreshold) stillCountRef.current++
      else stillCountRef.current = 0

      // Fin de seña: hubo un gesto real (el pico superó MOVED_MIN) y el
      // movimiento lleva STOP_FRAMES por debajo del umbral → terminó. Predice
      // YA con los frames reales capturados (padBuffer los remuestrea a SEQ_LEN),
      // sin esperar a llenar la ventana. Se dispara una sola vez por parada.
      if (
        !cooling && !apiInFlightRef.current &&
        gestureHappened &&
        stillCountRef.current === STOP_FRAMES &&
        len >= MIN_FRAMES
      ) {
        const snapshot = [...landmarkBufferRef.current]
        landmarkBufferRef.current = []
        peakMovementRef.current   = 0
        runPrediction(snapshot, { finalize: true })
      }
      // Respaldo: si el gesto sigue en movimiento continuo y llena la ventana
      // sin detenerse, se evalúa igual (el control de estabilidad de 3
      // predicciones seguidas evita confirmar de más).
      else if (!cooling && len >= LIVE_MIN_FRAMES) {
        runPrediction(landmarkBufferRef.current)
      }
    }

    const showHud = runningRef.current && mlAvailableRef.current && len > 0 && !cooling
    const status = !runningRef.current
      ? (cameraOk ? 'Listo' : 'Conectando…')
      : !mlMode
        ? 'Servidor IA no conectado'
        : len >= LIVE_MIN_FRAMES
          ? 'Detectando…'
          : len > 0
            ? `Capturando… ${len}/${LIVE_MIN_FRAMES}`
            : 'Haz la seña'
    updateCaptureHud(len, { showHud, status })
  }

  handleResultsRef.current = handleResults

  // ── Controles ─────────────────────────────────────────────────────────────
  function startDetect() {
    resetPipelineState()
    noHandCountRef.current    = 0
    handWasVisibleRef.current = false
    setRunning(true)
  }

  function stopDetect() {
    setRunning(false)
    window?.speechSynthesis?.cancel()
  }

  const handleReset = useCallback(() => {
    resetPipelineState()
    noHandCountRef.current = 0
    setLatest(null)
    setHistory([])
    setSentence([])
    setDisplaySign('')
    setDisplayConf(0)
    setBufferLen(0)
    setInCooldown(false)
    if (sentenceClearRef.current) clearTimeout(sentenceClearRef.current)
    window?.speechSynthesis?.cancel()
  }, [resetPipelineState])

  function retryMlConnection() {
    setMlConnecting(true)
    checkMlApiHealth({ force: true })
      .then((result) => {
        mlAvailableRef.current = result.ok
        setMlMode(result.ok)
        setMlConnecting(false)
      })
  }

  // ── Status HUD ────────────────────────────────────────────────────────────
  const statusLabel = (() => {
    if (cameraConsent === null)    return 'Permiso requerido'
    if (cameraConsent === 'declined') return 'Cámara desactivada'
    if (!cameraOk && cameraError)  return 'Sin acceso a cámara'
    if (!running)                  return cameraOk ? 'Listo' : 'Conectando…'
    if (!mlMode)                   return 'Servidor IA no conectado'
    if (!handVisible)              return 'Muestra una mano'
    if (displaySign && inCooldown) return `${displaySign.replace(/_/g, ' ')} · ${Math.round(displayConf * 100)}%`
    if (bufferLen >= LIVE_MIN_FRAMES) return 'Detectando…'
    if (bufferLen > 0)             return `Capturando… ${bufferLen}/${LIVE_MIN_FRAMES}`
    return 'Haz la seña'
  })()

  const confPct = latest ? Math.round((latest.confidence || 0) * 100) : 0

  const tutorial = useModeTutorial('interpret')

  return (
    <AppPage>
      <AppPageHeader>
          <button
            onClick={onBack}
            className="motion-press inline-flex items-center gap-2 rounded-full border-2 border-pastel-ink/15 bg-white px-4 py-2 text-sm font-bold text-pastel-ink transition hover:border-pastel-purple-line hover:bg-pastel-purple/30 focus:outline-none focus:ring-4 focus:ring-pastel-purple"
          >
            <BackIcon />
            <span className="hidden sm:inline">Cambiar modo</span>
          </button>

          <button
            onClick={onHome}
            className="text-xl font-extrabold tracking-tight text-pastel-grape transition hover:opacity-80 sm:text-2xl"
          >
            Signara
          </button>

          <div className="flex items-center gap-2">
            <TutorialHelpButton onClick={tutorial.start} />
            <ResetButton onClick={handleReset} />
          </div>
      </AppPageHeader>

      <AppPageMain>
        <AppPagePanel>
            <AppPageHeading>
              <div>
                <SectionLabel color="blue">Interpretar</SectionLabel>
                <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                  De señas a{' '}
                  <span className="inline-block rounded-xl border-2 border-pastel-blue-line bg-pastel-blue px-2.5 py-0.5 shadow-[0_8px_18px_-8px_rgba(45,42,38,0.35)]">
                    texto
                  </span>
                </h1>
                <p className="mt-3 max-w-lg text-sm font-semibold text-pastel-sub sm:text-base">
                  Muestra tus manos a la cámara y Signara las convertirá en palabras.
                </p>
              </div>

              <AppPageStagger className="flex flex-wrap gap-2">
                <MlStatusPill
                  mlMode={mlMode}
                  mlConnecting={mlConnecting}
                  onRetry={!mlMode && !mlConnecting ? retryMlConnection : undefined}
                />
                {running && (
                  <StatusPill variant="live">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    Detectando
                  </StatusPill>
                )}
                {history.length > 0 && (
                  <StatusPill variant="count">{history.length} detectadas</StatusPill>
                )}
              </AppPageStagger>
            </AppPageHeading>

            <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
              <AppPageStagger className="flex flex-col gap-5 lg:col-span-7">
                <div
                  data-tutorial="interpret-camera"
                  className={
                    'relative overflow-hidden rounded-[2rem] border-[3px] shadow-[0_24px_50px_-28px_rgba(147,190,240,0.75)] ' +
                    (running && handVisible
                      ? 'border-pastel-grape bg-gradient-to-br from-pastel-blue via-pastel-blue to-pastel-purple/40'
                      : 'border-pastel-blue-line bg-pastel-blue')
                  }
                >
                  {running && displaySign && (
                    <div className="pointer-events-none absolute inset-0 z-10 rounded-[1.85rem] ring-4 ring-pastel-grape/25 animate-pulse" />
                  )}

                  <div className="p-4 pb-0 sm:p-5 sm:pb-0">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-ink/70">
                          <Icon name="camera" className="h-3.5 w-3.5" strokeWidth={2.25} /> Tu cámara
                        </p>
                        <p
                          ref={statusTextRef}
                          className="mt-0.5 text-lg font-extrabold text-pastel-ink"
                        >
                          {statusLabel}
                        </p>
                      </div>
                      <div
                        ref={bufferHudRef}
                        className="hidden shrink-0 rounded-xl border-2 border-white/60 bg-white/80 px-3 py-2"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-pastel-sub">Captura</p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-pastel-blue/50">
                            <div
                              ref={bufferBarRef}
                              className="h-full rounded-full"
                              style={{ width: '0%', background: '#E9CF7E' }}
                            />
                          </div>
                          <span ref={bufferTextRef} className="text-xs font-bold tabular-nums text-pastel-ink">
                            0/{LIVE_MIN_FRAMES}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative mx-4 mb-4 aspect-video overflow-hidden rounded-[1.25rem] border-2 border-white/70 bg-black shadow-inner sm:mx-5 sm:mb-5">
                    <video ref={videoRef} autoPlay playsInline muted
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ transform: 'scaleX(-1)' }} />
                    <canvas ref={canvasRef}
                      className="absolute inset-0 h-full w-full pointer-events-none"
                      style={{ transform: 'scaleX(-1)' }} />

                    {!scriptsLoaded && !scriptsError && (
                      <CameraOverlay icon="clock" title="Cargando MediaPipe…" />
                    )}
                    {scriptsError && (
                      <CameraOverlay icon="alert" title="Error cargando MediaPipe" subtitle={scriptsError} />
                    )}
                    {scriptsLoaded && cameraConsent === 'accepted' && !cameraOk && !cameraError && (
                      <CameraOverlay icon="camera" title="Conectando cámara…" />
                    )}
                    {cameraError && (
                      <CameraOverlay
                        icon="ban"
                        title="No se pudo iniciar la cámara"
                        subtitle={cameraError}
                        actionLabel="Reintentar"
                        onAction={retryCameraAccess}
                      />
                    )}

                    {running && !mlMode && !mlConnecting && (
                      <div className="absolute inset-0 flex items-center justify-center bg-pastel-ink/75 p-6 backdrop-blur-sm">
                        <div className="max-w-sm rounded-2xl border-2 border-pastel-blue-line bg-[#FAF6EC] p-5 text-center shadow-xl">
                          <Icon name="alert" className="mx-auto h-9 w-9 text-pastel-grape" strokeWidth={1.75} />
                          <p className="mt-2 text-lg font-extrabold text-pastel-ink">Servidor IA no conectado</p>
                          <p className="mt-1 text-xs font-semibold text-pastel-sub">Ejecuta en una terminal:</p>
                          <code className="mt-3 block rounded-xl border-2 border-pastel-ink/10 bg-white px-3 py-2 text-left text-[11px] font-mono text-pastel-grape">
                            cd sign_ai &amp;&amp; uvicorn api:app --port 8000
                          </code>
                          <button
                            onClick={retryMlConnection}
                            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-pastel-grape px-5 text-sm font-bold text-white transition hover:brightness-110"
                          >
                            Reintentar conexión
                          </button>
                        </div>
                      </div>
                    )}

                    {displaySign && (
                      <div className="absolute bottom-3 left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-xl border-2 border-pastel-grape bg-white px-4 py-2 text-center shadow-[0_8px_24px_-8px_rgba(126,100,201,0.5)]">
                        <p className="text-base font-extrabold uppercase tracking-wide text-pastel-grape sm:text-lg">
                          {displaySign.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[11px] font-bold text-pastel-sub">{Math.round(displayConf * 100)}% confianza</p>
                      </div>
                    )}

                    <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-xl border-2 border-white/20 bg-black/50 px-2.5 py-1.5 text-xs font-bold text-white backdrop-blur">
                      <span className={'h-2 w-2 rounded-full ' + (running ? 'bg-red-400 animate-pulse' : cameraOk ? 'bg-green-400' : 'bg-white/50')} />
                      {running ? 'REC' : cameraOk ? 'Lista' : '…'}
                    </div>
                    {handVisible && (
                      <div className="absolute right-3 top-3 z-20 rounded-xl border-2 border-pastel-green-line/80 bg-black/55 px-2.5 py-1.5 text-xs font-bold text-pastel-green backdrop-blur">
                        Manos detectadas
                      </div>
                    )}
                  </div>

                  {scriptsLoaded && cameraConsent === null && (
                    <CameraPermissionPrompt
                      onAccept={acceptCameraPermission}
                      onDecline={declineCameraPermission}
                    />
                  )}
                  {scriptsLoaded && cameraConsent === 'declined' && !cameraOk && (
                    <CameraOverlay
                      icon="camera"
                      title="Cámara no activada"
                      subtitle="Sin permiso de cámara no podemos interpretar tus señas. Puedes concederlo cuando quieras."
                      actionLabel="Conceder permisos"
                      onAction={acceptCameraPermission}
                    />
                  )}

                  {/* Controles */}
                  <div className="flex flex-wrap items-center gap-3 border-t-2 border-white/40 px-4 py-4 sm:px-5" data-tutorial="interpret-start">
                    {!running ? (
                      <button
                        onClick={startDetect}
                        disabled={!cameraOk}
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-pastel-grape px-5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(126,100,201,0.6)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PlayIcon />
                        Empezar a interpretar
                      </button>
                    ) : (
                      <button
                        onClick={stopDetect}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border-2 border-pastel-ink/20 bg-white px-5 text-sm font-bold text-pastel-ink transition hover:bg-pastel-cream"
                      >
                        <StopIcon />
                        Detener
                      </button>
                    )}

                    <label className="ml-auto inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border-2 border-white/60 bg-white/80 px-3 py-2 text-sm font-bold text-pastel-ink">
                      <input
                        type="checkbox"
                        checked={audioOn}
                        onChange={(e) => setAudioOn(e.target.checked)}
                        className="h-4 w-4 accent-pastel-grape"
                      />
                      <Icon name="volume" className="h-4 w-4" strokeWidth={2} /> Voz alta
                    </label>
                  </div>
                </div>

                {sentence.length > 0 && (
                  <OutputCard title="Conversación" emptyIcon="message" hasContent>
                    <p className="text-xl font-extrabold leading-relaxed tracking-wide text-pastel-ink sm:text-2xl">
                      {sentence.map((s) => s.replace(/_/g, ' ')).join(' ')}
                    </p>
                  </OutputCard>
                )}

                {!running && !history.length && (
                  <div className="rounded-2xl border-2 border-dashed border-pastel-blue-line bg-pastel-blue/40 px-4 py-4 text-center">
                    <p className="text-sm font-bold text-pastel-ink">
                      Pulsa <strong className="text-pastel-grape">Empezar a interpretar</strong>.
                      Haz cada seña con movimiento claro. Cuando termines, <strong>quita las manos</strong> del encuadre para confirmar la seña.
                    </p>
                    <p className="mt-2 text-xs font-semibold text-pastel-sub">
                      Señas: HOLA · GRACIAS · BIEN · MAL · COMO ESTAS · SED · NECESITO AYUDA · POR FAVOR · SI · NO · ADIOS · FAMILIA · PERDON
                    </p>
                  </div>
                )}
              </AppPageStagger>

              <AppPageStagger className="flex flex-col gap-5 lg:col-span-5">
                <div
                  data-tutorial="interpret-results"
                  className="motion-surface animate-motion-scale-in rounded-[1.5rem] border-[3px] border-pastel-blue-line bg-white p-5 shadow-[0_16px_36px_-22px_rgba(45,42,38,0.35)] sm:p-6"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-grape">Última seña</p>
                  {latest ? (
                    <>
                      <p className="mt-3 text-4xl font-extrabold uppercase tracking-tight text-pastel-grape sm:text-5xl">
                        {latest.sign.replace(/_/g, ' ')}
                      </p>
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs font-bold text-pastel-sub">
                          <span>Confianza</span>
                          <span>{confPct}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full border border-pastel-ink/10 bg-pastel-cream">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-pastel-blue-line to-pastel-grape transition-all duration-500"
                            style={{ width: `${confPct}%` }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 flex flex-col items-center rounded-xl border-2 border-dashed border-pastel-ink/10 bg-pastel-cream/50 px-4 py-8 text-center">
                      <Icon name="sign" className="h-9 w-9 text-pastel-sub/50" strokeWidth={1.5} />
                      <p className="mt-2 text-sm font-semibold text-pastel-sub">
                        Aquí aparecerá la seña reconocida
                      </p>
                    </div>
                  )}
                </div>

                {/* Historial */}
                <div data-tutorial="interpret-history">
                <OutputCard
                  title="Historial reciente"
                  emptyIcon="clipboard"
                  hasContent={history.length > 0}
                  empty="Cada seña reconocida aparecerá aquí."
                >
                  <ul className="space-y-2">
                    {history.map((h, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-3 rounded-xl border-2 border-pastel-blue-line/50 bg-pastel-blue/20 px-3 py-2"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-extrabold text-pastel-grape">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-sm font-bold text-pastel-ink">{h.sign.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-extrabold text-pastel-sub">{Math.round((h.confidence || 0) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </OutputCard>
                </div>
              </AppPageStagger>
            </div>
        </AppPagePanel>
      </AppPageMain>

      <AppPageFooter>
        <p className="text-xs text-pastel-sub">GNN + LSTM · solo manos · MediaPipe Holistic</p>
      </AppPageFooter>

      <ModeTutorial
        mode="interpret"
        steps={INTERPRET_TUTORIAL_STEPS}
        open={tutorial.open}
        onComplete={tutorial.finish}
      />
    </AppPage>
  )
}

function StatusPill({ variant, children }) {
  const styles = {
    live: 'border-pastel-grape bg-pastel-grape text-white shadow-[0_6px_16px_-6px_rgba(126,100,201,0.6)]',
    count: 'border-pastel-blue-line bg-pastel-blue text-pastel-ink',
  }
  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold ' + styles[variant]}>
      {children}
    </span>
  )
}

function MlStatusPill({ mlMode, mlConnecting, onRetry }) {
  const connected = mlMode && !mlConnecting
  const label = mlConnecting ? 'Conectando IA…' : mlMode ? 'IA conectada' : 'Sin conexión IA'
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={!onRetry}
      className={
        'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition ' +
        (connected
          ? 'border-pastel-green-line bg-pastel-green text-pastel-ink cursor-default'
          : mlConnecting
            ? 'border-pastel-yellow-line bg-pastel-yellow text-pastel-ink cursor-default'
            : 'border-pastel-pink/50 bg-white text-pastel-sub hover:border-pastel-purple-line cursor-pointer')
      }
      title={onRetry ? 'Reintentar conexión con IA' : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${
        mlConnecting ? 'bg-pastel-yellow-line animate-pulse' :
        mlMode ? 'bg-pastel-green-line animate-pulse' : 'bg-pastel-sub/40'
      }`} />
      {label}
    </button>
  )
}

function OutputCard({ title, empty, emptyIcon, hasContent, children }) {
  return (
    <div className="motion-surface rounded-[1.5rem] border-2 border-pastel-ink/10 bg-white p-4 shadow-[0_14px_30px_-24px_rgba(45,42,38,0.35)] sm:p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-grape">{title}</p>
      <div className="mt-3">
        {hasContent ? children : (
          <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-pastel-ink/10 bg-pastel-cream/50 px-4 py-6 text-center">
            {emptyIcon && <Icon name={emptyIcon} className="h-8 w-8 text-pastel-sub/50" strokeWidth={1.75} />}
            <p className="mt-2 text-sm font-semibold text-pastel-sub">{empty}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function CameraPermissionPrompt({ onAccept, onDecline }) {
  return (
    <div className="absolute inset-0 z-30 flex animate-permission-overlay-in items-center justify-center overflow-y-auto bg-pastel-ink/78 p-3 sm:p-5">
      <div className="my-auto w-full max-w-sm animate-permission-card-in rounded-2xl border-2 border-pastel-blue-line bg-[#FAF6EC] p-4 text-center shadow-xl sm:p-5">
        <Icon
          name="camera"
          className="animate-float mx-auto h-8 w-8 text-pastel-grape sm:h-9 sm:w-9"
          strokeWidth={1.75}
          style={{ animationDuration: '3.5s' }}
        />
        <p className="animate-permission-item-in mt-2 text-base font-extrabold text-pastel-ink sm:text-lg">
          Necesitamos tu cámara
        </p>
        <p
          className="animate-permission-item-in mt-2 text-xs leading-relaxed text-pastel-sub sm:text-sm"
          style={{ animationDelay: '80ms' }}
        >
          Para interpretar lengua de señas, Signara necesita acceso a la cámara de tu dispositivo.
          Si no concedes el permiso, esta función no estará disponible.
        </p>
        <div
          className="animate-permission-item-in mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:justify-center"
          style={{ animationDelay: '160ms' }}
        >
          <button
            type="button"
            onClick={onAccept}
            className="motion-press inline-flex h-11 w-full items-center justify-center rounded-xl bg-pastel-grape px-5 text-sm font-bold text-white transition hover:brightness-110 sm:w-auto"
          >
            Conceder permisos
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="motion-press inline-flex h-11 w-full items-center justify-center rounded-xl border-2 border-pastel-ink/15 bg-white px-5 text-sm font-bold text-pastel-sub transition hover:text-pastel-ink sm:w-auto"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  )
}

function CameraOverlay({ icon, title, subtitle, actionLabel, onAction }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-pastel-ink/78 p-3 text-center backdrop-blur-sm sm:p-5">
      <div className="my-auto w-full max-w-sm rounded-2xl border-2 border-pastel-blue-line bg-[#FAF6EC] p-4 shadow-xl sm:p-5">
        <Icon name={icon} className="mx-auto h-9 w-9 text-pastel-grape" strokeWidth={1.75} />
        <p className="mt-3 text-base font-extrabold text-pastel-ink sm:text-lg">{title}</p>
        {subtitle && (
          <p className="mt-2 text-xs font-semibold leading-relaxed text-pastel-sub sm:text-sm">{subtitle}</p>
        )}
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="motion-press mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-pastel-grape px-5 text-sm font-bold text-white transition hover:brightness-110 sm:w-auto"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

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
import { getSharedHandLandmarker } from '../utils/handLandmarker.js'
import {
  autoExposeCanvas,
  composeStudioFrame,
  fillPersonMaskCanvas,
  getSharedSelfieSegmenter,
  keepPrimaryPersonOnly,
  solidifyBackgroundFromMask,
} from '../utils/selfieSegmenter.js'
import LanguagePicker from './LanguagePicker.jsx'
import {
  findOutputLang,
  getStoredOutputLang,
} from '../data/outputLanguages.js'
import { translateFromSpanish } from '../utils/translateApi.js'
import { maybeCorrectTeAmo, maybeCorrectComoFamilia } from '../utils/handshapeHints.js'
import { isLetterToken } from '../utils/fingerspell.js'

/** Tras la última letra, esperar este tiempo sin nueva letra → emitir el nombre. */
const SPELL_FLUSH_MS = 1000

// Migrado de @mediapipe/holistic (legacy) a @mediapipe/tasks-vision:
// HandLandmarker con GPU, solo manos. FaceLandmarker se pospuso: no se usa
// aún en /predict y correrlo cada frame retrasaba los puntos de la mano.

// ── Parámetros (alineados con sign_ai/07_gnn_predict.py) ─────────────────────
// SEQ_LEN debe coincidir exactamente con sign_ai/core/gnn_model.SEQ_LEN y
// sign_ai/core/config.SEQ_LEN — si no coinciden, /predict rechaza el shape.
// Bajado de 40 a 24 (validado: misma val acc, 97.8%, con datos reales) para
// que Interpretar reconozca ~40% más rápido sin perder precisión.
const SEQ_LEN        = 24
const HAND_COUNT     = 21
// Más estricto: preferimos esperar un frame más a “adivinar” con 0.75.
const UMBRAL         = 0.80
const STABILITY_NEED = 2
// Solo confirma en 1 shot live si es casi seguro (antes 0.90 disparaba de más).
const HIGH_CONF_INSTANT = 0.94
// Fin de seña (1 sola predicción): umbral aún un poco más alto.
const FINALIZE_UMBRAL = 0.84
const NO_HAND_RESET  = 12
// Tiempo máximo de espera de /predict antes de abortar. Sin esto, si el
// servidor ML está frío (Render) o la red falla a medias, el fetch podía
// quedar colgado indefinidamente con apiInFlightRef en true, bloqueando
// cualquier predicción nueva sin que el usuario supiera por qué "no responde".
const PREDICT_TIMEOUT_MS = 12000
// Buffer: tolera parpadeos de tracking sin vaciar la seña.
const NO_HAND_GRACE  = 8
const POST_CONFIRM_WAIT = 8
// Mínimo de frames reales para mandar a /predict.
const MIN_FRAMES     = 8

// ── Fin de seña (camino principal, tiempo real) ─────────────────────────────
const STOP_FRAMES = 4
const STOP_FRAC   = 0.4
const STOP_ABS    = 0.006
// Gesto dinámico (HOLA, ADIOS…): hace falta movimiento claro.
const MOVED_MIN   = 0.018
// Señas casi estáticas (TE_AMO, SI, NO): sostener la forma cuenta como gesto
// aunque la muñeca casi no se mueva — sin bajar el umbral dinámico de arriba.
const HELD_MOVED_MIN = 0.003
const HELD_MIN_FRAMES = 12

const LIVE_STRIDE = 4

// Inferencia: equilibrio velocidad / tracking (izq. sufría a 160×120).
const DETECT_W = 192
const DETECT_H = 144

// Dos detecciones muy cerca = casi siempre la misma mano “partida” al entrar.
const DUP_HAND_DIST = 0.14

// ── Dibujo de la mano: solo puntos (sin líneas del esqueleto). ───────────────
function copyHandLandmarks(lms) {
  if (!lms) return null
  const n = Math.min(lms.length, HAND_COUNT)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const p = lms[i]
    out[i] = { x: p.x, y: p.y, z: p.z || 0 }
  }
  return out
}

function drawHandDots(ctx, landmarks, { color, radius }) {
  const w = ctx.canvas.width, h = ctx.canvas.height
  const r = radius ?? 2.5
  ctx.fillStyle = color
  for (const p of landmarks) {
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function handCentroid(lms) {
  if (!lms?.length) return { x: 0.5, y: 0.5 }
  let sx = 0, sy = 0, n = 0
  for (const p of lms) {
    if (!p) continue
    sx += p.x
    sy += p.y
    n++
  }
  return n ? { x: sx / n, y: sy / n } : { x: 0.5, y: 0.5 }
}

/** Si MediaPipe ve 2 manos casi en el mismo sitio, se queda con la de mayor score. */
function dedupeNearHands(scored) {
  if (scored.length < 2) return scored
  const byScore = [...scored].sort((a, b) => b.score - a.score)
  const kept = []
  for (const h of byScore) {
    const c = handCentroid(h.landmarks)
    const w = h.landmarks?.[0]
    const clash = kept.some((k) => {
      const ck = handCentroid(k.landmarks)
      const d = Math.hypot(c.x - ck.x, c.y - ck.y)
      const wk = k.landmarks?.[0]
      const wd = (w && wk) ? Math.hypot(w.x - wk.x, w.y - wk.y) : d
      return Math.min(d, wd) < DUP_HAND_DIST
    })
    if (!clash) kept.push(h)
  }
  return kept
}

// HandLandmarker devuelve `landmarks`/`handedness` como listas paralelas (una
// mano detectada = un índice en cada una), no separadas en left/right como
// Holistic. Se reconstruye la misma forma {leftHandLandmarks,
// rightHandLandmarks} que ya usa TODO el resto del archivo (handleResults,
// extractLandmarks) — así el resto del pipeline no necesita tocarse.
// `categoryName` ('Left'/'Right') es la misma clasificación de "mano
// anatómica" que ya devolvía Holistic (mismo modelo de manos por debajo),
// así que la corrección de espejo existente sigue aplicando igual.
function adaptHandResult(res) {
  let leftHandLandmarks = null, rightHandLandmarks = null
  const lm = res?.landmarks || []
  const hd = res?.handedness || []
  const scored = []
  for (let i = 0; i < lm.length; i++) {
    const cat = hd[i]?.[0]
    scored.push({
      landmarks: lm[i],
      label: cat?.categoryName,
      score: cat?.score ?? 0,
      x: lm[i]?.[0]?.x ?? 0.5,
      used: false,
    })
  }
  const unique = dedupeNearHands(scored)
  // Primero etiquetas confiables de MediaPipe.
  for (const h of unique) {
    if (h.score < 0.4) continue
    if (h.label === 'Left' && !leftHandLandmarks) { leftHandLandmarks = h.landmarks; h.used = true }
    else if (h.label === 'Right' && !rightHandLandmarks) { rightHandLandmarks = h.landmarks; h.used = true }
  }
  // Respaldo: por posición en imagen (x menor = izquierda del frame), SOLO
  // entre las manos que el paso anterior NO usó. Si MediaPipe etiqueta las
  // DOS manos igual (típico justo en señas que se cruzan/juntan, ej.
  // GRACIAS), el paso de arriba deja un slot vacío — sin este filtro, el
  // respaldo podía volver a agarrar la MISMA mano ya asignada (si quedaba
  // más a la derecha en X) y la otra mano real se perdía del todo.
  const remaining = unique.filter((h) => !h.used)
  if (remaining.length === 1 && !leftHandLandmarks && !rightHandLandmarks) {
    const h = remaining[0]
    if (h.x < 0.5) leftHandLandmarks = h.landmarks
    else rightHandLandmarks = h.landmarks
  } else if (remaining.length >= 2 && (!leftHandLandmarks || !rightHandLandmarks)) {
    const sorted = [...remaining].sort((a, b) => a.x - b.x)
    if (!leftHandLandmarks) leftHandLandmarks = sorted[0].landmarks
    if (!rightHandLandmarks) rightHandLandmarks = sorted[sorted.length - 1].landmarks
  } else if (remaining.length === 1) {
    // Queda exactamente un slot libre (el otro ya se resolvió por
    // etiqueta) — la única mano que sobra va ahí, sea cual sea su posición.
    const h = remaining[0]
    if (!leftHandLandmarks) leftHandLandmarks = h.landmarks
    else rightHandLandmarks = h.landmarks
  }
  return { leftHandLandmarks, rightHandLandmarks }
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
// 07_gnn_predict.py. Solo landmarks presentes (evita diluir TE_AMO one-hand
// con 21 ceros de la mano ausente).
function frameMovement(prev, curr) {
  if (!prev) return 0
  let sum = 0
  let n = 0
  for (let i = 0; i < curr.length; i += 3) {
    const alive =
      Math.abs(curr[i]) + Math.abs(curr[i + 1]) + Math.abs(curr[i + 2]) > 1e-6 ||
      Math.abs(prev[i]) + Math.abs(prev[i + 1]) + Math.abs(prev[i + 2]) > 1e-6
    if (!alive) continue
    sum += Math.abs(curr[i] - prev[i]) + Math.abs(curr[i + 1] - prev[i + 1])
    n += 2
  }
  return n > 0 ? sum / n : 0
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function InterpretScreen({ onBack, onHome }) {
  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const handLandmarkerRef = useRef(null)
  const selfieSegmenterRef = useRef(null)
  const personMaskCanvasRef = useRef(null)
  const personInferMaskRef = useRef(null)
  const personFeatherCanvasRef = useRef(null)
  const personLayerCanvasRef = useRef(null)
  const personWorkMaskRef = useRef(null)
  const studioBgCanvasRef = useRef(null)
  const displayFrameCanvasRef = useRef(null)
  const blurReadyRef = useRef(false)
  const studioBgRef = useRef(true)
  const mediaStreamRef    = useRef(null)
  const detectRafRef      = useRef(null)
  const runningRef   = useRef(false)
  const audioRef     = useRef(true)

  // Pipeline refs (sin re-render)
  const landmarkBufferRef = useRef([])   // frames del gesto en curso (máx SEQ_LEN)
  const predHistRef       = useRef([])   // historial de predicciones para estabilidad
  const prevFrameRef      = useRef(null) // frame anterior para calcular movimiento
  const noHandCountRef    = useRef(0)    // frames consecutivos sin manos
  const stillCountRef     = useRef(0)    // frames consecutivos "detenido" (mano visible)
  const peakMovementRef   = useRef(0)    // pico de movimiento de la seña en curso (umbral adaptativo)
  const cooldownRef       = useRef(0)    // cooldown frame-based
  const lastSignRef       = useRef('')   // última seña confirmada (evita repetir)
  const announcedUpRef    = useRef('')   // ya anunciada con manos arriba (evita doble voz)
  const spellBufRef       = useRef([])   // letras acumuladas (deletreo → nombre)
  const spellTimerRef     = useRef(null)
  const letterRepeatTimerRef = useRef(null) // libera L+L tras el brinco
  const lastLiveAtRef     = useRef(0)    // len del buffer en la última predicción live
  const apiInFlightRef    = useRef(false)
  const mlAvailableRef    = useRef(false)
  const sentenceClearRef  = useRef(null)
  const handleResultsRef  = useRef(() => {})
  const handWasVisibleRef = useRef(false)
  const handVisibleRef      = useRef(false)
  const inCooldownRef       = useRef(false)
  const bufferHudRef        = useRef(null)
  const statusTextRef       = useRef(null)
  const handBadgeRef        = useRef(null)
  // Última detección (snap inmediato — sin morph que atrase).
  const drawLeftRef  = useRef(null)
  const drawRightRef = useRef(null)
  const detectCanvasRef = useRef(null)
  const speakQueueRef = useRef([])
  const speakBusyRef = useRef(false)
  const speakTimerRef = useRef(null)
  // speakTimerRef es un timer COMPARTIDO entre el aviso de "Chrome se tragó
  // la frase" (400ms) y el "respiro" antes de la siguiente de la cola
  // (40ms/80ms) de utterances DISTINTAS. Si stopSpeech() corta la utterance
  // en vuelo justo cuando otra ya arrancó, el onerror/onend tardío de la
  // cancelada puede limpiar/pisar el timer de la nueva (misma ref). Cada
  // llamada a flushSpeakQueue que arranca una utterance real captura el
  // generation actual; sus callbacks solo tocan speakTimerRef/speakBusyRef
  // si siguen siendo la generación vigente — así una cancelación o una
  // utterance más nueva invalida automáticamente los callbacks viejos.
  const speakGenRef = useRef(0)
  const outputVoiceRef = useRef(null)
  const outputLangRef = useRef(getStoredOutputLang())

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
  const [studioBg,      setStudioBg]      = useState(() => {
    try { return localStorage.getItem('signara:studioBg') !== '0' } catch { return true }
  })
  const [handVisible,   setHandVisible]   = useState(false)
  const [bufferLen,     setBufferLen]     = useState(0)
  const [inCooldown,    setInCooldown]    = useState(false)
  const [displaySign,   setDisplaySign]   = useState('')
  const [displayConf,   setDisplayConf]   = useState(0)
  const [latest,        setLatest]        = useState(null)
  const [history,       setHistory]       = useState([])
  const [sentence,      setSentence]      = useState([])
  const [outputLang,    setOutputLang]    = useState(getStoredOutputLang)

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => {
    outputLangRef.current = outputLang
    outputVoiceRef.current = null // recalcular voz al cambiar idioma
  }, [outputLang])
  useEffect(() => {
    audioRef.current = audioOn
    if (!audioOn) stopSpeech()
  }, [audioOn])
  useEffect(() => {
    studioBgRef.current = studioBg
    try { localStorage.setItem('signara:studioBg', studioBg ? '1' : '0') } catch { /* ignore */ }
  }, [studioBg])

  // Chrome carga voces de forma async; calentar lista para acertar idioma.
  useEffect(() => {
    const warm = () => { pickVoiceForLang(findOutputLang(outputLangRef.current).speech) }
    warm()
    window.speechSynthesis?.addEventListener?.('voiceschanged', warm)
    return () => {
      window.speechSynthesis?.removeEventListener?.('voiceschanged', warm)
      stopSpeech()
    }
  }, [])

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

  // ── HandLandmarker (singleton: no re-descargar al remount) ─────────────────
  useEffect(() => {
    let cancelled = false
    getSharedHandLandmarker()
      .then((hand) => {
        if (cancelled) return
        handLandmarkerRef.current = hand
        setScriptsLoaded(true)
      })
      .catch((e) => {
        if (!cancelled) setScriptsError(String(e?.message || e))
      })
    return () => {
      cancelled = true
      handLandmarkerRef.current = null
      // No .close(): los singletons se reutilizan en la siguiente visita.
    }
  }, [])

  // Segmenter solo con «Fondo estudio» activo.
  useEffect(() => {
    if (!studioBg) {
      blurReadyRef.current = false
      return
    }
    let cancelled = false
    getSharedSelfieSegmenter()
      .then((seg) => {
        if (cancelled) return
        selfieSegmenterRef.current = seg
        blurReadyRef.current = true
      })
      .catch(() => {
        if (!cancelled) blurReadyRef.current = false
      })
    return () => {
      cancelled = true
      blurReadyRef.current = false
    }
  }, [studioBg])

  // ── Cámara (solo tras consentimiento del usuario) ──────────────────────────
  // Ya no depende de @mediapipe/camera_utils (esa librería CDN tampoco se
  // carga más) — getUserMedia directo, la detección corre en su propio loop
  // (ver "Detección + dibujo" más abajo), no atada al ritmo de la cámara.
  useEffect(() => {
    if (!scriptsLoaded || cameraConsent !== 'accepted') return
    const videoEl = videoRef.current
    if (!videoEl) return
    let cancelled = false

    navigator.mediaDevices.getUserMedia({
      video: {
        // Preview bajo: menos decode/composición; MediaPipe ya ve 160×120.
        width: { ideal: 320, max: 480 },
        height: { ideal: 240, max: 360 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: 'user',
      },
    })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        mediaStreamRef.current = stream
        const track = stream.getVideoTracks()[0]
        if (track?.applyConstraints) {
          track.applyConstraints({
            width: { ideal: 320, max: 480 },
            height: { ideal: 240, max: 360 },
            frameRate: { ideal: 30, max: 30 },
          }).catch(() => {})
        }
        videoEl.srcObject = stream
        return videoEl.play()
      })
      .then(() => { if (!cancelled) setCameraOk(true) })
      .catch((e) => setCameraError(
        e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilítalo en tu navegador.'
          : 'No se pudo acceder a la cámara.'
      ))

    return () => {
      cancelled = true
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
      videoEl.srcObject = null
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
  // Cola (no cancel+speak): en Chrome, cancel() seguido de speak() en el mismo
  // tick deja caer frases — sobre todo cortas como "no" / "sí". Cada seña
  // confirmada debe oírse siempre.
  function pickVoiceForLang(speechLang) {
    const want = String(speechLang || 'es-ES')
    const prefix = want.slice(0, 2).toLowerCase()
    try {
      const voices = window.speechSynthesis?.getVoices?.() || []
      const exact = voices.find((v) => v.lang?.toLowerCase() === want.toLowerCase())
      const byPrefix = voices.find((v) => v.lang?.toLowerCase().startsWith(prefix))
      const picked = exact || byPrefix || null
      if (picked) outputVoiceRef.current = picked
      return picked || outputVoiceRef.current
    } catch (_) {
      return outputVoiceRef.current
    }
  }

  function flushSpeakQueue() {
    if (speakBusyRef.current) return
    if (!audioRef.current || !window?.speechSynthesis) {
      speakQueueRef.current = []
      return
    }
    const item = speakQueueRef.current.shift()
    if (!item) return
    const text = typeof item === 'string' ? item : item.text
    const speechLang = typeof item === 'string'
      ? findOutputLang(outputLangRef.current).speech
      : (item.speechLang || findOutputLang(outputLangRef.current).speech)
    const attempt = typeof item === 'string' ? 0 : (item.attempt || 0)

    speakBusyRef.current = true
    const myGen = ++speakGenRef.current
    const isStale = () => myGen !== speakGenRef.current
    let started = false
    let finished = false
    try {
      window.speechSynthesis.resume()
      const u = new window.SpeechSynthesisUtterance(text)
      u.lang = speechLang
      u.rate = 1
      u.pitch = 1
      const voice = pickVoiceForLang(speechLang)
      if (voice) u.voice = voice

      const done = () => {
        if (finished) return
        finished = true
        if (isStale()) return
        speakBusyRef.current = false
        if (speakTimerRef.current) clearTimeout(speakTimerRef.current)
        speakTimerRef.current = setTimeout(() => flushSpeakQueue(), 40)
      }
      u.onstart = () => { started = true }
      u.onend = done
      u.onerror = done
      window.speechSynthesis.speak(u)

      if (speakTimerRef.current) clearTimeout(speakTimerRef.current)
      speakTimerRef.current = setTimeout(() => {
        if (finished || isStale()) return
        if (started || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          return
        }
        finished = true
        speakBusyRef.current = false
        if (attempt < 2) {
          try { window.speechSynthesis.cancel(); window.speechSynthesis.resume() } catch (_) { /* ignore */ }
          speakQueueRef.current.unshift({ text, speechLang, attempt: attempt + 1 })
          speakTimerRef.current = setTimeout(() => flushSpeakQueue(), 80)
        } else {
          flushSpeakQueue()
        }
      }, 400)
    } catch (e) {
      console.warn(e)
      if (!isStale()) speakBusyRef.current = false
      flushSpeakQueue()
    }
  }

  function speak(text, speechLang) {
    const t = String(text || '').trim()
    if (!audioRef.current || !t) return
    if (!window?.speechSynthesis) return
    const lang = speechLang || findOutputLang(outputLangRef.current).speech
    speakQueueRef.current.push({ text: t, speechLang: lang, attempt: 0 })
    flushSpeakQueue()
  }

  function stopSpeech() {
    speakQueueRef.current = []
    speakBusyRef.current = false
    // Invalida los callbacks (done/timeout) de la utterance que estaba en
    // vuelo — cancel() dispara su onerror/onend de forma asíncrona, y sin
    // esto ese callback tardío podía limpiar/pisar el timer de una
    // utterance NUEVA que ya haya arrancado para cuando llegue.
    speakGenRef.current++
    if (speakTimerRef.current) {
      clearTimeout(speakTimerRef.current)
      speakTimerRef.current = null
    }
    try {
      window.speechSynthesis?.cancel()
      window.speechSynthesis?.resume()
    } catch (_) { /* ignore */ }
  }

  // ── Confirmar seña ────────────────────────────────────────────────────────
  async function triggerRecognition(sign, confidence) {
    const textEs = sign.replace(/_/g, ' ')
    const lang = outputLangRef.current
    const langMeta = findOutputLang(lang)
    let displayText = textEs
    // Nombres deletreados (MARIA): no pasar por traductor palabra-a-palabra.
    const isSpelledName = /^[A-ZÑ]{2,}$/u.test(String(sign || '').toUpperCase())
    if (lang !== 'es' && !isSpelledName) {
      try {
        displayText = await translateFromSpanish(textEs, lang)
      } catch (e) {
        console.warn('Traducción:', e)
        displayText = textEs
      }
    }
    const det = {
      sign,
      text: textEs,
      displayText,
      lang,
      confidence,
    }
    setLatest(det)
    setHistory((h) => [det, ...h].slice(0, 8))
    setSentence((prev) => [...prev, displayText].slice(-10))
    if (sentenceClearRef.current) clearTimeout(sentenceClearRef.current)
    sentenceClearRef.current = setTimeout(() => setSentence([]), 6000)
    speak(displayText, langMeta.speech)
  }

  function flushSpellBuffer() {
    if (spellTimerRef.current) {
      clearTimeout(spellTimerRef.current)
      spellTimerRef.current = null
    }
    const letters = spellBufRef.current
    spellBufRef.current = []
    // Letras sueltas no se anuncian: solo nombres (≥2 letras).
    if (letters.length < 2) {
      if (letters.length === 1) {
        setDisplaySign('')
        setDisplayConf(0)
        updateCaptureHud(0, { showHud: false, status: 'Listo' })
      }
      return
    }
    const name = letters.join('')
    const conf = 1
    setDisplaySign(name)
    setDisplayConf(conf)
    updateCaptureHud(0, {
      showHud: false,
      status: `${name} · deletreo`,
    })
    triggerRecognition(name, conf)
  }

  function updateCaptureHud(_len, { showHud, status }) {
    if (statusTextRef.current && status) {
      statusTextRef.current.textContent = status
    }
    // Solo opacidad: el hueco del HUD está siempre reservado → la card de
    // cámara no baja ni salta entre seña y seña.
    if (!bufferHudRef.current) return
    bufferHudRef.current.style.opacity = showHud ? '1' : '0'
    bufferHudRef.current.dataset.active = showHud ? '1' : '0'
    bufferHudRef.current.setAttribute('aria-hidden', showHud ? 'false' : 'true')
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
    announcedUpRef.current    = ''
    cooldownRef.current       = 0
    apiInFlightRef.current    = false
    lastLiveAtRef.current     = 0
    handVisibleRef.current    = false
    drawLeftRef.current = null
    drawRightRef.current = null
    if (spellTimerRef.current) {
      clearTimeout(spellTimerRef.current)
      spellTimerRef.current = null
    }
    if (letterRepeatTimerRef.current) {
      clearTimeout(letterRepeatTimerRef.current)
      letterRepeatTimerRef.current = null
    }
    spellBufRef.current = []
    if (handBadgeRef.current) handBadgeRef.current.style.display = 'none'
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
    cooldownRef.current       = POST_CONFIRM_WAIT
    landmarkBufferRef.current = []
    predHistRef.current       = []
    prevFrameRef.current      = null
    stillCountRef.current     = 0
    peakMovementRef.current   = 0
    lastLiveAtRef.current     = 0

    inCooldownRef.current = true
    setBufferLen(0)
    setInCooldown(true)

    // Deletreo: acumular letras y emitir el nombre al cerrar el buffer.
    if (isLetterToken(prediction)) {
      spellBufRef.current.push(String(prediction).toUpperCase())
      const partial = spellBufRef.current.join('')
      setDisplaySign(partial)
      setDisplayConf(confidence)
      updateCaptureHud(0, {
        showHud: false,
        status: `${partial} · deletreando…`,
      })
      if (spellTimerRef.current) clearTimeout(spellTimerRef.current)
      spellTimerRef.current = setTimeout(() => flushSpellBuffer(), SPELL_FLUSH_MS)
      // LL / RR: tras el cooldown, liberar la misma letra para el brinco
      // (sin vaciar lastSign al instante → evitar LLLLL al sostener).
      if (letterRepeatTimerRef.current) clearTimeout(letterRepeatTimerRef.current)
      const letter = String(prediction).toUpperCase()
      letterRepeatTimerRef.current = setTimeout(() => {
        if (lastSignRef.current === letter) lastSignRef.current = ''
      }, 420)
      return
    }

    // Seña léxica: cerrar nombre en curso (si había) y luego la seña.
    if (spellBufRef.current.length) flushSpellBuffer()

    setDisplaySign(prediction)
    setDisplayConf(confidence)
    updateCaptureHud(0, { showHud: false, status: `${prediction.replace(/_/g, ' ')} · ${Math.round(confidence * 100)}%` })

    // Ya se anunció esta seña con las manos arriba → no repetir al bajarlas.
    if (announcedUpRef.current === prediction) return
    announcedUpRef.current = prediction
    triggerRecognition(prediction, confidence)
  }

  function runPrediction(frames, { finalize = false } = {}) {
    if (!runningRef.current || !mlAvailableRef.current) return
    if (cooldownRef.current > 0 || apiInFlightRef.current) return
    if (frames.length < MIN_FRAMES) return

    const bufferCopy = padBuffer([...frames])
    apiInFlightRef.current = true

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PREDICT_TIMEOUT_MS)

    ;(async () => {
      try {
        const resp = await fetch(`${ML_API_URL}/predict`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ frames: bufferCopy }),
          signal:  controller.signal,
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

        const { prediction: rawPred, confidence, is_idle } = await resp.json()
        // Cinturón en cliente: forma ILY → TE_AMO; F/separación → COMO↔FAMILIA.
        let prediction = maybeCorrectTeAmo(rawPred || '', bufferCopy)
        const isTeAmoFamily = ['TE_AMO', 'ME_AMAS', 'ME_AMA', 'LO_AMO', 'LA_AMO', 'NOS_AMAMOS', 'YO_TE_AMO'].includes(
          String(prediction || '').toUpperCase(),
        )
        if (!isTeAmoFamily) {
          prediction = maybeCorrectComoFamilia(prediction || rawPred || '', bufferCopy) || ''
        }
        if ((is_idle && !isTeAmoFamily) || !prediction) return

        predHistRef.current.push(prediction)
        if (predHistRef.current.length > STABILITY_NEED) {
          predHistRef.current.shift()
        }
        const stable =
          predHistRef.current.length >= STABILITY_NEED &&
          new Set(predHistRef.current).size === 1

        // Fin de seña: umbral más alto; si ya hubo estabilidad en live, vale
        // UMBRAL normal. Evita confirmar la primera hipótesis al soltar la mano.
        if (
          finalize &&
          prediction !== lastSignRef.current &&
          (
            (stable && confidence >= UMBRAL) ||
            confidence >= FINALIZE_UMBRAL
          )
        ) {
          confirmSign(prediction, confidence)
          return
        }

        // Live: casi nunca 1-shot (HIGH_CONF_INSTANT ≈ 0.96); lo normal es
        // STABILITY_NEED predicciones idénticas por encima del umbral.
        if (
          !finalize &&
          prediction !== lastSignRef.current &&
          confidence >= UMBRAL &&
          (stable || confidence >= HIGH_CONF_INSTANT)
        ) {
          confirmSign(prediction, confidence)
        }
      } catch {
        // Incluye abort por timeout: se trata igual que cualquier otra falla
        // de red. Marca el servidor como no disponible (igual que antes) y
        // muestra el botón de "Reintentar conexión" — evita quedar con el
        // HUD colgado en "Detectando…" sin ninguna explicación ni salida.
        mlAvailableRef.current = false
        setMlMode(false)
      } finally {
        clearTimeout(timer)
        apiInFlightRef.current = false
      }
    })()
  }

  // ── Callback principal de MediaPipe ───────────────────────────────────────
  function handleResults(results) {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video) return

    const hasLeft  = !!results.leftHandLandmarks
    const hasRight = !!results.rightHandLandmarks
    const hasHands = hasLeft || hasRight

    // Overlay: siempre el frame actual. Sin manos → puntos fuera YA
    // (antes NO_HAND_GRACE los dejaba “pegados” ~1 s).
    drawLeftRef.current = hasLeft ? copyHandLandmarks(results.leftHandLandmarks) : null
    drawRightRef.current = hasRight ? copyHandLandmarks(results.rightHandLandmarks) : null

    const wasHandVisible = handVisibleRef.current
    handVisibleRef.current = hasHands
    if (wasHandVisible !== hasHands) {
      // Solo al aparecer/desaparecer (raro), no cada frame.
      setHandVisible(hasHands)
      if (handBadgeRef.current) {
        handBadgeRef.current.style.display = hasHands ? '' : 'none'
      }
    }

    if (cooldownRef.current > 0) cooldownRef.current--

    const cooling = cooldownRef.current > 0
    if (inCooldownRef.current !== cooling) {
      inCooldownRef.current = cooling
      // Cooldown es raro (tras confirmar seña); ahí sí podemos pintar React.
      setInCooldown(cooling)
    }

    // ── Sin manos ────────────────────────────────────────────────────────────
    if (!hasHands) {
      noHandCountRef.current++

      // Parpadeo momentáneo: conservar BUFFER para no romper la seña, pero
      // los puntos ya se limpiaron arriba (no se quedan pegados).
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
      lastLiveAtRef.current     = 0
      handWasVisibleRef.current = false

      const status = !runningRef.current
        ? (cameraOk ? 'Listo' : 'Conectando…')
        : (mlMode ? 'Muestra una mano' : 'Servidor IA no conectado')
      updateCaptureHud(0, { showHud: false, status })

      if (hadHands && snapshot.length >= MIN_FRAMES) {
        runPrediction(snapshot, { finalize: true })
      }

      // Manos fuera un rato: cerrar deletreo en curso (nombre parcial).
      if (noHandCountRef.current >= NO_HAND_RESET && spellBufRef.current.length) {
        flushSpellBuffer()
      }

      if (noHandCountRef.current >= NO_HAND_RESET) {
        predHistRef.current = []
        // Manos fuera del todo: se puede volver a anunciar la misma seña.
        lastSignRef.current = ''
        announcedUpRef.current = ''
      }
      return
    }

    // ── Con manos ────────────────────────────────────────────────────────────
    noHandCountRef.current    = 0
    handWasVisibleRef.current = true

    const currFrame = extractLandmarks(results)   // crudo: alineado con el entrenamiento
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
      const wasGesture =
        peakMovementRef.current >= MOVED_MIN ||
        (len >= HELD_MIN_FRAMES && peakMovementRef.current >= HELD_MOVED_MIN)
      if (movement > peakMovementRef.current) peakMovementRef.current = movement
      const stopThreshold = Math.max(STOP_ABS, peakMovementRef.current * STOP_FRAC)
      // Dinámicas (HOLA…) o sostenidas (TE_AMO, SI…): ambas cuentan como gesto.
      const gestureHappened =
        peakMovementRef.current >= MOVED_MIN ||
        (len >= HELD_MIN_FRAMES && peakMovementRef.current >= HELD_MOVED_MIN)

      // Al ARRANCAR una seña nueva NO limpiamos lastSign aquí: si el usuario
      // baja las manos tras un anuncio en vivo, el finalize no debe volver a
      // decirla. Se puede repetir la misma seña tras sacar las manos del todo
      // (announcedUpRef / lastSign se reinician en NO_HAND_RESET).

      if (movement < stopThreshold) stillCountRef.current++
      else stillCountRef.current = 0

      // Fin de seña (principal): gesto real + pausa breve → predice YA con
      // los frames capturados (padBuffer → SEQ_LEN). No espera 24.
      if (
        !cooling && !apiInFlightRef.current &&
        gestureHappened &&
        stillCountRef.current === STOP_FRAMES &&
        len >= MIN_FRAMES
      ) {
        const snapshot = [...landmarkBufferRef.current]
        landmarkBufferRef.current = []
        peakMovementRef.current   = 0
        lastLiveAtRef.current     = 0
        stillCountRef.current     = 0
        runPrediction(snapshot, { finalize: true })
      }
      // Respaldo en movimiento continuo: desde MIN_FRAMES, cada LIVE_STRIDE
      // frames (estabilidad de 3 predicciones evita falsos positivos).
      else if (
        !cooling && !apiInFlightRef.current &&
        gestureHappened &&
        len >= MIN_FRAMES &&
        (len - lastLiveAtRef.current) >= LIVE_STRIDE
      ) {
        lastLiveAtRef.current = len
        runPrediction(landmarkBufferRef.current)
      }
    }

    const gesturing = peakMovementRef.current >= MOVED_MIN && stillCountRef.current === 0
    const showHud = runningRef.current && mlAvailableRef.current && len > 0 && !cooling
    const status = !runningRef.current
      ? (cameraOk ? 'Listo' : 'Conectando…')
      : !mlMode
        ? 'Servidor IA no conectado'
        : gesturing
          ? 'Escuchando…'
          : len >= MIN_FRAMES
            ? 'Pausa para confirmar…'
            : 'Haz la seña'
    updateCaptureHud(len, { showHud, status, gesturing })
  }

  handleResultsRef.current = handleResults

  // ── Detección + dibujo ─────────────────────────────────────────────────────
  // Detect → paint en el mismo tick (mínima latencia de puntos). Canvas de
  // inferencia chico + blur de fondo (persona nítida) cuando el segmenter listo.
  useEffect(() => {
    let lastVideoTime = -1
    let lastPaintedTime = -1
    let lastPaintedBlur = false
    let overlayCtx = null
    // Máscara sticky: si un frame falla la segmentación, reutilizamos la anterior
    // (evitar apagar el blur → parpadeo).
    let maskReady = false
    if (!detectCanvasRef.current) {
      detectCanvasRef.current = document.createElement('canvas')
      detectCanvasRef.current.width = DETECT_W
      detectCanvasRef.current.height = DETECT_H
    }
    if (!personMaskCanvasRef.current) {
      personMaskCanvasRef.current = document.createElement('canvas')
    }
    if (!personInferMaskRef.current) {
      personInferMaskRef.current = document.createElement('canvas')
    }
    if (!personFeatherCanvasRef.current) {
      personFeatherCanvasRef.current = document.createElement('canvas')
    }
    if (!personLayerCanvasRef.current) {
      personLayerCanvasRef.current = document.createElement('canvas')
    }
    if (!personWorkMaskRef.current) {
      personWorkMaskRef.current = document.createElement('canvas')
    }
    if (!studioBgCanvasRef.current) {
      studioBgCanvasRef.current = document.createElement('canvas')
    }
    if (!displayFrameCanvasRef.current) {
      displayFrameCanvasRef.current = document.createElement('canvas')
    }
    const detectCanvas = detectCanvasRef.current
    const detectCtx = detectCanvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
      desynchronized: true,
    })

    const loop = (ts) => {
      detectRafRef.current = requestAnimationFrame(loop)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video || video.readyState < 2) return

      const hand = handLandmarkerRef.current
      const wantStudio = studioBgRef.current && blurReadyRef.current
      const segmenter = wantStudio ? selfieSegmenterRef.current : null
      const t = video.currentTime
      if (hand && t !== lastVideoTime) {
        lastVideoTime = t
        try {
          detectCtx.drawImage(video, 0, 0, DETECT_W, DETECT_H)
          // Poca luz: subir exposición solo en el canvas de inferencia.
          autoExposeCanvas(detectCtx, DETECT_W, DETECT_H)
          if (segmenter) {
            try {
              segmenter.segmentForVideo(video, ts, (result) => {
                const masks = result?.confidenceMasks
                const mask = masks?.length > 1 ? masks[1] : masks?.[0]
                if (!mask) return
                try {
                  const displayMask = personMaskCanvasRef.current
                  const inferMask = personInferMaskRef.current
                  // Preview: silueta completa (no cortar manos alzadas).
                  if (!fillPersonMaskCanvas(displayMask, mask, {
                    softLo: 0.28,
                    softHi: 0.55,
                  })) return
                  // Inferencia: solo persona principal (quien firma).
                  if (
                    inferMask.width !== displayMask.width ||
                    inferMask.height !== displayMask.height
                  ) {
                    inferMask.width = displayMask.width
                    inferMask.height = displayMask.height
                  }
                  const ictx = inferMask.getContext('2d', { alpha: true })
                  ictx.clearRect(0, 0, inferMask.width, inferMask.height)
                  ictx.drawImage(displayMask, 0, 0)
                  keepPrimaryPersonOnly(inferMask, { keepSatellites: true })
                  solidifyBackgroundFromMask(detectCtx, DETECT_W, DETECT_H, inferMask)
                  maskReady = true
                } finally {
                  try {
                    for (const m of masks || []) m.close?.()
                  } catch { /* ignore */ }
                }
              })
            } catch {
              // Mantener maskReady.
            }
          }
          const handResult = hand.detectForVideo(detectCanvas, ts)
          handleResultsRef.current(adaptHandResult(handResult))
        } catch (e) {
          console.warn('detectForVideo:', e)
        }
      }

      const w = video.videoWidth || 320
      const h = video.videoHeight || 240
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        overlayCtx = null
        lastPaintedTime = -1
      }
      if (!overlayCtx) {
        overlayCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
      }

      const useBlur = !!(segmenter && maskReady)
      if (video.style) {
        video.style.opacity = useBlur ? '0' : '1'
      }

      const frameCanvas = displayFrameCanvasRef.current
      if (frameCanvas.width !== w || frameCanvas.height !== h) {
        frameCanvas.width = w
        frameCanvas.height = h
        lastPaintedTime = -1
      }

      // Solo recomponer cuando hay frame nuevo (el blur es caro).
      if (t !== lastPaintedTime || useBlur !== lastPaintedBlur) {
        lastPaintedTime = t
        lastPaintedBlur = useBlur
        const fctx = frameCanvas.getContext('2d', { alpha: false })
        if (useBlur) {
          composeStudioFrame({
            destCtx: fctx,
            video,
            personMask: personMaskCanvasRef.current,
            workMask: personWorkMaskRef.current,
            featherCanvas: personFeatherCanvasRef.current,
            personLayer: personLayerCanvasRef.current,
            bgCanvas: studioBgCanvasRef.current,
            leftHand: drawLeftRef.current,
            rightHand: drawRightRef.current,
            w,
            h,
          })
        } else {
          fctx.imageSmoothingEnabled = true
          fctx.drawImage(video, 0, 0, w, h)
        }
      }

      try {
        if (useBlur) {
          overlayCtx.clearRect(0, 0, w, h)
          overlayCtx.drawImage(frameCanvas, 0, 0)
        } else {
          overlayCtx.clearRect(0, 0, w, h)
        }
        if (drawLeftRef.current) {
          drawHandDots(overlayCtx, drawLeftRef.current, { color: '#60a5fa', radius: 2.5 })
        }
        if (drawRightRef.current) {
          drawHandDots(overlayCtx, drawRightRef.current, { color: '#c084fc', radius: 2.5 })
        }
      } catch (e) {
        console.warn('Error dibujando landmarks:', e)
      }
    }
    detectRafRef.current = requestAnimationFrame(loop)
    return () => { if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current) }
  }, [])

  // ── Controles ─────────────────────────────────────────────────────────────
  function startDetect() {
    resetPipelineState()
    noHandCountRef.current    = 0
    handWasVisibleRef.current = false
    setRunning(true)
  }

  function stopDetect() {
    setRunning(false)
    stopSpeech()
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
    stopSpeech()
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
    if (bufferLen > 0)             return 'Escuchando…'
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
                <SectionLabel color="purple">Interpretar</SectionLabel>
                <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                  De señas a{' '}
                  <span className="inline-block rounded-xl border-2 border-pastel-purple-line bg-pastel-purple px-2.5 py-0.5 shadow-[0_8px_18px_-8px_rgba(45,42,38,0.35)]">
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
                      ? 'border-pastel-grape bg-gradient-to-br from-pastel-purple via-pastel-purple to-pastel-purple/40'
                      : 'border-pastel-purple-line bg-pastel-purple')
                  }
                >
                  <div className="p-4 pb-0 sm:p-5 sm:pb-0">
                    <div className="mb-3 flex min-h-[3.25rem] items-start justify-between gap-3">
                      <div className="min-w-0">
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
                      {/* Siempre en el layout (opacity); si usáramos display:none
                          la card saltaba al mostrar/ocultar entre señas. */}
                      <div
                        ref={bufferHudRef}
                        data-active="0"
                        className="flex h-[3.25rem] w-[5.5rem] shrink-0 flex-col items-center justify-center rounded-xl border-2 border-white/60 bg-white/80 px-2 opacity-0 transition-opacity duration-200"
                        aria-hidden="true"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-pastel-sub">En vivo</p>
                        <div className="live-dots mt-1.5" aria-hidden="true">
                          <span className="live-dot" />
                          <span className="live-dot" />
                          <span className="live-dot" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                    <div className="relative aspect-video w-full overflow-hidden rounded-[1.25rem] border-2 border-dashed border-pastel-ink/15 bg-[#E8E6E0] shadow-inner [background-image:radial-gradient(rgba(45,42,38,0.08)_1px,transparent_1px)] [background-size:18px_18px]">
                    <video ref={videoRef} autoPlay playsInline muted
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ transform: 'scaleX(-1)' }} />
                    <canvas ref={canvasRef}
                      className="absolute inset-0 h-full w-full pointer-events-none"
                      style={{ transform: 'scaleX(-1)' }} />

                    {/* MediaPipe se precarga en segundo plano al montar. El
                        overlay solo aparece DESPUÉS de conceder la cámara, y
                        únicamente si aún no terminó de cargar — si ya estaba
                        listo, se salta directo a conectar la cámara. */}
                    {cameraConsent === 'accepted' && !scriptsLoaded && !scriptsError && (
                      <CameraOverlay icon="clock" title="Cargando MediaPipe…" />
                    )}
                    {cameraConsent === 'accepted' && scriptsError && (
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
                      <div className="absolute inset-0 flex items-center justify-center bg-pastel-ink/80 p-6">
                        <div className="max-w-sm rounded-2xl border-2 border-pastel-purple-line bg-[#FAF6EC] p-5 text-center shadow-xl">
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

                    <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-xl border-2 border-white/20 bg-black/60 px-2.5 py-1.5 text-xs font-bold text-white">
                      <span className={'h-2 w-2 rounded-full ' + (running ? 'bg-red-400 animate-pulse' : cameraOk ? 'bg-green-400' : 'bg-white/50')} />
                      {running ? 'REC' : cameraOk ? 'Lista' : '…'}
                    </div>
                    <div
                      ref={handBadgeRef}
                      className="absolute right-3 top-3 z-20 rounded-xl border-2 border-pastel-green-line/80 bg-black/65 px-2.5 py-1.5 text-xs font-bold text-pastel-green"
                      style={{ display: handVisible ? undefined : 'none' }}
                    >
                      Manos detectadas
                    </div>

                    {/* Estos overlays van DENTRO del recuadro de video (no de la
                        card completa) para que solo tapen el área de la imagen,
                        no los controles de abajo (ver "Empezar a interpretar"). */}
                    {cameraConsent === null && (
                      <CameraPermissionPrompt
                        onAccept={acceptCameraPermission}
                        onDecline={declineCameraPermission}
                      />
                    )}
                    {cameraConsent === 'declined' && !cameraOk && (
                      <CameraOverlay
                        icon="camera"
                        title="Cámara no activada"
                        subtitle="Sin permiso de cámara no podemos interpretar tus señas. Puedes concederlo cuando quieras."
                        actionLabel="Conceder permisos"
                        onAction={acceptCameraPermission}
                      />
                    )}
                  </div>
                  </div>

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

                    <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border-2 border-white/60 bg-white/80 px-3 py-2 text-sm font-bold text-pastel-ink">
                      <input
                        type="checkbox"
                        checked={studioBg}
                        onChange={(e) => setStudioBg(e.target.checked)}
                        className="h-4 w-4 accent-pastel-grape"
                      />
                      <Icon name="layers" className="h-4 w-4" strokeWidth={2} /> Fondo estudio
                    </label>

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
                      {sentence.join(' ')}
                    </p>
                  </OutputCard>
                )}

                {!running && !history.length && (
                  <div className="rounded-2xl border-2 border-dashed border-pastel-purple-line bg-pastel-purple/40 px-4 py-4 text-center">
                    <p className="text-sm font-bold text-pastel-ink">
                      Pulsa <strong className="text-pastel-grape">Empezar a interpretar</strong>.
                      Haz cada seña con movimiento claro y completa el gesto. Cuando termines, <strong>pausa o quita las manos</strong> del encuadre para confirmar — el sistema espera un poco más de certeza para no adivinar.
                    </p>
                  </div>
                )}
              </AppPageStagger>

              <AppPageStagger className="relative z-20 flex flex-col gap-5 overflow-visible lg:col-span-5">
                {!running && (
                  <LanguagePicker
                    value={outputLang}
                    onChange={setOutputLang}
                    className="w-full"
                  />
                )}
                <div
                  data-tutorial="interpret-results"
                  className="motion-surface animate-motion-scale-in rounded-[1.5rem] border-[3px] border-pastel-purple-line bg-white p-5 shadow-[0_16px_36px_-22px_rgba(45,42,38,0.35)] sm:p-6"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-grape">Última seña</p>
                  {latest ? (
                    <>
                      <p className="mt-3 text-4xl font-extrabold uppercase tracking-tight text-pastel-grape sm:text-5xl">
                        {(latest.displayText || latest.sign.replace(/_/g, ' '))}
                      </p>
                      {latest.lang && latest.lang !== 'es' && (
                        <p className="mt-1 text-xs font-bold text-pastel-sub">
                          Seña: {latest.sign.replace(/_/g, ' ')} · {findOutputLang(latest.lang).label}
                        </p>
                      )}
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs font-bold text-pastel-sub">
                          <span>Confianza</span>
                          <span>{confPct}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full border border-pastel-ink/10 bg-pastel-cream">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-pastel-purple-line to-pastel-grape transition-all duration-500"
                            style={{ width: `${confPct}%` }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 flex flex-col items-center rounded-xl border-2 border-dashed border-pastel-ink/15 bg-white px-4 py-8 text-center [background-image:radial-gradient(rgba(45,42,38,0.06)_1px,transparent_1px)] [background-size:16px_16px]">
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
                  {/* Se ven ~5 sin scroll; el resto queda adentro con scroll
                      interno en vez de estirar la card hacia abajo. */}
                  <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {history.map((h, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-3 rounded-xl border-2 border-pastel-purple-line/50 bg-pastel-purple/20 px-3 py-2"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-extrabold text-pastel-grape">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-sm font-bold text-pastel-ink">
                          {(h.displayText || h.sign.replace(/_/g, ' '))}
                        </span>
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
        <p className="text-xs text-pastel-sub">GNN + LSTM · solo manos · MediaPipe Tasks Vision (GPU)</p>
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
    count: 'border-pastel-purple-line bg-pastel-purple text-pastel-ink',
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
    <div className="camera-ambient-bg absolute inset-0 z-30 flex animate-permission-overlay-in items-center justify-center overflow-y-auto p-3 sm:p-5">
      <div className="my-auto w-full max-w-sm animate-permission-card-in rounded-2xl border-2 border-pastel-purple-line bg-white p-4 text-center shadow-[0_16px_40px_-12px_rgba(45,42,38,0.35)] sm:p-5">
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
    <div className="camera-ambient-bg absolute inset-0 z-30 flex items-center justify-center overflow-y-auto p-4 text-center sm:p-6">
      <div className="my-auto flex w-full max-w-sm flex-col items-center px-2">
        <Icon name={icon} className="h-9 w-9 text-pastel-sub/50" strokeWidth={1.5} />
        <p className="mt-3 text-sm font-semibold text-pastel-sub sm:text-base">{title}</p>
        {subtitle && (
          <p className="mt-2 text-xs font-semibold leading-relaxed text-pastel-sub/80 sm:text-sm">{subtitle}</p>
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

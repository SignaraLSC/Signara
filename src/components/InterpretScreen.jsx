import { useEffect, useRef, useState, useCallback } from 'react'
import Logo from './Logo.jsx'
import HandModel3D from './HandModel3D.jsx'

const MEDIAPIPE_HOLISTIC_VER = '0.5.1675471629'
const MEDIAPIPE_CAM_VER      = '0.3.1675466862'
const MEDIAPIPE_DRAW_VER     = '0.3.1675466124'

const MP_SCRIPTS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@${MEDIAPIPE_HOLISTIC_VER}/holistic.js`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@${MEDIAPIPE_CAM_VER}/camera_utils.js`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@${MEDIAPIPE_DRAW_VER}/drawing_utils.js`,
]

// ── Parámetros ────────────────────────────────────────────────────────────────
const ML_API_URL     = import.meta.env.VITE_ML_API_URL || 'http://localhost:8000'
const SEQ_LEN        = 30
const HAND_COUNT     = 21
const UMBRAL         = 0.75   // confianza mínima
const STABILITY_NEED = 2      // predicciones iguales consecutivas para confirmar
const NO_HAND_RESET  = 20     // frames sin manos para resetear todo
const SAME_SIGN_WAIT = 20     // frames de cooldown tras confirmar seña
const MOVEMENT_MIN   = 0.002  // movimiento mínimo por frame para acumular
const MIN_FRAMES     = 5      // frames mínimos antes de predecir (navegador < 30fps)

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Extrae lh (21×3) + rh (21×3) = 126 valores flat.
 *
 * CORRECCIÓN DE ESPEJO:
 * En Python, el frame se hace cv2.flip(frame,1) ANTES de MediaPipe, por lo que:
 *   - Las coordenadas x están invertidas respecto al frame crudo del navegador
 *   - left_hand_landmarks en Python = mano izquierda ANATÓMICA (la persona)
 *   - En el navegador (frame crudo sin flip):
 *       leftHandLandmarks  = mano DERECHA de la persona (cámara ve su izquierda)
 *       rightHandLandmarks = mano IZQUIERDA de la persona
 * Fix: intercambiar lh↔rh y aplicar x = 1-x para que coincida con el entrenamiento.
 */
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
  // Intercambiar: rightHandLandmarks del navegador = mano izquierda anatómica (slot lh)
  //               leftHandLandmarks  del navegador = mano derecha anatómica  (slot rh)
  return [
    ...handCoords(results.rightHandLandmarks),  // → slot lh (primeros 63)
    ...handCoords(results.leftHandLandmarks),   // → slot rh (últimos 63)
  ]
}

/**
 * Movimiento entre dos frames flat (126 valores).
 * Equivale a: np.abs(a[:, :2] - b[:, :2]).mean() en Python.
 */
function movBetween(prev, curr) {
  let sum = 0, count = 0
  for (let i = 0; i < 126; i += 3) {
    sum += Math.abs(curr[i] - prev[i]) + Math.abs(curr[i + 1] - prev[i + 1])
    count += 2
  }
  return sum / count
}

/**
 * Pad del buffer al inicio repitiendo el primer frame.
 * Equivale a: while len(seq) < SEQ_LEN: seq.insert(0, seq[0])
 */
function padBuffer(buffer) {
  const padded = [...buffer]
  while (padded.length < SEQ_LEN) padded.unshift(padded[0])
  return padded.slice(-SEQ_LEN)
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function InterpretScreen({ onBack, onHome }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const holisticRef = useRef(null)
  const cameraRef   = useRef(null)
  const handModelRef = useRef(null)
  const runningRef  = useRef(false)
  const audioRef    = useRef(true)

  // ── Estado del pipeline (refs = sin re-render innecesario) ─────────────────
  const landmarkBufferRef = useRef([])   // frames con movimiento, maxlen=SEQ_LEN
  const predHistRef       = useRef([])   // historial de predicciones para estabilidad
  const prevFrameRef      = useRef(null) // frame anterior para calcular movimiento
  const noHandCountRef    = useRef(0)    // frames consecutivos sin manos
  const cooldownRef       = useRef(0)    // cooldown frame-based (decrementa c/frame)
  const lastSignRef       = useRef('')   // última seña confirmada (evita repetir)
  const apiInFlightRef    = useRef(false)
  const mlAvailableRef    = useRef(false)
  const sentenceClearRef  = useRef(null)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [scriptsLoaded, setScriptsLoaded] = useState(false)
  const [scriptsError,  setScriptsError]  = useState(null)
  const [cameraOk,      setCameraOk]      = useState(false)
  const [cameraError,   setCameraError]   = useState(null)
  const [running,       setRunning]       = useState(false)
  const [mlMode,        setMlMode]        = useState(false)
  const [mlConnecting,  setMlConnecting]  = useState(false)
  const [audioOn,       setAudioOn]       = useState(true)
  const [handVisible,   setHandVisible]   = useState(false)
  const [bufferLen,     setBufferLen]     = useState(0)
  const [inCooldown,    setInCooldown]    = useState(false)

  // Display: persiste hasta que las manos desaparezcan NO_HAND_RESET frames
  const [displaySign, setDisplaySign] = useState('')
  const [displayConf, setDisplayConf] = useState(0)
  const [latest,      setLatest]      = useState(null)
  const [history,     setHistory]     = useState([])
  const [sentence,    setSentence]    = useState([])

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { audioRef.current   = audioOn  }, [audioOn])

  // Verificar servidor ML
  useEffect(() => {
    let cancelled = false
    setMlConnecting(true)
    fetch(`${ML_API_URL}/health`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const ok = !!data.model_loaded
        mlAvailableRef.current = ok
        setMlMode(ok)
        setMlConnecting(false)
      })
      .catch(() => {
        if (cancelled) return
        mlAvailableRef.current = false
        setMlMode(false)
        setMlConnecting(false)
      })
    return () => { cancelled = true }
  }, [])

  // Cargar MediaPipe
  useEffect(() => {
    let cancelled = false
    loadMediaPipe()
      .then(() => { if (!cancelled) setScriptsLoaded(true) })
      .catch(e  => { if (!cancelled) setScriptsError(String(e.message || e)) })
    return () => { cancelled = true }
  }, [])

  // Inicializar Holistic + cámara
  useEffect(() => {
    if (!scriptsLoaded) return
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
      modelComplexity:        1,
      smoothLandmarks:        true,
      enableSegmentation:     false,
      refineFaceLandmarks:    false,  // no necesitamos cara
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.5,
    })
    holistic.onResults(handleResults)
    holisticRef.current = holistic

    const camera = new CameraCtor(videoEl, {
      onFrame: async () => {
        if (holisticRef.current && videoEl.readyState >= 2) {
          try { await holisticRef.current.send({ image: videoEl }) } catch (_) {}
        }
      },
      width: 640, height: 480,
    })
    cameraRef.current = camera

    camera.start()
      .then(() => setCameraOk(true))
      .catch(e  => setCameraError(
        e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilítalo en tu navegador.'
          : 'No se pudo acceder a la cámara.'
      ))

    return () => {
      try { camera.stop()    } catch (_) {}
      try { holistic.close() } catch (_) {}
      holisticRef.current = null
      cameraRef.current   = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptsLoaded])

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

  // ── Callback principal de MediaPipe ───────────────────────────────────────
  function handleResults(results) {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video) return

    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const hasLeft  = !!results.leftHandLandmarks
    const hasRight = !!results.rightHandLandmarks
    const hasHands = hasLeft || hasRight

    // ── Solo dibuja las manos (igual que 07_gnn_predict.py) ─────────────────
    if (window.drawConnectors && window.drawLandmarks) {
      if (hasLeft) {
        window.drawConnectors(ctx, results.leftHandLandmarks, window.HAND_CONNECTIONS,
          { color: '#3b82f6', lineWidth: 4 })
        window.drawLandmarks(ctx, results.leftHandLandmarks,
          { color: '#60a5fa', lineWidth: 2, radius: 4 })
      }
      if (hasRight) {
        window.drawConnectors(ctx, results.rightHandLandmarks, window.HAND_CONNECTIONS,
          { color: '#9333ea', lineWidth: 4 })
        window.drawLandmarks(ctx, results.rightHandLandmarks,
          { color: '#c084fc', lineWidth: 2, radius: 4 })
      }
    }

    ctx.restore()

    // Actualizar modelo 3D
    handModelRef.current?.update(
      results.leftHandLandmarks  ?? null,
      results.rightHandLandmarks ?? null
    )

    setHandVisible(hasHands)

    // ── Cooldown frame-based (decrementa cada frame) ─────────────────────────
    if (cooldownRef.current > 0) {
      cooldownRef.current--
      setInCooldown(cooldownRef.current > 0)
    }

    // ── Sin manos ────────────────────────────────────────────────────────────
    if (!hasHands) {
      noHandCountRef.current++
      if (noHandCountRef.current >= NO_HAND_RESET) {
        // Reset completo — igual que Python
        landmarkBufferRef.current = []
        predHistRef.current       = []
        prevFrameRef.current      = null
        lastSignRef.current       = ''
        cooldownRef.current       = 0
        setDisplaySign('')
        setDisplayConf(0)
        setBufferLen(0)
        setInCooldown(false)
      }
      prevFrameRef.current = null
      return
    }

    // ── Con manos ────────────────────────────────────────────────────────────
    noHandCountRef.current = 0

    const currFrame = extractLandmarks(results)

    // Calcular movimiento respecto al frame anterior
    let mov = 0
    if (prevFrameRef.current !== null) {
      mov = movBetween(prevFrameRef.current, currFrame)
    }
    prevFrameRef.current = currFrame

    // Solo acumular frames con movimiento real (≥ MOVEMENT_MIN)
    if (mov >= MOVEMENT_MIN) {
      landmarkBufferRef.current.push(currFrame)
      if (landmarkBufferRef.current.length > SEQ_LEN) {
        landmarkBufferRef.current.shift()
      }
    }

    const n = landmarkBufferRef.current.length
    setBufferLen(n)

    // ── Predecir cuando hay frames suficientes ───────────────────────────────
    if (
      runningRef.current &&
      mlAvailableRef.current &&
      n >= MIN_FRAMES &&
      cooldownRef.current === 0 &&
      !apiInFlightRef.current
    ) {
      const bufferCopy = padBuffer([...landmarkBufferRef.current])
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

          if (!is_idle && prediction && confidence >= UMBRAL) {
            predHistRef.current.push(prediction)
            if (predHistRef.current.length > STABILITY_NEED) {
              predHistRef.current.shift()
            }

            // Confirmar si STABILITY_NEED consecutivas iguales y seña nueva
            if (
              predHistRef.current.length >= STABILITY_NEED &&
              new Set(predHistRef.current).size === 1 &&
              prediction !== lastSignRef.current
            ) {
              lastSignRef.current       = prediction
              cooldownRef.current       = SAME_SIGN_WAIT
              landmarkBufferRef.current = []   // limpiar buffer tras confirmación
              predHistRef.current       = []

              setDisplaySign(prediction)
              setDisplayConf(confidence)
              setBufferLen(0)
              setInCooldown(true)

              triggerRecognition(prediction, confidence)
            }
          } else {
            // is_idle o baja confianza → resetear historial de estabilidad
            predHistRef.current = []
          }
        } catch {
          mlAvailableRef.current = false
          setMlMode(false)
        } finally {
          apiInFlightRef.current = false
        }
      })()
    }
  }

  // ── Controles ─────────────────────────────────────────────────────────────
  function startDetect() {
    landmarkBufferRef.current = []
    predHistRef.current       = []
    prevFrameRef.current      = null
    noHandCountRef.current    = 0
    cooldownRef.current       = 0
    lastSignRef.current       = ''
    apiInFlightRef.current    = false
    setBufferLen(0)
    setInCooldown(false)
    setRunning(true)
  }

  function stopDetect() {
    setRunning(false)
    window?.speechSynthesis?.cancel()
  }

  const handleReset = useCallback(() => {
    landmarkBufferRef.current = []
    predHistRef.current       = []
    prevFrameRef.current      = null
    noHandCountRef.current    = 0
    cooldownRef.current       = 0
    lastSignRef.current       = ''
    apiInFlightRef.current    = false
    setLatest(null)
    setHistory([])
    setSentence([])
    setDisplaySign('')
    setDisplayConf(0)
    setBufferLen(0)
    setInCooldown(false)
    if (sentenceClearRef.current) clearTimeout(sentenceClearRef.current)
    window?.speechSynthesis?.cancel()
  }, [])

  function retryMlConnection() {
    setMlConnecting(true)
    fetch(`${ML_API_URL}/health`)
      .then(r => r.json())
      .then(data => {
        const ok = !!data.model_loaded
        mlAvailableRef.current = ok
        setMlMode(ok)
        setMlConnecting(false)
      })
      .catch(() => {
        mlAvailableRef.current = false
        setMlMode(false)
        setMlConnecting(false)
      })
  }

  // ── Status HUD — igual al texto del script Python ─────────────────────────
  const statusLabel = (() => {
    if (!running)                 return cameraOk ? 'Listo' : 'En espera'
    if (!mlMode)                  return '⚠ Servidor IA no conectado'
    if (!handVisible)             return 'Muestra una mano'
    if (displaySign && inCooldown) return `${displaySign.replace(/_/g, ' ')} · ${Math.round(displayConf * 100)}%`
    if (bufferLen >= MIN_FRAMES)  return 'Detectando...'
    if (bufferLen > 0)            return `Moviendo... ${bufferLen}/${MIN_FRAMES}`
    return 'Haz la seña'
  })()

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="min-h-screen flex flex-col px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <button onClick={onBack}
          className="inline-flex items-center gap-2 text-white/85 hover:text-white text-sm font-medium">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Cambiar modo
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={!mlMode && !mlConnecting ? retryMlConnection : undefined}
            className={'flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs ' +
              (!mlMode && !mlConnecting ? 'cursor-pointer hover:bg-white/20 transition' : 'cursor-default')}
            title={!mlMode && !mlConnecting ? 'Reintentar conexión con IA' : undefined}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${
              mlConnecting ? 'bg-yellow-300 animate-pulse' :
              mlMode       ? 'bg-blue-400 animate-pulse'   : 'bg-white/40'
            }`} />
            <span className="text-white/80">
              {mlConnecting ? 'Conectando...' : mlMode ? 'Modo IA' : 'Sin conexión'}
            </span>
          </button>

          <ResetButton onClick={handleReset} />

          <button onClick={onHome} className="flex items-center gap-2 group" title="Inicio">
            <span className="hidden sm:block text-xl font-extrabold gradient-text bg-white px-3 py-1 rounded-full shadow-soft">
              Signara
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/95 shadow-soft group-hover:shadow-glow transition">
              <Logo size={28} />
            </span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 flex-1 animate-fade-up">

        {/* ── Cámara ── */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="relative rounded-4xl overflow-hidden shadow-glow border border-white/70 bg-black aspect-video">
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef}
              className="absolute inset-0 h-full w-full pointer-events-none"
              style={{ transform: 'scaleX(-1)' }} />

            {!scriptsLoaded && !scriptsError && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                Cargando MediaPipe...
              </div>
            )}
            {scriptsError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white p-6">
                <p className="font-semibold text-lg">Error cargando MediaPipe</p>
                <p className="mt-2 text-sm text-white/80">{scriptsError}</p>
              </div>
            )}
            {scriptsLoaded && !cameraOk && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                Solicitando cámara...
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white p-6">
                <p className="font-semibold text-lg">No se pudo iniciar la cámara</p>
                <p className="mt-2 text-sm text-white/80 max-w-sm">{cameraError}</p>
              </div>
            )}

            {/* Status badge — top left */}
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur text-white text-xs font-medium">
              <span className={'inline-block h-2 w-2 rounded-full ' +
                (running ? 'bg-red-400 animate-pulse' : cameraOk ? 'bg-green-400' : 'bg-white/60')} />
              {statusLabel}
            </div>

            {/* Barra de progreso de frames — solo visible cuando hay movimiento */}
            {running && mlMode && handVisible && bufferLen > 0 && !inCooldown && (
              <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur text-white text-xs">
                <div className="w-16 h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-100"
                    style={{
                      width: `${Math.min(100, (bufferLen / MIN_FRAMES) * 100)}%`,
                      background: bufferLen >= MIN_FRAMES ? '#4ade80' : '#facc15'
                    }}
                  />
                </div>
                <span className="tabular-nums">{bufferLen}/{MIN_FRAMES}</span>
              </div>
            )}

            {/* Overlay cuando API no conectada */}
            {running && !mlMode && !mlConnecting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="text-center text-white px-6">
                  <p className="text-2xl mb-2">⚠️</p>
                  <p className="font-bold text-lg">Servidor IA no conectado</p>
                  <p className="text-sm text-white/70 mt-1">Ejecuta en una terminal:</p>
                  <code className="block mt-2 bg-black/50 rounded-lg px-4 py-2 text-xs text-green-300 font-mono">
                    cd sign_ai &amp;&amp; uvicorn api:app --port 8000
                  </code>
                  <button onClick={retryMlConnection}
                    className="mt-4 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-full text-sm font-semibold transition">
                    Reintentar
                  </button>
                </div>
              </div>
            )}

            {/* Seña detectada — bottom center, persiste hasta reset */}
            {displaySign && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full bg-white/95 backdrop-blur text-signara-navy font-bold tracking-wide shadow-soft text-sm whitespace-nowrap">
                {displaySign.replace(/_/g, ' ')} · {Math.round(displayConf * 100)}%
              </div>
            )}
          </div>

          {/* Controles */}
          <div className="flex flex-wrap items-center gap-3">
            {!running ? (
              <button onClick={startDetect} disabled={!cameraOk}
                className="btn-primary py-2.5 px-5 text-sm disabled:opacity-50 inline-flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Empezar a interpretar
              </button>
            ) : (
              <button onClick={stopDetect}
                className="btn-primary py-2.5 px-5 text-sm inline-flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Detener
              </button>
            )}
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-white/90 cursor-pointer select-none">
              <input type="checkbox" checked={audioOn} onChange={e => setAudioOn(e.target.checked)}
                className="h-4 w-4 accent-signara-purple" />
              Leer en voz alta
            </label>
          </div>

          {/* Oración acumulada */}
          {sentence.length > 0 && (
            <div className="glass-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-signara-purple">
                Conversación
              </p>
              <p className="mt-2 text-signara-navy text-xl font-bold leading-relaxed tracking-wide">
                {sentence.map(s => s.replace(/_/g, ' ')).join(' ')}
              </p>
            </div>
          )}
        </div>

        {/* ── Panel lateral ── */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Modelo 3D de manos */}
          <div className="glass-card overflow-hidden p-0 relative">
            <HandModel3D
              ref={handModelRef}
              className="w-full h-52 rounded-2xl"
            />
            <span className="absolute top-2 left-3 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50 pointer-events-none">
              Vista 3D · arrastra para rotar
            </span>
          </div>

          {/* Última detección */}
          <div className="glass-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-signara-purple">
              Última detección
            </p>
            {latest ? (
              <div className="mt-2">
                <p className="text-3xl font-extrabold gradient-text">
                  {latest.sign.replace(/_/g, ' ')}
                </p>
                <p className="mt-2 text-xs text-signara-navy/60">
                  Confianza: {Math.round((latest.confidence || 0) * 100)}%
                </p>
              </div>
            ) : (
              <p className="mt-2 italic text-signara-navy/40">
                Pulsa <strong>Empezar a interpretar</strong> y haz una seña.
              </p>
            )}
          </div>

          {/* Historial */}
          <div className="glass-card p-5 flex-1 min-h-[180px]">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-signara-purple">
              Historial
            </p>
            {history.length === 0 ? (
              <p className="mt-2 italic text-signara-navy/40">Aquí verás cada seña reconocida.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {history.map((h, i) => (
                  <li key={i} className="flex items-baseline gap-3">
                    <span className="chip">{h.sign.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] text-signara-navy/50 ml-auto">
                      {Math.round((h.confidence || 0) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <footer className="mt-6 text-center text-xs text-white/60">
        {mlMode ? 'GNN + LSTM · solo manos · MediaPipe' : 'Reconocimiento con IA · GNN + LSTM'}
      </footer>
    </section>
  )
}

function ResetButton({ onClick }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 border border-white/30 text-white text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/40"
      title="Reiniciar todo">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      LIMPIAR
    </button>
  )
}

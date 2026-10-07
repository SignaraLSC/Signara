import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import useVoiceInput from '../hooks/useVoiceInput.js'
import Icon from './Icon.jsx'

const EXAMPLES = [
  { text: 'Hola, ¿cómo estás?', icon: 'wave' },
  { text: 'Ayúdame', icon: 'help' },
  { text: 'Tengo sed', icon: 'droplet' },
  { text: 'Te amo', icon: 'heart' },
]

const TextInputPanel = forwardRef(function TextInputPanel(
  {
    initialMode = 'text',
    onSubmit,
    onLiveWord,
    onVoiceEnd,
    onListeningChange,
    busy = false,
    pendingWord = '',
    missedWord = '',
    voiceLang = 'es-ES',
    topSlot = null,
  },
  ref
) {
  const [value, setValue] = useState('')
  const [inputMode, setInputMode] = useState(initialMode === 'voice' ? 'voice' : 'text')
  const inputRef = useRef(null)

  const onSubmitRef = useRef(onSubmit)
  const onLiveWordRef = useRef(onLiveWord)
  const onVoiceEndRef = useRef(onVoiceEnd)
  const onListeningChangeRef = useRef(onListeningChange)
  onSubmitRef.current = onSubmit
  onLiveWordRef.current = onLiveWord
  onVoiceEndRef.current = onVoiceEnd
  onListeningChangeRef.current = onListeningChange

  const liveEmittedRef = useRef([])
  // Tras limpiar la barra en voz, el API sigue mandando el transcript COMPLETO
  // de la sesión. Solo mostramos/emitimos a partir de este índice (no
  // reiniciamos liveEmittedRef — eso re-disparaba todas las señas).
  const displayFromRef = useRef(0)

  // Reconocimiento de voz: el texto interim/final puede llegar acumulado o como
  // delta. Solo emitimos palabras NUEVAS respecto a lo ya enviado. Si el
  // interim se acorta (el motor corrige), NO reiniciamos ni re-emitimos: eso
  // duplicaba señas. Solo reiniciamos si el prefijo deja de coincidir.
  function normW(w) {
    return String(w || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  }
  function emitNewWords(allWords) {
    const prev = liveEmittedRef.current
    let common = 0
    while (
      common < prev.length &&
      common < allWords.length &&
      normW(prev[common]) === normW(allWords[common])
    ) common++

    // TEMPORAL: mismo flag que useVoiceInput.js — window.__SIGNARA_VOICE_DEBUG = true
    if (typeof window !== 'undefined' && window.__SIGNARA_VOICE_DEBUG) {
      console.log('[voz][emitNewWords]', { prev: prev.slice(), allWords: allWords.slice(), common })
    }

    // Prefijo roto (reinicio del transcript): NO re-emitir lo ya enviado
    // desde el último clear. Si no, en inglés/otro idioma la 1ª palabra
    // (p.ej. "hello") se traduce y seña dos veces.
    if (common < prev.length && common < allWords.length) {
      const already = prev.slice(displayFromRef.current)
      let shared = 0
      while (
        shared < already.length &&
        shared < allWords.length &&
        normW(already[shared]) === normW(allWords[shared])
      ) shared++
      for (let i = shared; i < allWords.length; i++) {
        const w = allWords[i]
        if (w && onLiveWordRef.current) onLiveWordRef.current(w)
      }
      liveEmittedRef.current = prev.slice(0, displayFromRef.current).concat(allWords)
      return
    }

    // Acortó pero sigue siendo prefijo: no re-emitir.
    if (allWords.length < prev.length) {
      liveEmittedRef.current = allWords.slice()
      return
    }

    for (let i = prev.length; i < allWords.length; i++) {
      const w = allWords[i]
      if (!w) continue
      if (onLiveWordRef.current) onLiveWordRef.current(w)
    }
    liveEmittedRef.current = allWords.slice()
  }

  function handleLive(text) {
    const cleaned = String(text || '').trim()
    const words = cleaned.split(/\s+/).filter(Boolean)
    // Barra: solo lo dicho desde el último clear (no todo el historial de sesión).
    setValue(words.slice(displayFromRef.current).join(' '))
    // También enviamos la última palabra interim. El reconocedor puede
    // mostrarla en pantalla y no volver a emitir otro evento cuando la marca
    // como final; si la excluimos, frases como "cómo estás" dejan pasar
    // únicamente "cómo" al avatar. `emitNewWords` conserva el prefijo y
    // deduplica la confirmación posterior, mientras la ventana contextual
    // decide si esa palabra ya es una seña o todavía debe esperar otra.
    emitNewWords(words)
  }

  // Tras traducir: barra vacía. En voz HAY que conservar liveEmittedRef —
  // el reconocedor reenvía todo el transcript tras cada pausa; si lo
  // reseteamos, se re-emiten (y se re-apendan a "Lo que dijiste") todas
  // las palabras otra vez.
  function clearBar({ keepVoiceMemory = false } = {}) {
    setValue('')
    if (keepVoiceMemory) {
      displayFromRef.current = liveEmittedRef.current.length
    } else {
      liveEmittedRef.current = []
      displayFromRef.current = 0
    }
  }

  const { listening, error, supported, start, stop } = useVoiceInput({
    lang: voiceLang || 'es-ES',
    continuous: true,
    onLiveTranscript: handleLive,
    onResult: (text) => {
      if (!text) return
      if (onSubmitRef.current) onSubmitRef.current(text, { fromVoice: true })
      clearBar({ keepVoiceMemory: true })
    }
  })

  useEffect(() => {
    onListeningChangeRef.current?.(listening)
  }, [listening])

  function stopMicAndNotify() {
    stop()
    if (onVoiceEndRef.current) onVoiceEndRef.current()
  }

  const listeningRef = useRef(listening)
  const stopRef = useRef(stopMicAndNotify)
  listeningRef.current = listening
  stopRef.current = stopMicAndNotify

  // Si cambia el idioma de entrada mientras escucha, reiniciar el mic.
  const prevVoiceLangRef = useRef(voiceLang)
  useEffect(() => {
    if (prevVoiceLangRef.current === voiceLang) return
    prevVoiceLangRef.current = voiceLang
    if (!listeningRef.current) return
    try { stop() } catch (_) { /* ignore */ }
    const t = setTimeout(() => { try { start() } catch (_) { /* ignore */ } }, 200)
    return () => clearTimeout(t)
  }, [voiceLang, start, stop])

  useImperativeHandle(ref, () => ({
    clear: () => {
      if (listeningRef.current) {
        try { stopRef.current() } catch (_) {}
      }
      setInputMode('text')
      clearBar({ keepVoiceMemory: false })
    },
    isListening: () => listeningRef.current,
    stopMic: () => { if (listeningRef.current) stopRef.current() }
  }))

  useEffect(() => {
    if (initialMode === 'voice' && supported && !listening) {
      const t = setTimeout(() => { setInputMode('voice'); start() }, 350)
      return () => clearTimeout(t)
    }
    // En móvil no autofocus: abre el teclado y tapa el avatar.
    if (initialMode === 'text' && inputRef.current) {
      const coarse = typeof window !== 'undefined'
        && window.matchMedia('(pointer: coarse)').matches
      if (!coarse) inputRef.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode, supported])

  useEffect(() => {
    if (listening) setInputMode('voice')
  }, [listening])

  function revealAvatar() {
    try { inputRef.current?.blur() } catch (_) { /* ignore */ }
    if (typeof document === 'undefined') return
    requestAnimationFrame(() => {
      document.querySelector('.ta-avatar')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  }

  function submit(e) {
    if (e?.preventDefault) e.preventDefault()
    const text = value.trim()
    if (!text || busy) return
    if (listening) stopMicAndNotify()
    if (onSubmit) onSubmit(text, { fromVoice: false })
    clearBar()
    // Cerrar teclado en móvil para que el avatar no quede tapado.
    revealAvatar()
  }

  function pickTextMode() {
    if (listening) stopMicAndNotify()
    setInputMode('text')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function pickVoiceMode() {
    if (!supported || busy) return
    setInputMode('voice')
    clearBar({ keepVoiceMemory: false })
    start()
  }

  function runExample(text) {
    if (busy || listening) return
    setInputMode('text')
    if (onSubmit) onSubmit(text, { fromVoice: false })
    clearBar()
    // En móvil el foco abría el teclado y tapaba el avatar.
    revealAvatar()
  }

  return (
    // display:contents: el <form> desaparece de la caja visual y sus dos
    // mitades (ta-tabsinput / ta-examples) pasan a ser items directos de la
    // grilla .translate-layout del padre — así el avatar puede intercalarse
    // ENTRE ellas en móvil sin duplicar el componente ni romper el submit.
    <form onSubmit={submit} className="contents">
      <div className="ta-tabsinput animate-motion-enter" data-tutorial="translate-input">
        {topSlot ? <div className="mb-3">{topSlot}</div> : null}
        {/* Selector de modo */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <ModeTab
            active={inputMode === 'text' && !listening}
            icon={<PenIcon />}
            label="Escribir"
            hint="Texto + Traducir"
            onClick={pickTextMode}
          />
          <ModeTab
            active={inputMode === 'voice' || listening}
            icon={<MicIcon />}
            label="Hablar"
            hint="Micrófono en vivo"
            onClick={pickVoiceMode}
            disabled={!supported || busy}
          />
        </div>

        <div
          className={
            'overflow-hidden rounded-[1.25rem] border-[3px] bg-white shadow-[0_12px_28px_-16px_rgba(45,42,38,0.35)] transition ' +
            (listening
              ? 'border-palette-azure ring-4 ring-pastel-blue/40'
              : 'border-pastel-blue-line')
          }
        >
          <div className="flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
            <button
              type="button"
              onClick={listening ? stopMicAndNotify : pickVoiceMode}
              disabled={!supported}
              title={supported ? (listening ? 'Detener micrófono' : 'Activar micrófono') : 'Voz no disponible'}
              className={
                'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-pastel-blue/40 sm:h-12 sm:w-12 ' +
                (listening
                  ? 'bg-palette-azure text-white shadow-[0_8px_24px_-6px_rgba(46,124,248,0.55)]'
                  : 'border-2 border-pastel-ink/15 bg-pastel-blue/60 text-palette-azure hover:border-pastel-blue-line hover:bg-pastel-blue') +
                (!supported ? ' opacity-40 cursor-not-allowed' : '')
              }
              aria-pressed={listening}
            >
              {listening && <span className="absolute inset-0 rounded-xl bg-palette-azure/30 animate-pulse-ring" />}
              <MicIcon size={22} />
            </button>

            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => { if (listening) stopMicAndNotify(); setInputMode('text') }}
              placeholder={
                listening
                  ? 'Habla ahora — el avatar señará al instante'
                  : 'Escribe aquí tu mensaje en español…'
              }
              className="min-w-0 flex-1 bg-transparent outline-none px-1 py-2 text-base font-semibold text-pastel-ink placeholder:text-pastel-sub/70 sm:text-lg"
              disabled={busy}
            />

            {!listening && (
              <button
                type="submit"
                disabled={busy || !value.trim()}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-palette-azure px-3 text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(46,124,248,0.5)] transition hover:brightness-105 focus:outline-none focus:ring-4 focus:ring-pastel-blue disabled:cursor-not-allowed disabled:opacity-50 sm:h-12 sm:gap-2 sm:px-4"
              >
                {busy ? <Spinner /> : (
                  <>
                    <span className="hidden min-[400px]:inline">Traducir</span>
                    <ArrowIcon />
                  </>
                )}
              </button>
            )}

            {listening && (
              <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-palette-azure px-3 text-xs font-extrabold text-white sm:h-12 sm:px-3.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                EN VIVO
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="ta-examples animate-motion-enter [animation-delay:70ms]">
        {/* Ejemplos rápidos */}
        {!listening && (
          <div data-tutorial="translate-examples">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-palette-azure">
              Prueba con un clic
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {EXAMPLES.map(({ text, icon }) => (
                <button
                  key={text}
                  type="button"
                  disabled={busy}
                  onClick={() => runExample(text)}
                  className="group flex flex-col items-center gap-1 rounded-2xl border-2 border-pastel-ink/10 bg-white px-2 py-3 text-center transition hover:-translate-y-0.5 hover:border-pastel-blue-line hover:bg-pastel-blue/50 hover:shadow-[0_10px_24px_-14px_rgba(45,42,38,0.35)] disabled:opacity-50"
                >
                  <Icon name={icon} className="h-6 w-6 text-palette-azure transition group-hover:scale-110" strokeWidth={1.75} />
                  <span className="text-[11px] font-bold leading-tight text-pastel-ink sm:text-xs">{text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {listening && (
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-pastel-sub">
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-pastel-blue-line/60 bg-pastel-blue/60 px-3 py-1 text-palette-azure">
              <span className="h-1.5 w-1.5 rounded-full bg-palette-azure animate-pulse" />
              Escuchando… cada palabra se convierte en seña
            </span>
            {pendingWord && (
              <span className="inline-flex items-center gap-1 rounded-full border-2 border-pastel-blue-line bg-pastel-blue px-2.5 py-1 text-palette-azure animate-pulse">
                &quot;{pendingWord}&quot;…
              </span>
            )}
            {missedWord && (
              <span className="inline-flex items-center rounded-full border-2 border-pastel-ink/10 bg-white px-2.5 py-1 line-through opacity-60">
                {missedWord}
              </span>
            )}
          </div>
        )}

        {!supported && (
          <p className="mt-2 text-xs font-bold text-pastel-pink">Tu navegador no soporta reconocimiento de voz.</p>
        )}
        {error && error !== 'no-speech' && error !== 'aborted' && (
          <p className="mt-2 text-xs font-bold text-pastel-pink">Error de voz: {error}</p>
        )}
      </div>
    </form>
  )
})

export default TextInputPanel

function ModeTab({ active, icon, label, hint, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center gap-2.5 rounded-2xl border-[3px] px-3 py-3 text-left transition sm:px-4 ' +
        (active
          ? 'border-pastel-blue-line bg-pastel-blue shadow-[0_10px_24px_-12px_rgba(46,124,248,0.35)] scale-[1.02]'
          : 'border-pastel-ink/10 bg-white hover:border-pastel-blue-line hover:bg-pastel-blue/30') +
        (disabled ? ' opacity-40 cursor-not-allowed' : '')
      }
    >
      <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 ' + (active ? 'border-pastel-blue-line bg-white text-palette-azure' : 'border-pastel-ink/10 bg-pastel-cream text-pastel-ink')}>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-extrabold text-pastel-ink">{label}</span>
        <span className="block text-[10px] font-semibold text-pastel-sub sm:text-xs">{hint}</span>
      </span>
    </button>
  )
}

function MicIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

function PenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

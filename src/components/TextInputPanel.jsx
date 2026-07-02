import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import useVoiceInput from '../hooks/useVoiceInput.js'

const EXAMPLES = [
  { text: 'Hola, ¿cómo estás?', emoji: '👋' },
  { text: 'Necesito ayuda', emoji: '🆘' },
  { text: 'Tengo sed', emoji: '💧' },
  { text: 'Te amo', emoji: '❤️' },
]

const TextInputPanel = forwardRef(function TextInputPanel(
  { initialMode = 'text', onSubmit, onLiveWord, busy = false, pendingWord = '', missedWord = '' },
  ref
) {
  const [value, setValue] = useState('')
  const [inputMode, setInputMode] = useState(initialMode === 'voice' ? 'voice' : 'text')
  const inputRef = useRef(null)

  const onSubmitRef = useRef(onSubmit)
  const onLiveWordRef = useRef(onLiveWord)
  onSubmitRef.current = onSubmit
  onLiveWordRef.current = onLiveWord

  const liveEmittedRef = useRef([])

  function emitNewWords(allWords) {
    const prev = liveEmittedRef.current
    for (let i = prev.length; i < allWords.length; i++) {
      const w = allWords[i]
      if (!w) continue
      if (onLiveWordRef.current) onLiveWordRef.current(w)
    }
    liveEmittedRef.current = allWords
  }

  function handleLive(text, isFinal) {
    const cleaned = String(text || '').trim()
    setValue(cleaned)
    const words = cleaned.split(/\s+/).filter(Boolean)
    if (isFinal) {
      emitNewWords(words)
      liveEmittedRef.current = []
    } else {
      emitNewWords(words.slice(0, -1))
    }
  }

  const { listening, error, supported, start, stop } = useVoiceInput({
    lang: 'es-ES',
    continuous: true,
    onLiveTranscript: handleLive,
    onResult: (text) => {
      if (!text) return
      if (onSubmitRef.current) onSubmitRef.current(text)
    }
  })

  const listeningRef = useRef(listening)
  const stopRef = useRef(stop)
  listeningRef.current = listening
  stopRef.current = stop

  useImperativeHandle(ref, () => ({
    clear: () => {
      if (listeningRef.current) {
        try { stopRef.current() } catch (_) {}
      }
      setValue('')
      setInputMode('text')
      liveEmittedRef.current = []
    },
    isListening: () => listeningRef.current,
    stopMic: () => { if (listeningRef.current) stopRef.current() }
  }))

  useEffect(() => {
    if (initialMode === 'voice' && supported && !listening) {
      const t = setTimeout(() => { setInputMode('voice'); start() }, 350)
      return () => clearTimeout(t)
    }
    if (initialMode === 'text' && inputRef.current) inputRef.current.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode, supported])

  useEffect(() => {
    if (listening) setInputMode('voice')
  }, [listening])

  function submit(e) {
    if (e?.preventDefault) e.preventDefault()
    const text = value.trim()
    if (!text || busy) return
    if (onSubmit) onSubmit(text)
  }

  function pickTextMode() {
    if (listening) stop()
    setInputMode('text')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function pickVoiceMode() {
    if (!supported || busy) return
    setInputMode('voice')
    setValue('')
    liveEmittedRef.current = []
    start()
  }

  function runExample(text) {
    if (busy || listening) return
    setValue(text)
    setInputMode('text')
    if (onSubmit) onSubmit(text)
  }

  return (
    <form onSubmit={submit} className="w-full" data-tutorial="translate-input">
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
            ? 'border-pastel-grape ring-4 ring-pastel-purple/30'
            : inputMode === 'voice'
              ? 'border-pastel-purple-line'
              : 'border-pastel-green-line')
        }
      >
        <div className="flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
          <button
            type="button"
            onClick={listening ? stop : pickVoiceMode}
            disabled={!supported}
            title={supported ? (listening ? 'Detener micrófono' : 'Activar micrófono') : 'Voz no disponible'}
            className={
              'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-pastel-purple/30 sm:h-12 sm:w-12 ' +
              (listening
                ? 'bg-pastel-grape text-white shadow-[0_8px_24px_-6px_rgba(126,100,201,0.7)]'
                : 'border-2 border-pastel-ink/15 bg-pastel-purple/40 text-pastel-grape hover:border-pastel-grape hover:bg-pastel-purple') +
              (!supported ? ' opacity-40 cursor-not-allowed' : '')
            }
            aria-pressed={listening}
          >
            {listening && <span className="absolute inset-0 rounded-xl bg-pastel-grape/30 animate-pulse-ring" />}
            <MicIcon size={22} />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => { if (listening) stop(); setInputMode('text') }}
            placeholder={
              listening
                ? '🎤 Habla ahora — el avatar señará al instante'
                : 'Escribe aquí tu mensaje en español…'
            }
            className="min-w-0 flex-1 bg-transparent outline-none px-1 py-2 text-base font-semibold text-pastel-ink placeholder:text-pastel-sub/70 sm:text-lg"
            disabled={busy}
          />

          {!listening && (
            <button
              type="submit"
              disabled={busy || !value.trim()}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-pastel-grape px-3 text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(126,100,201,0.6)] transition hover:brightness-105 focus:outline-none focus:ring-4 focus:ring-pastel-purple disabled:cursor-not-allowed disabled:opacity-50 sm:h-12 sm:gap-2 sm:px-4"
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
            <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-pastel-grape px-3 text-xs font-extrabold text-white sm:h-12 sm:px-3.5">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              EN VIVO
            </span>
          )}
        </div>
      </div>

      {/* Ejemplos rápidos */}
      {!listening && (
        <div className="mt-4" data-tutorial="translate-examples">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-pastel-grape">
            Prueba con un clic
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EXAMPLES.map(({ text, emoji }) => (
              <button
                key={text}
                type="button"
                disabled={busy}
                onClick={() => runExample(text)}
                className="group flex flex-col items-center gap-1 rounded-2xl border-2 border-pastel-ink/10 bg-white px-2 py-3 text-center transition hover:-translate-y-0.5 hover:border-pastel-green-line hover:bg-pastel-green/50 hover:shadow-[0_10px_24px_-14px_rgba(45,42,38,0.35)] disabled:opacity-50"
              >
                <span className="text-2xl transition group-hover:scale-110">{emoji}</span>
                <span className="text-[11px] font-bold leading-tight text-pastel-ink sm:text-xs">{text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {listening && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-pastel-sub">
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-pastel-grape/30 bg-pastel-purple/40 px-3 py-1 text-pastel-grape">
            <span className="h-1.5 w-1.5 rounded-full bg-pastel-grape animate-pulse" />
            Escuchando… cada palabra se convierte en seña
          </span>
          {pendingWord && (
            <span className="inline-flex items-center gap-1 rounded-full border-2 border-pastel-purple-line bg-pastel-purple px-2.5 py-1 text-pastel-grape animate-pulse">
              "{pendingWord}"…
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
          ? 'border-pastel-grape bg-pastel-purple shadow-[0_10px_24px_-12px_rgba(126,100,201,0.5)] scale-[1.02]'
          : 'border-pastel-ink/10 bg-white hover:border-pastel-green-line hover:bg-pastel-green/30') +
        (disabled ? ' opacity-40 cursor-not-allowed' : '')
      }
    >
      <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 ' + (active ? 'border-pastel-grape bg-white text-pastel-grape' : 'border-pastel-ink/10 bg-pastel-cream text-pastel-ink')}>
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

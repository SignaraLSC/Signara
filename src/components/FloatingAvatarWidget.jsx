import { useCallback, useEffect, useRef, useState } from 'react'
import AvatarSignerVRM from './AvatarSignerVRM.jsx'
import Icon from './Icon.jsx'
import useVoiceInput from '../hooks/useVoiceInput.js'
import useSystemAudio from '../hooks/useSystemAudio.js'
import FloatingAvatarTutorial from './FloatingAvatarTutorial.jsx'
import { needsFloatingTutorial, rememberFloatingTutorial } from '../utils/floatingAvatarTutorial.js'
import { ML_API_URL } from '../utils/mlApi.js'
import { resolveDirectionalForm } from '../utils/directionalVerbs.js'
import { tryFingerspellSuffix } from '../utils/fingerspell.js'
import { compileSignPlanToPlayTokens } from '../utils/signPlan.js'
import { planSpanishToLsc } from '../utils/lscGrammarPlanner.js'
import { inspectSemanticPrefix } from '../utils/semanticCatalog.js'
import {
  flushContextWindow,
  pushContextWord,
} from '../utils/contextualSignWindow.js'
import {
  analyzeConversationTurn,
  createConversationContext,
} from '../utils/conversationContext.js'
import {
  hideDesktopWindow,
  isTauriDesktop,
  minimizeDesktopWindow,
  showDesktopMainWindow,
  startDesktopDrag,
  startDesktopResize,
} from '../utils/desktopWindow.js'

function fallbackTokens(words, available) {
  const output = []
  let i = 0
  while (i < words.length) {
    let hit = null
    let consumed = 0
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const slice = words.slice(i, i + n)
      const directional = resolveDirectionalForm(slice, available)
      if (directional) { hit = [directional]; consumed = n; break }
      const literal = slice.join('_')
      if (available.includes(literal)) { hit = [literal]; consumed = n; break }
    }
    if (!hit) {
      const spelled = tryFingerspellSuffix(words.slice(i, i + 1), available)
      if (spelled) { hit = spelled.tokens; consumed = 1 }
    }
    if (hit) output.push(...hit)
    i += consumed || 1
  }
  return output
}

export default function FloatingAvatarWidget() {
  const signerRef = useRef(null)
  const availableRef = useRef([])
  const conversationRef = useRef(createConversationContext())
  const sourceRef = useRef(null)
  const sourceChangeRef = useRef(0)
  const voiceContextWordsRef = useRef([])
  const voiceCommitTimerRef = useRef(null)
  const [available, setAvailable] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(needsFloatingTutorial)
  const tutorialHelpRef = useRef(null)
  const tutorialClosedRef = useRef(false)
  const desktop = isTauriDesktop()

  useEffect(() => {
    if (!tutorialOpen && tutorialClosedRef.current) tutorialHelpRef.current?.focus()
  }, [tutorialOpen])

  useEffect(() => {
    document.documentElement.classList.add('signara-overlay')
    document.body.classList.add('signara-overlay')
    fetch(`${ML_API_URL}/animations`)
      .then((response) => response.json())
      .then((data) => {
        availableRef.current = data?.tokens || []
        setAvailable(availableRef.current.length > 0)
      })
      .catch(() => setAvailable(false))
    return () => {
      document.documentElement.classList.remove('signara-overlay')
      document.body.classList.remove('signara-overlay')
    }
  }, [])

  const queueTokens = useCallback((tokens) => {
    if (signerRef.current?.queueBatch) signerRef.current.queueBatch(tokens)
    else for (const token of tokens || []) signerRef.current?.queue(token)
  }, [])

  const planTokens = useCallback((text, source = 'voice') => {
    const updated = analyzeConversationTurn(text, conversationRef.current)
    conversationRef.current = updated
    const plan = planSpanishToLsc({
      sourceText: text,
      availableTokens: availableRef.current,
      fallbackResolver: fallbackTokens,
      context: updated,
      source,
    })
    const tokens = compileSignPlanToPlayTokens(plan)
    return tokens
  }, [])

  const commitContextUnits = useCallback((units) => {
    const tokens = []
    for (const unit of units || []) {
      if (unit?.sourceText) tokens.push(...planTokens(unit.sourceText, 'voice'))
    }
    queueTokens(tokens)
  }, [planTokens, queueTokens])

  const flushVoiceContext = useCallback(() => {
    if (!voiceContextWordsRef.current.length) return
    // Una pausa/interim no significa que terminó la frase: "cómo" puede
    // convertirse en COMO_ESTAS y "tengo" en TENGO_SED. Mantener esos
    // prefijos evita que el fallback los convierta prematuramente en letras.
    if (inspectSemanticPrefix(voiceContextWordsRef.current).extensions.length) return
    const result = flushContextWindow(voiceContextWordsRef.current, {
      availableTokens: availableRef.current,
      fallbackResolver: fallbackTokens,
      source: 'voice',
    })
    voiceContextWordsRef.current = []
    commitContextUnits(result.committed)
  }, [commitContextUnits])

  const commitVoiceTranscript = useCallback((text) => {
    if (!text?.trim()) return
    const result = pushContextWord(voiceContextWordsRef.current, text, {
      availableTokens: availableRef.current,
      fallbackResolver: fallbackTokens,
      source: 'voice',
    })
    voiceContextWordsRef.current = result.pendingWords
    commitContextUnits(result.committed)
  }, [commitContextUnits])

  const handleConfirmedTranscript = useCallback((text) => {
    if (voiceCommitTimerRef.current) clearTimeout(voiceCommitTimerRef.current)
    // Ambas fuentes entregan solo audio nuevo confirmado. Nunca interims ni
    // el historial: «se» provisional no se reproduce antes de «sed».
    commitVoiceTranscript(text)
    voiceCommitTimerRef.current = setTimeout(flushVoiceContext, 1200)
  }, [commitVoiceTranscript, flushVoiceContext])

  const voice = useVoiceInput({
    lang: 'es-CO',
    continuous: true,
    onResult: text => { if (sourceRef.current === 'mic') handleConfirmedTranscript(text) },
  })
  const systemAudio = useSystemAudio({
    onResult: text => { if (sourceRef.current === 'system') handleConfirmedTranscript(text) },
  })
  const stopMicrophone = voice.stop
  const stopSystemAudio = systemAudio.stop

  const stopSources = useCallback(async () => {
    sourceRef.current = null
    if (voiceCommitTimerRef.current) clearTimeout(voiceCommitTimerRef.current)
    voiceContextWordsRef.current = []
    stopMicrophone()
    await stopSystemAudio()
  }, [stopMicrophone, stopSystemAudio])

  async function toggleMicrophone() {
    const change = ++sourceChangeRef.current
    const wasMic = sourceRef.current === 'mic' && voice.listening
    await stopSources()
    if (change !== sourceChangeRef.current) return
    if (!wasMic) {
      sourceRef.current = 'mic'
      voice.start()
    }
  }

  async function toggleSystemAudio() {
    const change = ++sourceChangeRef.current
    const wasSystem = sourceRef.current === 'system' && systemAudio.active
    await stopSources()
    if (change !== sourceChangeRef.current) return
    if (!wasSystem) {
      sourceRef.current = 'system'
      await systemAudio.start()
    }
  }

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    let unlisten
    import('@tauri-apps/api/event').then(({ listen }) => listen('signara-overlay-hidden', () => {
      sourceChangeRef.current++
      void stopSources()
    }))
      .then(cleanup => { if (disposed) cleanup(); else unlisten = cleanup })
      .catch(() => {})
    return () => { disposed = true; unlisten?.() }
  }, [desktop, stopSources])

  useEffect(() => () => {
    if (voiceCommitTimerRef.current) clearTimeout(voiceCommitTimerRef.current)
    voiceContextWordsRef.current = []
  }, [])

  async function openFullApp() {
    sourceChangeRef.current++
    await stopSources()
    if (desktop) {
      await showDesktopMainWindow()
      await hideDesktopWindow()
      return
    }
    window.location.href = '/#mode'
  }

  async function openTutorial() {
    sourceChangeRef.current++
    await stopSources()
    signerRef.current?.clear()
    setTutorialOpen(true)
  }

  function closeTutorial() {
    rememberFloatingTutorial()
    tutorialClosedRef.current = true
    setTutorialOpen(false)
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-transparent p-2">
      <section className="relative flex h-full flex-col overflow-hidden rounded-[2rem] border-2 border-white/70 bg-[#f8f4ed]/95 shadow-[0_20px_60px_-18px_rgba(45,42,38,0.55)]">
        {tutorialOpen && <FloatingAvatarTutorial onClose={closeTutorial} />}
        {desktop && <ResizeHandles />}
        <header
          inert={tutorialOpen ? '' : undefined}
          className="flex items-center justify-between gap-2 border-b border-pastel-ink/10 bg-white/90 px-3 py-2"
        >
          <div
            className="min-w-0 flex-1 cursor-move py-1"
            onMouseDown={(event) => { if (event.button === 0) startDesktopDrag() }}
          >
            <p className="truncate text-sm font-black text-pastel-grape">Signara</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <MiniButton buttonRef={tutorialHelpRef} label="Ver guía del avatar flotante" onClick={openTutorial}>?</MiniButton>
            {desktop && <MiniButton label="Minimizar" onClick={minimizeDesktopWindow}>—</MiniButton>}
            <MiniButton label="Abrir Signara completa" onClick={openFullApp}>□</MiniButton>
            {desktop && <MiniButton label="Cerrar widget" onClick={async () => {
              sourceChangeRef.current++
              await stopSources()
              await hideDesktopWindow()
            }}>×</MiniButton>}
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <AvatarSignerVRM
            ref={signerRef}
            apiUrl={ML_API_URL}
            live={voice.listening || systemAudio.active}
          />
        </div>

        <div inert={tutorialOpen ? '' : undefined} className="border-t border-pastel-ink/10 bg-white/92 p-3">
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                disabled={!voice.supported || !available}
                onClick={toggleMicrophone}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? 'Detener micrófono' : 'Activar micrófono'}
                title={voice.listening ? 'Detener micrófono' : 'Activar micrófono'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition hover:scale-105 ${voice.listening ? 'bg-pastel-pink' : 'bg-pastel-grape'} disabled:opacity-40`}
              >
                <Icon name="mic" className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                disabled={!systemAudio.supported || !available}
                onClick={toggleSystemAudio}
                aria-pressed={systemAudio.ready}
                aria-busy={systemAudio.status.state === 'loading'}
                aria-label={systemAudio.active ? 'Detener audio del PC' : 'Interpretar audio del PC'}
                title={!desktop ? 'Disponible en Signara nativa' : systemAudio.status.state === 'loading'
                  ? 'Preparando reconocimiento local; pulsa para cancelar'
                  : systemAudio.active ? `Detener audio del PC (${systemAudio.status.device || systemAudio.status.state})`
                  : 'Interpretar audio del PC: videos o llamadas'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition hover:scale-105 ${systemAudio.ready ? 'bg-pastel-pink' : 'bg-pastel-grape'} ${systemAudio.status.state === 'loading' ? 'animate-pulse' : ''} disabled:opacity-40`}
              >
                <Icon name="play" className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            {!voice.supported && <p className="text-center text-[10px] font-bold text-amber-700">El reconocimiento de voz no está disponible en esta versión de Windows.</p>}
            {voice.error && voice.error !== 'aborted' && voice.error !== 'no-speech' && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-[10px] font-bold text-amber-800">
                {voice.error === 'network'
                  ? 'El servicio de voz no respondió. Cierra y vuelve a abrir Signara.'
                  : `No se pudo escuchar (${voice.error}).`}
              </p>
            )}
            {systemAudio.error && (
              <p role="alert" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-[10px] font-bold text-amber-800">
                {systemAudio.error}
              </p>
            )}
          </div>
      </section>
    </main>
  )
}

function MiniButton({ children, label, onClick, buttonRef }) {
  return (
    <button ref={buttonRef} type="button" title={label} aria-label={label} onClick={onClick} className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-pastel-ink/10 bg-white px-2 text-xs font-black text-pastel-grape hover:bg-pastel-purple/40">
      {children}
    </button>
  )
}

function ResizeHandles() {
  const begin = (direction) => (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    startDesktopResize(direction)
  }

  return (
    <>
      <div aria-hidden="true" onMouseDown={begin('North')} className="absolute inset-x-4 top-0 z-50 h-2 cursor-n-resize" />
      <div aria-hidden="true" onMouseDown={begin('South')} className="absolute inset-x-4 bottom-0 z-50 h-2 cursor-s-resize" />
      <div aria-hidden="true" onMouseDown={begin('West')} className="absolute inset-y-4 left-0 z-50 w-2 cursor-w-resize" />
      <div aria-hidden="true" onMouseDown={begin('East')} className="absolute inset-y-4 right-0 z-50 w-2 cursor-e-resize" />
      <div aria-hidden="true" onMouseDown={begin('NorthWest')} className="absolute left-0 top-0 z-[51] h-5 w-5 cursor-nw-resize" />
      <div aria-hidden="true" onMouseDown={begin('NorthEast')} className="absolute right-0 top-0 z-[51] h-5 w-5 cursor-ne-resize" />
      <div aria-hidden="true" onMouseDown={begin('SouthWest')} className="absolute bottom-0 left-0 z-[51] h-5 w-5 cursor-sw-resize" />
      <div aria-hidden="true" onMouseDown={begin('SouthEast')} className="absolute bottom-0 right-0 z-[51] h-5 w-5 cursor-se-resize" />
    </>
  )
}

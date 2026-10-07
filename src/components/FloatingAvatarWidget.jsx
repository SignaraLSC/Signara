import { useCallback, useEffect, useRef, useState } from 'react'
import AvatarSignerVRM from './AvatarSignerVRM.jsx'
import Icon from './Icon.jsx'
import useVoiceInput from '../hooks/useVoiceInput.js'
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
import { collapseRepeatedPhrase, deriveVoiceClause } from '../utils/voiceTranscript.js'
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
  const liveVoiceTextRef = useRef('')
  const committedVoiceRef = useRef({ text: '' })
  const voiceContextWordsRef = useRef([])
  const voiceCommitTimerRef = useRef(null)
  const [available, setAvailable] = useState(false)
  const desktop = isTauriDesktop()

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
    for (const token of tokens || []) signerRef.current?.queue(token)
  }, [])

  const planAndQueue = useCallback((text, source = 'voice') => {
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
    if (source === 'text') signerRef.current?.replace(tokens)
    else queueTokens(tokens)
    return tokens
  }, [queueTokens])

  const commitContextUnits = useCallback((units) => {
    for (const unit of units || []) {
      if (unit?.sourceText) planAndQueue(unit.sourceText, 'voice')
    }
  }, [planAndQueue])

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

  const commitVoiceTranscript = useCallback((rawText) => {
    const previous = committedVoiceRef.current
    const { normalized, clause } = deriveVoiceClause(
      rawText || liveVoiceTextRef.current,
      previous.text,
    )
    // El reinicio automático de WebView2 puede reenviar el último resultado
    // aun cuando ya no hay voz. Un texto idéntico nunca crea otra animación.
    if (!clause) return
    committedVoiceRef.current = { text: normalized }
    const result = pushContextWord(voiceContextWordsRef.current, clause, {
      availableTokens: availableRef.current,
      fallbackResolver: fallbackTokens,
      source: 'voice',
    })
    voiceContextWordsRef.current = result.pendingWords
    commitContextUnits(result.committed)
  }, [commitContextUnits])

  const handleLiveTranscript = useCallback((text, isFinal) => {
    const clean = collapseRepeatedPhrase(text)
    if (!clean) return
    liveVoiceTextRef.current = clean
    if (voiceCommitTimerRef.current) clearTimeout(voiceCommitTimerRef.current)
    // Procesar inmediatamente permite que las unidades ya seguras empiecen a
    // reproducirse en tiempo real. Las palabras que son prefijo de una frase
    // ("tengo" → "tengo sed", "como" → "como estas") quedan pendientes.
    commitVoiceTranscript(clean)
    // Si la persona se detiene y no llega una palabra que complete el prefijo,
    // se libera después de una pausa razonable y se usa el fallback normal.
    voiceCommitTimerRef.current = setTimeout(flushVoiceContext, isFinal ? 1200 : 1500)
  }, [commitVoiceTranscript, flushVoiceContext])

  const voice = useVoiceInput({
    lang: 'es-CO',
    continuous: true,
    onLiveTranscript: handleLiveTranscript,
  })

  useEffect(() => () => {
    if (voiceCommitTimerRef.current) clearTimeout(voiceCommitTimerRef.current)
    voiceContextWordsRef.current = []
  }, [])

  async function openFullApp() {
    if (desktop) {
      await showDesktopMainWindow()
      await hideDesktopWindow()
      return
    }
    window.location.href = '/#mode'
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-transparent p-2">
      <section className="relative flex h-full flex-col overflow-hidden rounded-[2rem] border-2 border-white/70 bg-[#f8f4ed]/95 shadow-[0_20px_60px_-18px_rgba(45,42,38,0.55)]">
        {desktop && <ResizeHandles />}
        <header
          className="flex items-center justify-between gap-2 border-b border-pastel-ink/10 bg-white/90 px-3 py-2"
        >
          <div
            className="min-w-0 flex-1 cursor-move py-1"
            onMouseDown={(event) => { if (event.button === 0) startDesktopDrag() }}
          >
            <p className="truncate text-sm font-black text-pastel-grape">Signara</p>
          </div>
          <div className="flex shrink-0 gap-1">
            {desktop && <MiniButton label="Minimizar" onClick={minimizeDesktopWindow}>—</MiniButton>}
            <MiniButton label="Abrir Signara completa" onClick={openFullApp}>□</MiniButton>
            {desktop && <MiniButton label="Cerrar widget" onClick={hideDesktopWindow}>×</MiniButton>}
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <AvatarSignerVRM
            ref={signerRef}
            apiUrl={ML_API_URL}
            live={voice.listening}
          />
        </div>

        <div className="border-t border-pastel-ink/10 bg-white/92 p-3">
            <div className="flex items-center justify-center">
              <button
                type="button"
                disabled={!voice.supported || !available}
                onClick={voice.listening ? voice.stop : () => {
                  liveVoiceTextRef.current = ''
                  committedVoiceRef.current = { text: '' }
                  voiceContextWordsRef.current = []
                  voice.start()
                }}
                aria-label={voice.listening ? 'Detener micrófono' : 'Activar micrófono'}
                title={voice.listening ? 'Detener micrófono' : 'Activar micrófono'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition hover:scale-105 ${voice.listening ? 'bg-pastel-pink' : 'bg-pastel-grape'} disabled:opacity-40`}
              >
                <Icon name="mic" className="h-5 w-5" strokeWidth={2.5} />
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
          </div>
      </section>
    </main>
  )
}

function MiniButton({ children, label, onClick }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-pastel-ink/10 bg-white px-2 text-xs font-black text-pastel-grape hover:bg-pastel-purple/40">
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

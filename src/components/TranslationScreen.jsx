import { useCallback, useEffect, useRef, useState } from 'react'
import { ResetButton, SectionLabel } from './AppShell.jsx'
import PoseViewer from './PoseViewer.jsx'
import AvatarSignerVRM from './AvatarSignerVRM.jsx'
import Icon from './Icon.jsx'
import { ML_API_URL } from '../utils/mlApi.js'
import TextInputPanel from './TextInputPanel.jsx'
import SignChips from './SignChips.jsx'
import ModeTutorial, { TutorialHelpButton } from './ModeTutorial.jsx'
import {
  AppPage,
  AppPageFooter,
  AppPageHeader,
  AppPageHeading,
  AppPageMain,
  AppPagePanel,
  AppPageStagger,
} from './PageMotion.jsx'
import { TRANSLATE_TUTORIAL_STEPS } from '../data/modeTutorialSteps.js'
import { useModeTutorial } from '../hooks/useModeTutorial.js'
import { translateText } from '../utils/translateText.js'
import { tokenize, normalizeForSearch } from '../utils/textNormalizer.js'
import { SIGNED_LANG_LABEL } from '../utils/signLanguage.js'
import { resolveDirectionalForm } from '../utils/directionalVerbs.js'
import { translateToSpanish } from '../utils/translateApi.js'
import LanguagePicker from './LanguagePicker.jsx'
import {
  findOutputLang,
  getStoredInputLang,
  storeInputLang,
} from '../data/outputLanguages.js'

/**
 * Empareja las palabras del texto con las señas disponibles, reconociendo
 * frases de varias palabras (p.ej. "por favor" → token "POR_FAVOR").
 * Estrategia voraz: intenta unir hasta 3 palabras seguidas con "_". Antes de
 * aceptar un match literal, revisa si esa misma ventana de palabras es una
 * forma conjugada de un verbo direccional (ver directionalVerbs.js) — así
 * "ayúdame" resuelve a la toma de AYUDAR redirigida, no queda sin match.
 */
function matchSignTokens(words, available) {
  if (!available || !available.length) return []
  const result = []
  let i = 0
  while (i < words.length) {
    let hit = null, len = 0
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const cand = words.slice(i, i + n)
      const directional = resolveDirectionalForm(cand, available)
      if (directional) { hit = directional; len = n; break }
      const literal = cand.join('_')
      if (available.includes(literal)) { hit = literal; len = n; break }
    }
    if (hit) { result.push(hit); i += len } else { i += 1 }
  }
  return result
}

/**
 * Igual estrategia que matchSignTokens (combos de hasta 3 palabras, el más
 * largo primero) pero mirando hacia ATRÁS desde el final de `words` — para el
 * reconocimiento EN VIVO, donde las palabras llegan una por una y hay que
 * decidir con lo que ya se tiene, sin saber la frase completa todavía.
 * Devuelve { token, consumed } o null si ninguna combinación que termine en
 * la última palabra coincide.
 */
function tryMatchSuffix(words, available) {
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const slice = words.slice(words.length - n)
    const directional = resolveDirectionalForm(slice, available)
    if (directional) return { token: directional, consumed: n }
    const cand = slice.join('_')
    if (available.includes(cand)) return { token: cand, consumed: n }
  }
  return null
}

export default function TranslationScreen({
  initialMode = 'text',
  onBack,
  onHome,
}) {
  const [originalText, setOriginalText] = useState('')
  const [poseSrc, setPoseSrc] = useState(null)
  const [translateSource, setTranslateSource] = useState(null)
  const [poseError, setPoseError] = useState(null)
  const [poseFinished, setPoseFinished] = useState(false)
  const [busy, setBusy] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  const [pendingWord, setPendingWord] = useState('')
  const [missedWord, setMissedWord] = useState('')

  // Avatar 3D de landmarks (primario). Reproduce animaciones grabadas con
  // 00_capture.py y servidas por la API ML en /sign/{token}.
  const [useSigner, setUseSigner] = useState(false)
  const [signerTokens, setSignerTokens] = useState([])
  const [inputLang, setInputLang] = useState(getStoredInputLang)
  const [spanishText, setSpanishText] = useState('')

  const inputRef = useRef(null)
  const poseBlobRef = useRef(null)
  const pendingWordRef = useRef('')
  const missedTimerRef = useRef(null)
  const signerRef = useRef(null)
  const availableTokensRef = useRef([])
  const liveMatchedRef = useRef(false)
  const liveQueueBufferRef = useRef([])
  const useSignerRef = useRef(false)
  const pendingWordsRef = useRef([])
  const inputLangRef = useRef(inputLang)
  const liveTranslateBusyRef = useRef(false)
  const liveTranslateSeqRef = useRef(0)
  const lastLiveQueueRef = useRef({ token: '', t: 0 })

  useEffect(() => { inputLangRef.current = inputLang }, [inputLang])

  // Precarga el VRM en cuanto hay animaciones: si esperamos a la 1ª palabra,
  // el usuario nota varios segundos de "Cargando avatar…".
  const [signerMounted, setSignerMounted] = useState(false)

  // Al montar, consulta qué señas tienen animación 3D propia grabada.
  useEffect(() => {
    let cancelled = false
    fetch(`${ML_API_URL}/animations`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        availableTokensRef.current = d?.tokens || []
        if ((d?.tokens || []).length) setSignerMounted(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Cuando hay tokens grabados para reproducir, encólalos en el avatar 3D.
  useEffect(() => {
    if (useSigner && signerTokens.length) {
      signerRef.current?.replace(signerTokens)
    }
  }, [useSigner, signerTokens])

  // El avatar se monta recién cuando useSigner pasa a true — si una palabra
  // en vivo llegó justo antes de eso, quedó en el buffer; se encola apenas
  // el ref esté listo.
  useEffect(() => {
    if (useSigner && liveQueueBufferRef.current.length) {
      liveQueueBufferRef.current.forEach((t) => signerRef.current?.queue(t))
      liveQueueBufferRef.current = []
    }
  }, [useSigner])

  const revokePoseBlob = useCallback(() => {
    if (poseBlobRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(poseBlobRef.current)
      poseBlobRef.current = null
    }
  }, [])

  const resetState = useCallback(() => {
    revokePoseBlob()
    setOriginalText('')
    setSpanishText('')
    setPoseSrc(null)
    setTranslateSource(null)
    setPoseError(null)
    setPoseFinished(false)
    setBusy(false)
    setLiveMode(false)
    setPendingWord('')
    setMissedWord('')
    setUseSigner(false)
    useSignerRef.current = false
    setSignerTokens([])
    signerRef.current?.clear()
    pendingWordRef.current = ''
    liveMatchedRef.current = false
    liveQueueBufferRef.current = []
    pendingWordsRef.current = []
    liveTranslateSeqRef.current += 1
    liveTranslateBusyRef.current = false
    lastLiveQueueRef.current = { token: '', t: 0 }
    if (missedTimerRef.current) clearTimeout(missedTimerRef.current)
  }, [revokePoseBlob])

  const handleReset = useCallback(() => {
    if (inputRef.current) inputRef.current.clear()
    resetState()
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [resetState])

  const handleSubmit = useCallback(async (text) => {
    setBusy(true)
    setOriginalText(text)
    setPoseError(null)
    setPoseFinished(false)
    revokePoseBlob()
    setPoseSrc(null)

    // Idioma de entrada → español → tokens de seña.
    let textEs = text
    const lang = inputLangRef.current
    if (lang && lang !== 'es') {
      try {
        textEs = await translateToSpanish(text, lang)
      } catch (e) {
        console.warn('Traducción a español:', e)
        textEs = text
      }
    }
    setSpanishText(textEs)

    const tokens = tokenize(textEs).map((w) => w.toUpperCase())
    const available = availableTokensRef.current
    const matched = matchSignTokens(tokens, available)

    if (matched.length > 0) {
      setTranslateSource('signer3d')
      signerRef.current?.clear()
      setSignerTokens(matched)
      setUseSigner(true)
      useSignerRef.current = true
      setBusy(false)
      return
    }

    // Respaldo sign.mt: mejor con el español ya resuelto.
    setUseSigner(false)
    useSignerRef.current = false
    setSignerTokens([])
    try {
      const result = await translateText(textEs)
      setTranslateSource(result.source)
      if (result.text) setSpanishText(result.text)

      if (result.poseSrc) {
        poseBlobRef.current = result.poseSrc
        setPoseSrc(result.poseSrc)
      } else {
        setPoseError('No hay animación 3D para este texto. Prueba con otra frase.')
      }
    } catch (e) {
      console.error(e)
      setPoseError('No se pudo cargar la animación 3D. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }, [revokePoseBlob])

  const handlePoseError = useCallback((err) => {
    setPoseError(
      typeof err === 'string' ? err : 'No se pudo reproducir la animación 3D.',
    )
    setPoseFinished(false)
    setPoseSrc(null)
    revokePoseBlob()
  }, [revokePoseBlob])

  // En vivo: cada palabra reconocida se encola de inmediato en el avatar si
  // tiene animación grabada — no espera a que termines de hablar. Antes esto
  // solo actualizaba el texto en pantalla; el avatar recién arrancaba al
  // final (handleVoiceFinal → handleSubmit), por eso se sentía "todo junto
  // al final" en vez de en tiempo real.
  const queueLiveToken = useCallback((token) => {
    if (!token) return
    // Evita doble seña cuando el mic reenvía la misma 1ª palabra
    // (típico al cambiar de interim→final o reiniciar transcript).
    const now = Date.now()
    const last = lastLiveQueueRef.current
    if (last.token === token && now - last.t < 1500) return
    lastLiveQueueRef.current = { token, t: now }

    setMissedWord('')
    liveMatchedRef.current = true
    setTranslateSource('signer3d')
    if (useSignerRef.current) {
      signerRef.current?.queue(token)
    } else {
      liveQueueBufferRef.current.push(token)
      useSignerRef.current = true
      setUseSigner(true)
    }
  }, [])

  const flushLiveTranslate = useCallback(() => {
    const lang = inputLangRef.current
    if (!lang || lang === 'es') return
    if (liveTranslateBusyRef.current) return
    if (!pendingWordsRef.current.length) return

    liveTranslateBusyRef.current = true
    const seq = ++liveTranslateSeqRef.current
    const windowPhrase = pendingWordsRef.current.slice(-3).join(' ')
    ;(async () => {
      try {
        const es = await translateToSpanish(windowPhrase, lang)
        if (seq !== liveTranslateSeqRef.current) return
        setSpanishText(es)
        const esWords = tokenize(es).map((w) => w.toUpperCase())
        const hit = tryMatchSuffix(esWords, availableTokensRef.current)
        if (hit) {
          queueLiveToken(hit.token)
          pendingWordsRef.current = []
        }
      } catch (e) {
        console.warn('Traducción en vivo:', e)
      } finally {
        if (seq === liveTranslateSeqRef.current) {
          liveTranslateBusyRef.current = false
          // Si llegó otra palabra mientras traduciamos, procesarla.
          if (pendingWordsRef.current.length) flushLiveTranslate()
        }
      }
    })()
  }, [queueLiveToken])

  const handleLiveWord = useCallback((rawWord) => {
    const cleaned = String(rawWord || '').trim()
    if (!cleaned) return
    setLiveMode(true)
    setOriginalText((prev) => (prev ? prev + ' ' : '') + cleaned)
    pendingWordRef.current = ''
    setPendingWord('')

    const normalized = normalizeForSearch(cleaned)
    if (!normalized) return

    const lang = inputLangRef.current
    // Español: match directo (como antes).
    if (!lang || lang === 'es') {
      const candidate = [...pendingWordsRef.current, normalized.toUpperCase()]
      const hit = tryMatchSuffix(candidate, availableTokensRef.current)
      if (hit) {
        queueLiveToken(hit.token)
        pendingWordsRef.current = candidate.slice(0, candidate.length - hit.consumed)
        return
      }
      pendingWordsRef.current = candidate
      if (pendingWordsRef.current.length > 2) {
        const dropped = pendingWordsRef.current.shift()
        setMissedWord(dropped)
      }
      return
    }

    // Otro idioma: acumular y traducir ventana → español → match.
    pendingWordsRef.current = [...pendingWordsRef.current, normalized]
    if (pendingWordsRef.current.length > 4) {
      const dropped = pendingWordsRef.current.shift()
      setMissedWord(dropped)
    }
    flushLiveTranslate()
  }, [queueLiveToken, flushLiveTranslate])

  const handleVoiceFinal = useCallback((text) => {
    pendingWordRef.current = ''
    setPendingWord('')
    setLiveMode(false)
    // Nadie más viene detrás — cualquier palabra que quedó esperando pareja
    // (ej. dijiste "por" y ahí terminó, sin "favor") no va a combinar con
    // nada; se limpia el buffer para la próxima frase.
    pendingWordsRef.current = []
    // Si ya se fueron encolando señas en vivo palabra por palabra, no hay que
    // reprocesar toda la frase de nuevo — signerRef.current.replace(...) (vía
    // handleSubmit) reiniciaría la cola (duplicados / se salta la del medio) y
    // además desmontaba el VRM. liveMatchedRef es síncrono (liveMode es async).
    if (liveMatchedRef.current) {
      liveMatchedRef.current = false
      setBusy(false)
      return
    }
    if (text?.trim()) handleSubmit(text.trim())
  }, [handleSubmit])

  // Apagar mic: limpia UI en vivo. No toca liveMatchedRef — el onResult
  // final de la sesión aún puede llegar y necesita ese flag.
  const handleVoiceEnd = useCallback(() => {
    setLiveMode(false)
    pendingWordsRef.current = []
    pendingWordRef.current = ''
    setPendingWord('')
    liveTranslateSeqRef.current += 1
    liveTranslateBusyRef.current = false
  }, [])

  const handlePanelSubmit = useCallback((text, { fromVoice = false } = {}) => {
    // Voz: cierre de frase del reconocedor (puede ser no-op si ya señaó en vivo).
    // Texto: SIEMPRE traduce — antes liveMatchedRef quedaba true tras el mic
    // y el submit escrito caía en handleVoiceFinal sin hacer nada.
    if (fromVoice) {
      handleVoiceFinal(text)
      return
    }
    liveMatchedRef.current = false
    setLiveMode(false)
    pendingWordsRef.current = []
    handleSubmit(text)
  }, [handleVoiceFinal, handleSubmit])

  const wordChips = (spanishText || originalText)
    ? tokenize(spanishText || originalText).map((w) => w.toUpperCase())
    : []
  const hasPose3d = translateSource === 'pose3d' && !!poseSrc
  const inputSpeechLang = findOutputLang(inputLang).speech

  const tutorial = useModeTutorial('translate')

  function onInputLangChange(code) {
    storeInputLang(code)
    setInputLang(code)
    pendingWordsRef.current = []
  }

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
                <SectionLabel color="blue">Traducir</SectionLabel>
                <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                  De palabras a{' '}
                  <span className="inline-block rounded-xl border-2 border-pastel-blue-line bg-pastel-blue px-2.5 py-0.5 shadow-[0_8px_18px_-8px_rgba(45,42,38,0.35)]">
                    {SIGNED_LANG_LABEL}
                  </span>
                </h1>
              </div>

              <AppPageStagger className="flex flex-wrap gap-2">
                {liveMode && (
                  <StatusPill variant="live">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    Voz activa
                  </StatusPill>
                )}
                {busy && <StatusPill variant="busy">Procesando…</StatusPill>}
                {hasPose3d && !poseFinished && (
                  <StatusPill variant="count">Animación 3D</StatusPill>
                )}
                {poseFinished && (
                  <StatusPill variant="count">Seña terminada</StatusPill>
                )}
              </AppPageStagger>
            </AppPageHeading>

            <div className="translate-layout mt-7">
              <TextInputPanel
                ref={inputRef}
                initialMode={initialMode}
                onSubmit={handlePanelSubmit}
                onLiveWord={handleLiveWord}
                onVoiceEnd={handleVoiceEnd}
                busy={busy}
                pendingWord={pendingWord}
                missedWord={missedWord}
                voiceLang={inputSpeechLang}
                topSlot={
                  <LanguagePicker
                    mode="input"
                    accent="blue"
                    fullWidth
                    value={inputLang}
                    onChange={onInputLangChange}
                    className="w-full"
                    title="Hablo / escribo en"
                    tutorialId="translate-language"
                  />
                }
              />

              <div className="ta-dijiste animate-motion-enter [animation-delay:140ms]">
                <OutputCard
                  color="neutral"
                  icon={<TextIcon />}
                  title="Lo que dijiste"
                  emptyIcon="message"
                  empty="Tu texto aparecerá aquí."
                  hasContent={!!originalText}
                >
                  <div className="h-40 overflow-y-auto pr-1">
                    <p className="text-base font-bold leading-relaxed text-pastel-ink sm:text-lg">
                      &quot;{originalText}&quot;
                    </p>
                    {spanishText && inputLang !== 'es' && (
                      <p className="mt-2 text-sm font-semibold text-pastel-sub">
                        En español: &quot;{spanishText}&quot;
                      </p>
                    )}
                  </div>
                </OutputCard>
              </div>

              {wordChips.length > 0 && (
                <div className="ta-palabras animate-motion-enter [animation-delay:210ms]">
                  <OutputCard
                    color="blue"
                    icon={<SignIcon />}
                    title="Palabras"
                    emptyIcon="sign"
                    empty=""
                    hasContent
                  >
                    {/* Alto fijo con scroll interno: si esto crece libremente, la
                        fila del grid crece con él y estira el <canvas> del avatar
                        (sin relación de aspecto fija) — se veía deformado. */}
                    <div className="max-h-32 overflow-y-auto pr-1">
                      <SignChips signs={wordChips} activeIndex={-1} />
                    </div>
                  </OutputCard>
                </div>
              )}

              <div className="ta-avatar animate-motion-scale-in self-start">
                <div className="relative flex w-full flex-col overflow-hidden rounded-[2rem] border-[3px] border-pastel-blue-line bg-pastel-blue p-5 shadow-[0_24px_50px_-28px_rgba(147,190,240,0.7)] sm:p-7">
                  <div className="relative mb-4">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-ink/70">
                      <Icon name="eye" className="h-3.5 w-3.5" strokeWidth={2.25} /> Mira aquí
                    </p>
                    <p className="mt-1 text-xl font-extrabold text-pastel-ink sm:text-2xl">
                      {hasPose3d && !useSigner
                        ? poseFinished
                          ? `Seña ${SIGNED_LANG_LABEL} (final)`
                          : `Seña ${SIGNED_LANG_LABEL} (3D)`
                        : signerMounted
                          ? `Seña ${SIGNED_LANG_LABEL} (avatar 3D)`
                          : 'Escribe para ver la animación'}
                    </p>
                  </div>

                  {poseError && (
                    <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      {poseError}
                    </p>
                  )}

                  {/* Alto fijo (como antes). Nunca h-full/flex-1: la grilla
                      alargaba el canvas y la cara se veía estirada. */}
                  <div className="relative h-[360px] w-full overflow-hidden rounded-[1.5rem] bg-[#FAF6EC]/90 sm:h-[420px]">
                    {signerMounted && !hasPose3d && (
                      <div className="absolute inset-0">
                        <AvatarSignerVRM
                          ref={signerRef}
                          apiUrl={ML_API_URL}
                          onFinish={() => setPoseFinished(true)}
                        />
                      </div>
                    )}
                    {hasPose3d && !useSigner ? (
                      <div className="absolute inset-0">
                        <PoseViewer
                          src={poseSrc}
                          onError={handlePoseError}
                          onEnded={() => setPoseFinished(true)}
                        />
                      </div>
                    ) : null}
                    {!signerMounted && !hasPose3d && (
                      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                        <Icon name="user" className="h-12 w-12 text-pastel-ink/30" strokeWidth={1.5} />
                        <p className="mt-3 text-sm font-semibold text-pastel-sub">
                          Cargando avatar…
                        </p>
                      </div>
                    )}
                  </div>

                  {!originalText && !busy && (
                    <div className="relative mt-4 rounded-2xl border-2 border-dashed border-pastel-ink/15 bg-white/50 px-4 py-3 text-center">
                      <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-pastel-ink">
                        <Icon name="arrow-up" className="h-4 w-4 lg:hidden" strokeWidth={2.25} />
                        Escribe o elige un ejemplo para empezar
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
        </AppPagePanel>
      </AppPageMain>

      <AppPageFooter>
        <p className="text-xs text-pastel-sub">Traducción en tiempo real · voz o texto a lengua de señas</p>
      </AppPageFooter>

      <ModeTutorial
        mode="translate"
        steps={TRANSLATE_TUTORIAL_STEPS}
        open={tutorial.open}
        onComplete={tutorial.finish}
      />
    </AppPage>
  )
}

function StatusPill({ variant, children }) {
  const styles = {
    live: 'border-pastel-grape bg-pastel-grape text-white shadow-[0_6px_16px_-6px_rgba(126,100,201,0.6)]',
    busy: 'border-pastel-purple-line bg-pastel-purple text-pastel-grape',
    count: 'border-pastel-blue-line bg-pastel-blue text-pastel-ink',
  }
  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold ' + styles[variant]}>
      {children}
    </span>
  )
}

function OutputCard({ color, icon, title, empty, emptyIcon, hasContent, children }) {
  const border = color === 'blue'
    ? 'border-pastel-blue-line'
    : 'border-pastel-ink/10'
  const bg = color === 'blue' ? 'bg-pastel-blue/40' : 'bg-white'

  return (
    <div className={`rounded-[1.5rem] border-2 ${border} ${bg} p-5 shadow-sm`}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="text-sm font-extrabold text-pastel-ink">{title}</p>
      </div>
      {hasContent ? children : (
        <div className="flex flex-col items-center py-6 text-center">
          <Icon name={emptyIcon} className="h-8 w-8 text-pastel-sub/50" strokeWidth={1.75} />
          <p className="mt-2 text-sm font-semibold text-pastel-sub">{empty}</p>
        </div>
      )}
    </div>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
}

function TextIcon() {
  return <Icon name="pencil" className="h-5 w-5 text-pastel-ink" strokeWidth={1.75} />
}

function SignIcon() {
  return <Icon name="sign" className="h-5 w-5 text-palette-azure" strokeWidth={1.75} />
}

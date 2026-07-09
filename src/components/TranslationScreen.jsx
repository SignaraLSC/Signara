import { useCallback, useEffect, useRef, useState } from 'react'
import { ResetButton, SectionLabel } from './AppShell.jsx'
import PoseViewer from './PoseViewer.jsx'
import AvatarSigner3D from './AvatarSigner3D.jsx'
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
import { tokenize } from '../utils/textNormalizer.js'
import { SIGNED_LANG_LABEL } from '../utils/signLanguage.js'

/**
 * Empareja las palabras del texto con las señas disponibles, reconociendo
 * frases de varias palabras (p.ej. "por favor" → token "POR_FAVOR").
 * Estrategia voraz: intenta unir hasta 3 palabras seguidas con "_".
 */
function matchSignTokens(words, available) {
  if (!available || !available.length) return []
  const result = []
  let i = 0
  while (i < words.length) {
    let hit = null, len = 0
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const cand = words.slice(i, i + n).join('_')
      if (available.includes(cand)) { hit = cand; len = n; break }
    }
    if (hit) { result.push(hit); i += len } else { i += 1 }
  }
  return result
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

  const inputRef = useRef(null)
  const poseBlobRef = useRef(null)
  const pendingWordRef = useRef('')
  const missedTimerRef = useRef(null)
  const signerRef = useRef(null)
  const availableTokensRef = useRef([])   // tokens con animación grabada disponible

  // Al montar, consulta qué señas tienen animación 3D propia grabada.
  useEffect(() => {
    let cancelled = false
    fetch(`${ML_API_URL}/animations`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) availableTokensRef.current = d?.tokens || [] })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Cuando hay tokens grabados para reproducir, encólalos en el avatar 3D.
  useEffect(() => {
    if (useSigner && signerTokens.length) {
      signerRef.current?.replace(signerTokens)
    }
  }, [useSigner, signerTokens])

  const revokePoseBlob = useCallback(() => {
    if (poseBlobRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(poseBlobRef.current)
      poseBlobRef.current = null
    }
  }, [])

  const resetState = useCallback(() => {
    revokePoseBlob()
    setOriginalText('')
    setPoseSrc(null)
    setTranslateSource(null)
    setPoseError(null)
    setPoseFinished(false)
    setBusy(false)
    setLiveMode(false)
    setPendingWord('')
    setMissedWord('')
    setUseSigner(false)
    setSignerTokens([])
    signerRef.current?.clear()
    pendingWordRef.current = ''
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
    setUseSigner(false)
    setSignerTokens([])

    // ── Primario: avatar 3D de landmarks con animaciones grabadas ──────────────
    // Si alguna palabra tiene animación propia (grabada con 00_capture.py),
    // reprodúcela en el esqueleto 3D en vez de pedir la pose a sign.mt.
    const tokens = tokenize(text).map((w) => w.toUpperCase())
    const available = availableTokensRef.current
    const matched = matchSignTokens(tokens, available)

    if (matched.length > 0) {
      setTranslateSource('signer3d')
      setSignerTokens(matched)
      setUseSigner(true)
      setBusy(false)
      return
    }

    // ── Respaldo: pose-viewer de sign.mt ───────────────────────────────────────
    try {
      const result = await translateText(text)
      setTranslateSource(result.source)
      setOriginalText(result.text || text)

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

  const handleLiveWord = useCallback((rawWord) => {
    const cleaned = String(rawWord || '').trim()
    if (!cleaned) return
    setLiveMode(true)
    setOriginalText((prev) => (prev ? prev + ' ' : '') + cleaned)
    pendingWordRef.current = ''
    setPendingWord('')
  }, [])

  const handleVoiceFinal = useCallback((text) => {
    pendingWordRef.current = ''
    setPendingWord('')
    setLiveMode(false)
    if (text?.trim()) handleSubmit(text.trim())
  }, [handleSubmit])

  const handlePanelSubmit = useCallback((text) => {
    if (liveMode) handleVoiceFinal(text)
    else handleSubmit(text)
  }, [liveMode, handleVoiceFinal, handleSubmit])

  const wordChips = originalText ? tokenize(originalText).map((w) => w.toUpperCase()) : []
  const hasPose3d = translateSource === 'pose3d' && !!poseSrc

  const tutorial = useModeTutorial('translate')

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
                <SectionLabel color="green">Traducir</SectionLabel>
                <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                  De palabras a{' '}
                  <span className="inline-block rounded-xl border-2 border-pastel-green-line bg-pastel-green px-2.5 py-0.5 shadow-[0_8px_18px_-8px_rgba(45,42,38,0.35)]">
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

            <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
              <AppPageStagger className="flex flex-col gap-5 lg:col-span-5">
                <TextInputPanel
                  ref={inputRef}
                  initialMode={initialMode}
                  onSubmit={handlePanelSubmit}
                  onLiveWord={handleLiveWord}
                  busy={busy}
                  pendingWord={pendingWord}
                  missedWord={missedWord}
                />

                <OutputCard
                  color="neutral"
                  icon={<TextIcon />}
                  title="Lo que dijiste"
                  emptyIcon="message"
                  empty="Tu texto aparecerá aquí."
                  hasContent={!!originalText}
                >
                  <p className="text-base font-bold leading-relaxed text-pastel-ink sm:text-lg">
                    &quot;{originalText}&quot;
                  </p>
                </OutputCard>

                {wordChips.length > 0 && (
                  <OutputCard
                    color="green"
                    icon={<SignIcon />}
                    title="Palabras"
                    emptyIcon="sign"
                    empty=""
                    hasContent
                  >
                    <SignChips signs={wordChips} activeIndex={-1} />
                  </OutputCard>
                )}
              </AppPageStagger>

              <div className="animate-motion-scale-in lg:col-span-7">
                <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] border-[3px] border-pastel-green-line bg-pastel-green p-5 shadow-[0_24px_50px_-28px_rgba(148,208,142,0.7)] sm:p-7">
                  <div className="relative mb-4">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-ink/70">
                      <Icon name="eye" className="h-3.5 w-3.5" strokeWidth={2.25} /> Mira aquí
                    </p>
                    <p className="mt-1 text-xl font-extrabold text-pastel-ink sm:text-2xl">
                      {busy
                        ? 'Generando seña…'
                        : useSigner
                          ? `Seña ${SIGNED_LANG_LABEL} (avatar 3D)`
                          : hasPose3d
                            ? poseFinished
                              ? `Seña ${SIGNED_LANG_LABEL} (final)`
                              : `Seña ${SIGNED_LANG_LABEL} (3D)`
                            : 'Escribe para ver la animación'}
                    </p>
                  </div>

                  {poseError && (
                    <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      {poseError}
                    </p>
                  )}

                  <div className="relative flex flex-1 items-center justify-center rounded-[1.5rem] border-2 border-white/60 bg-[#FAF6EC]/90 p-4 shadow-inner sm:p-6 min-h-[320px]">
                    <div className="w-full max-w-lg">
                      {useSigner ? (
                        <div className="h-[320px] w-full">
                          <AvatarSigner3D
                            ref={signerRef}
                            apiUrl={ML_API_URL}
                            onFinish={() => setPoseFinished(true)}
                          />
                        </div>
                      ) : hasPose3d ? (
                        <PoseViewer
                          src={poseSrc}
                          onError={handlePoseError}
                          onEnded={() => setPoseFinished(true)}
                        />
                      ) : (
                        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-pastel-ink/15 bg-white/60 px-6 text-center">
                          <Icon name="user" className="h-12 w-12 text-pastel-ink/30" strokeWidth={1.5} />
                          <p className="mt-3 text-sm font-semibold text-pastel-sub">
                            {busy
                              ? 'Cargando animación 3D…'
                              : 'La figura firmando aparecerá aquí'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {!originalText && !busy && (
                    <div className="relative mt-4 rounded-2xl border-2 border-dashed border-pastel-ink/15 bg-white/50 px-4 py-3 text-center">
                      <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-pastel-ink">
                        <Icon name="arrow-up" className="h-4 w-4" strokeWidth={2.25} /> Escribe arriba o elige un ejemplo para empezar
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
    count: 'border-pastel-green-line bg-pastel-green text-pastel-ink',
  }
  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold ' + styles[variant]}>
      {children}
    </span>
  )
}

function OutputCard({ color, icon, title, empty, emptyIcon, hasContent, children }) {
  const border = color === 'green'
    ? 'border-pastel-green-line'
    : 'border-pastel-ink/10'
  const bg = color === 'green' ? 'bg-pastel-green/40' : 'bg-white'

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
  return <Icon name="sign" className="h-5 w-5 text-pastel-grape" strokeWidth={1.75} />
}

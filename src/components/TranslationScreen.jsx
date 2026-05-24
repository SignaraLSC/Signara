import { useCallback, useEffect, useRef, useState } from 'react'
import Logo from './Logo.jsx'
import AvatarPlayer from './AvatarPlayer.jsx'
import TextInputPanel from './TextInputPanel.jsx'
import SignChips from './SignChips.jsx'
import { translateText } from '../utils/translateText.js'
import { textToSignTokens } from '../utils/textNormalizer.js'
import {
  getCurrentAvatar,
  getAllSignKeys,
  setCurrentAvatar
} from '../utils/signMap.js'

export default function TranslationScreen({
  initialMode = 'text',
  avatarId: initialAvatarId,
  onAvatarChange,
  onBack,
  onHome
}) {
  const [originalText, setOriginalText] = useState('')
  const [signs, setSigns] = useState([])
  const [activeSign, setActiveSign] = useState(null)
  const [busy, setBusy] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  const [avatarId, setAvatarId] = useState(initialAvatarId || getCurrentAvatar().id)
  const [pendingWord, setPendingWord] = useState('')   // word waiting to form a compound
  const [missedWord, setMissedWord] = useState('')    // word that had no sign match

  const avatarRef = useRef(null)
  const inputRef = useRef(null)
  const liveQueuedRef = useRef([])
  const pendingWordRef = useRef('')
  const missedTimerRef = useRef(null)

  useEffect(() => {
    if (initialAvatarId && initialAvatarId !== avatarId) {
      setAvatarId(initialAvatarId)
    }
  }, [initialAvatarId])

  useEffect(() => {
    setCurrentAvatar(avatarId)
  }, [avatarId])

  const resetVoice = useCallback(() => {
    if (inputRef.current) inputRef.current.clear()
  }, [])

  const resetAvatar = useCallback(() => {
    if (avatarRef.current) avatarRef.current.clear()
  }, [])

  const resetState = useCallback(() => {
    setOriginalText('')
    setSigns([])
    setActiveSign(null)
    setBusy(false)
    setLiveMode(false)
    setPendingWord('')
    setMissedWord('')
    liveQueuedRef.current = []
    pendingWordRef.current = ''
    if (missedTimerRef.current) clearTimeout(missedTimerRef.current)
  }, [])

  const handleReset = useCallback(() => {
    resetVoice()
    resetAvatar()
    resetState()
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [resetVoice, resetAvatar, resetState])

  const handleAvatarChange = useCallback((id) => {
    setCurrentAvatar(id)
    setAvatarId(id)
    if (avatarRef.current) avatarRef.current.clear()
    if (onAvatarChange) onAvatarChange(id)
  }, [onAvatarChange])

  // --- TYPED path (Con el SEGURO de minúsculas) ---
  const handleSubmit = useCallback(async (text) => {
    setBusy(true);
    setOriginalText(text); // Guardamos el texto tal cual lo puso el usuario
    try {
      const result = await translateText(text);
      setSigns(result);
      if (avatarRef.current) {
        avatarRef.current.replace(result);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [])

  // --- LIVE VOICE path ---
  const handleLiveWord = useCallback((rawWord) => {
    const cleaned = String(rawWord || '').trim()
    if (!cleaned) return

    setLiveMode(true)
    setOriginalText((prev) => (prev ? prev + ' ' : '') + cleaned)

    const signKeys = getAllSignKeys()

    const queueSign = (signToken) => {
      setSigns((prev) => [...prev, signToken])
      if (avatarRef.current) {
        avatarRef.current.queue(signToken)
        liveQueuedRef.current.push(signToken)
      }
    }

    // Try compound (pending word + new word) first
    if (pendingWordRef.current) {
      const compound = pendingWordRef.current + ' ' + cleaned
      const tokens = textToSignTokens(compound, signKeys)
      if (tokens.length === 1) {
        queueSign(tokens[0])
        pendingWordRef.current = ''
        setPendingWord('')
        return
      }
    }

    // Try single word with full normalization + fuzzy matching
    // "holaaaa" → dedup → "hola" → fuzzy → "HOLA"
    const tokens = textToSignTokens(cleaned, signKeys)
    if (tokens.length > 0) {
      tokens.forEach(queueSign)
      pendingWordRef.current = ''
      setPendingWord('')
      return
    }

    // No match — show briefly that the word wasn't found
    pendingWordRef.current = cleaned
    setPendingWord(cleaned)
    if (missedTimerRef.current) clearTimeout(missedTimerRef.current)
    missedTimerRef.current = setTimeout(() => {
      // Word still unmatched after next word arrives — mark as missed
      if (pendingWordRef.current === cleaned) {
        setMissedWord(cleaned)
        pendingWordRef.current = ''
        setPendingWord('')
        setTimeout(() => setMissedWord(''), 2000)
      }
    }, 1500)
  }, [])

  // Called when the browser closes the speech session.
  // We no longer call translateText here — it adds ~1-2s lag that breaks fluency.
  // Live word-by-word processing already queued everything correctly.
  const handleVoiceFinal = useCallback((_text) => {
    liveQueuedRef.current = []
    pendingWordRef.current = ''
    setPendingWord('')
  }, [])

  const handlePanelSubmit = useCallback((text) => {
    if (liveMode) handleVoiceFinal(text)
    else handleSubmit(text)
  }, [liveMode, handleVoiceFinal, handleSubmit])

  let activeIndex = -1
  if (activeSign) {
    for (let i = signs.length - 1; i >= 0; i--) {
      if (signs[i] === activeSign) { activeIndex = i; break }
    }
  }

  return (
    <section className="min-h-screen flex flex-col px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-white/85 hover:text-white text-sm font-medium">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Cambiar modo
        </button>

        <div className="flex items-center gap-2">
          <ResetButton onClick={handleReset} />
          <button onClick={onHome} className="flex items-center gap-2 group" title="Inicio">
            <span className="hidden sm:block text-xl font-extrabold gradient-text bg-white px-3 py-1 rounded-full shadow-soft">Signara</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/95 shadow-soft group-hover:shadow-glow transition">
              <Logo size={28} />
            </span>
          </button>
        </div>
      </header>

      <div className="animate-fade-up">
        <TextInputPanel
          ref={inputRef}
          initialMode={initialMode}
          onSubmit={handlePanelSubmit}
          onLiveWord={handleLiveWord}
          busy={busy}
          pendingWord={pendingWord}
          missedWord={missedWord}
        />
      </div>

      <div className="flex-1 flex items-center justify-center my-6 animate-fade-up">
        <div className="w-full max-w-md overflow-hidden">
          <AvatarPlayer
            ref={avatarRef}
            avatarId={avatarId}
            onAvatarChange={handleAvatarChange}
            onSign={setActiveSign}
            onFinish={() => setActiveSign(null)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-up">
        <div className="glass-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-signara-purple">Texto original</p>
          <p className="mt-2 text-signara-navy text-lg leading-relaxed min-h-[2.5rem]">
            {originalText ? originalText : <span className="italic text-signara-navy/40">Aun no has traducido nada.</span>}
          </p>
        </div>
        <div className="glass-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-signara-purple">Señas traducidas</p>
          <div className="mt-3">
            {/* Renderizado visual limpio para el usuario final */}
            <SignChips 
              signs={signs.map(s => s.replace('.mp4', '').replace(/_/g, ' ').toUpperCase())} 
              activeIndex={activeIndex} 
            />
          </div>
        </div>
      </div>

      <footer className="mt-6 text-center text-xs text-white/60">
        Traducción en tiempo real · voz o texto a lengua de señas
      </footer>
    </section>
  )
}

function ResetButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 border border-white/30 text-white text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/40"
      title="Reiniciar todo"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      LIMPIAR
    </button>
  )
}
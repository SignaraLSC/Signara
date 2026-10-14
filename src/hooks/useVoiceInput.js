import { useEffect, useRef, useState, useCallback } from 'react'
import { advanceVoiceResultLedger, createVoiceResultLedger } from '../utils/voiceTranscript.js'

/**
 * useVoiceInput
 * Wrapper around the Web Speech API tuned for Spanish input.
 *
 * Two callbacks for the streaming use-case:
 *   - onLiveTranscript(text)   fires continuously with the in-progress
 *                              interim transcription for preview only.
 *   - onResult(text)           delivers only new confirmed fragments.
 *
 * `continuous: true` keeps the recogniser open and re-arms on `onend`.
 */
export default function useVoiceInput({
  lang = 'es-ES',
  onResult,
  onLiveTranscript,
  continuous = true
} = {}) {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)

  const recognitionRef = useRef(null)
  const wantListenRef = useRef(false)
  const onResultRef = useRef(onResult)
  const onLiveRef = useRef(onLiveTranscript)
  const lastLiveRef = useRef('')
  onResultRef.current = onResult
  onLiveRef.current = onLiveTranscript

  const SR =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null
  const supported = Boolean(SR)

  useEffect(() => {
    if (!supported) return

    const recognition = new SR()
    recognition.lang = lang
    recognition.continuous = continuous
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    let ledger = createVoiceResultLedger()
    let previousFinalParts = []
    let newSpeech = false
    let disposed = false
    recognition.onstart = () => {
      if (disposed) return
      ledger = createVoiceResultLedger(previousFinalParts)
      newSpeech = false
      lastLiveRef.current = ''
      setInterim('')
      onLiveRef.current?.('', true, { interimText: '', finalText: '', delta: '' })
    }
    recognition.onspeechstart = () => { newSpeech = true }

    recognition.onresult = (event) => {
      if (disposed) return
      // No convertir hipótesis («se»→«sed») en palabras irrevocables.
      // El ledger consume cada resultado final una vez, aunque el navegador
      // reenvíe toda la sesión o acorte/corrija los resultados provisionales.
      const snapshot = advanceVoiceResultLedger(ledger, event.results, { newSpeech })
      const { finalText, interimText, combined, isFullyFinal, delta } = snapshot

      // TEMPORAL: activa con window.__SIGNARA_VOICE_DEBUG = true en la consola
      // antes de hablar, para ver exactamente qué manda el navegador si el
      // duplicado/salto de palabras sigue pasando después de este arreglo.
      if (typeof window !== 'undefined' && window.__SIGNARA_VOICE_DEBUG) {
        console.log('[voz]', {
          results: Array.from(event.results).map((r) => ({ isFinal: r.isFinal, t: r[0].transcript })),
          finalText, interimText, combined, isFullyFinal,
        })
      }

      if (combined !== lastLiveRef.current || delta) {
        lastLiveRef.current = combined
        setInterim(interimText)
        if (onLiveRef.current) onLiveRef.current(combined, isFullyFinal, snapshot)
      }

      if (delta) {
        setTranscript(delta)
        if (onResultRef.current) onResultRef.current(delta)
      }
    }

    recognition.onerror = (e) => {
      if (disposed) return
      console.warn('[useVoiceInput] error:', e.error)
      setError(e.error || 'speech-error')
      if (
        e.error === 'not-allowed' ||
        e.error === 'service-not-allowed' ||
        e.error === 'network'
      ) {
        wantListenRef.current = false
        setListening(false)
      }
    }

    recognition.onend = () => {
      if (disposed) return
      // Varios ciclos vacíos durante silencio no deben olvidar el último
      // resultado: el servicio puede reenviarlo después de otra reconexión.
      if (ledger.finalParts.length) previousFinalParts = ledger.finalParts.slice()
      if (wantListenRef.current) {
        try {
          recognition.start()
          setListening(true)
        } catch (_) {
          setListening(false)
        }
      } else {
        setListening(false)
      }
    }

    recognitionRef.current = recognition
    return () => {
      disposed = true
      wantListenRef.current = false
      try { recognition.abort() } catch (_) {}
    }
  }, [SR, supported, lang, continuous])

  const start = useCallback(() => {
    setError(null)
    setInterim('')
    lastLiveRef.current = ''
    if (!recognitionRef.current) return
    wantListenRef.current = true
    try {
      recognitionRef.current.start()
      setListening(true)
    } catch (_) {
      // start() throws if already started - safe to ignore.
    }
  }, [])

  const stop = useCallback(() => {
    wantListenRef.current = false
    if (!recognitionRef.current) return
    try { recognitionRef.current.stop() } catch (_) {}
    setListening(false)
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setInterim('')
    setError(null)
  }, [])

  return { listening, transcript, interim, error, supported, start, stop, reset }
}

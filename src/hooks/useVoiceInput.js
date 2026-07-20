import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * useVoiceInput
 * Wrapper around the Web Speech API tuned for Spanish input.
 *
 * Two callbacks for the streaming use-case:
 *   - onLiveTranscript(text)   fires continuously with the in-progress
 *                              interim transcription. Used to drive the
 *                              real-time word queue.
 *   - onResult(text)           fires once per finalised utterance.
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
  const lastFinalRef = useRef('')
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

    recognition.onresult = (event) => {
      // OJO #1: event.resultIndex es poco fiable entre navegadores — en
      // algunos se queda en 0 (cada evento trae el texto COMPLETO
      // acumulado), en otros avanza (cada evento trae solo lo NUEVO).
      // Solución: reconstruir SIEMPRE el texto completo iterando TODOS los
      // resultados desde el índice 0.
      // OJO #2 (el bug real): cuando hay VARIOS resultados — típico si hablas
      // con una pequeña pausa entre palabras, cada palabra queda como su
      // propio result — concatenarlos con += los pegaba SIN ESPACIO
      // ("hola"+"gracias"+"bien" → "holagraciasbien"), porque
      // result.transcript no trae espacio propio de forma consistente. Al
      // separar por espacios después, esa palabra pegada contaba como UNA
      // sola — la del medio "desaparecía" (fusionada), leyéndose como
      // salto/duplicado según cómo cayera el conteo. Se une con join(' ')
      // explícito, nunca con concatenación directa.
      const finalParts = []
      const interimParts = []
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i]
        const t = (r[0].transcript || '').trim()
        if (!t) continue
        if (r.isFinal) finalParts.push(t)
        else interimParts.push(t)
      }
      const finalText = finalParts.join(' ')
      const interimText = interimParts.join(' ')
      const combined = [finalText, interimText].filter(Boolean).join(' ')
      const isFullyFinal = interimText === '' // ninguna palabra queda "en progreso"

      // TEMPORAL: activa con window.__SIGNARA_VOICE_DEBUG = true en la consola
      // antes de hablar, para ver exactamente qué manda el navegador si el
      // duplicado/salto de palabras sigue pasando después de este arreglo.
      if (typeof window !== 'undefined' && window.__SIGNARA_VOICE_DEBUG) {
        console.log('[voz]', {
          results: Array.from(event.results).map((r) => ({ isFinal: r.isFinal, t: r[0].transcript })),
          finalText, interimText, combined, isFullyFinal,
        })
      }

      if (combined) {
        setInterim(interimText)
        if (onLiveRef.current) onLiveRef.current(combined, isFullyFinal)
      }

      // Respaldo (traducción de frase completa): solo cuando ya no hay nada
      // pendiente Y el texto final creció de verdad respecto al último aviso.
      if (isFullyFinal && finalText && finalText !== lastFinalRef.current) {
        lastFinalRef.current = finalText
        const cleaned = finalText.trim()
        setTranscript(cleaned)
        if (onResultRef.current) onResultRef.current(cleaned)
      }
    }

    recognition.onerror = (e) => {
      console.warn('[useVoiceInput] error:', e.error)
      setError(e.error || 'speech-error')
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantListenRef.current = false
        setListening(false)
      }
    }

    recognition.onend = () => {
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
      wantListenRef.current = false
      try { recognition.abort() } catch (_) {}
    }
  }, [SR, supported, lang, continuous])

  const start = useCallback(() => {
    setError(null)
    setInterim('')
    lastFinalRef.current = ''
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

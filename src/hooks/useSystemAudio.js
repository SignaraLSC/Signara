import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauriDesktop } from '../utils/desktopWindow.js'
import { createSystemAudioSession } from '../utils/systemAudioSession.js'

export default function useSystemAudio({ onResult } = {}) {
  const [status, setStatus] = useState({ state: 'idle' })
  const [error, setError] = useState(null)
  const resultRef = useRef(onResult)
  resultRef.current = onResult
  const sessionRef = useRef(null)
  const supported = isTauriDesktop()

  useEffect(() => {
    let mounted = true
    const session = createSystemAudioSession({
      loadBridge: () => import('@tauri-apps/api/core'),
      onResult: text => { if (mounted) resultRef.current?.(text) },
      onStatus: next => { if (mounted) setStatus(next) },
      onError: message => { if (mounted) setError(message) },
    })
    sessionRef.current = session
    return () => { mounted = false; void session.stop().catch(() => {}) }
  }, [])

  const start = useCallback(() => {
    setError(null)
    if (!supported) { setError('El audio del PC requiere abrir Signara nativa.'); return }
    return sessionRef.current?.start()
  }, [supported])
  const stop = useCallback(() => sessionRef.current?.stop().catch(message => setError(String(message))), [])
  return { supported, start, stop, error, status,
    active: status.state !== 'idle', ready: status.state === 'listening' }
}

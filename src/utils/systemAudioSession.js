/** Solo resultados finales por identidad, nunca texto acumulado ni interims. */
export function createSystemAudioSession({ loadBridge, onResult, onStatus, onError,
  schedule = setTimeout, cancel = clearTimeout, now = Date.now, startupTimeoutMs = 120000 }) {
  let generation = 0
  let current = null

  async function release(session) {
    if (session?.timer != null) cancel(session.timer)
    if (session?.id != null) {
      await session.bridge.invoke('stop_system_audio', { sessionId: session.id })
    }
  }

  async function stop() {
    generation++
    const session = current
    current = null
    onStatus?.({ state: 'idle' })
    await release(session)
  }

  async function start() {
    const attempt = ++generation
    const previous = current
    current = null
    onStatus?.({ state: 'loading' })
    try {
      await release(previous)
      if (attempt !== generation) return
      const bridge = await loadBridge()
      if (attempt !== generation) return
      const session = { bridge, id: null, lastId: 0, cursor: 0, timer: null,
        failures: 0, startedAt: now(), ready: false }
      current = session
      const fail = message => {
        if (generation !== attempt || current !== session) return
        onError?.(message)
        void stop().catch(error => onError?.(String(error)))
      }
      // Leer con cursor desde memoria nativa: pasar a Word/Teams no pierde
      // callbacks, y un reintento nunca vuelve a interpretar el historial.
      const poll = async () => {
        if (generation !== attempt || current !== session) return
        try {
          const snapshot = await bridge.invoke('read_system_audio_events', {
            sessionId: session.id, afterSequence: session.cursor,
          })
          if (generation !== attempt || current !== session) return
          session.failures = 0
          for (const event of snapshot.events || []) {
            if (event.session !== session.id || !Number.isSafeInteger(event.sequence)
                || event.sequence <= session.cursor) continue
            if (event.sequence !== session.cursor + 1) {
              fail('La conexión con el avatar perdió resultados. Vuelve a activar play.')
              return
            }
            session.cursor = event.sequence
            if (event.type === 'status') {
              if (event.state === 'listening') session.ready = true
              onStatus?.(event)
            }
            if (event.type === 'transcript' && event.final === true
                && Number.isSafeInteger(event.id) && event.id > session.lastId) {
              session.lastId = event.id
              if (event.text?.trim()) onResult?.(event.text.trim())
            }
            if (event.type === 'error') {
              fail(event.message || 'Se interrumpió el audio del PC.')
              return
            }
          }
          if (!snapshot.running) {
            fail('Se interrumpió el audio del PC. Vuelve a pulsar play.')
            return
          }
          if (!session.ready && now() - session.startedAt > startupTimeoutMs) {
            fail('El reconocimiento local no terminó de iniciar. Vuelve a activar play.')
            return
          }
        } catch (error) {
          if (generation !== attempt || current !== session) return
          if (++session.failures >= 3) {
            fail(`No se pudo conectar el audio al avatar: ${String(error)}`)
            return
          }
        }
        if (generation === attempt && current === session) session.timer = schedule(poll, 350)
      }
      session.id = await bridge.invoke('start_system_audio')
      if (generation !== attempt || current !== session) {
        await bridge.invoke('stop_system_audio', { sessionId: session.id })
        return
      }
      await poll()
    } catch (error) {
      if (generation !== attempt) return
      current = null
      onStatus?.({ state: 'idle' })
      onError?.(String(error))
    }
  }

  return { start, stop }
}

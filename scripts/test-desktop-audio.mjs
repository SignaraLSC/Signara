import assert from 'node:assert/strict'
import { createSystemAudioSession } from '../src/utils/systemAudioSession.js'
import { pushContextWord } from '../src/utils/contextualSignWindow.js'
import { expandTokens } from '../src/utils/fingerspell.js'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { FLOATING_TUTORIAL_KEY, FLOATING_TUTORIAL_STEPS, needsFloatingTutorial, rememberFloatingTutorial } from '../src/utils/floatingAvatarTutorial.js'

let id = 0
const nativeSessions = new Map()
const timers = new Map()
let timerId = 0
let clock = 0
let readFailures = 0
let delayedRead = null
const schedule = callback => { const id = ++timerId; timers.set(id, callback); return id }
const cancel = id => timers.delete(id)
async function tick() {
  const entry = timers.entries().next().value
  assert.ok(entry, 'la sesión debe seguir leyendo resultados nativos')
  timers.delete(entry[0])
  await entry[1]()
}
function send(sessionId, event) {
  const session = nativeSessions.get(sessionId)
  session.events.push({ ...event, session: sessionId, sequence: session.events.length + 1 })
}
const stops = []
let resolveStart = null
let delayStart = false
const bridge = {
  invoke: async (command, args) => {
    if (command === 'start_system_audio') {
      const next = ++id
      nativeSessions.set(next, { events: [], running: true })
      if (delayStart) return new Promise(resolve => { resolveStart = () => resolve(next) })
      return next
    }
    if (command === 'read_system_audio_events') {
      if (readFailures) { readFailures--; throw new Error('IPC temporal') }
      const session = nativeSessions.get(args.sessionId)
      const snapshot = { events: session.events.filter(event => event.sequence > args.afterSequence), running: session.running }
      if (delayedRead) return delayedRead(snapshot)
      return snapshot
    }
    stops.push(args.sessionId)
    nativeSessions.get(args.sessionId).running = false
  },
}
const transcripts = []
const statuses = []
const errors = []
const session = createSystemAudioSession({ loadBridge: async () => bridge,
  onResult: text => transcripts.push(text), onStatus: status => statuses.push(status.state),
  onError: error => errors.push(error),
  schedule, cancel, now: () => clock, startupTimeoutMs: 1000,
})
await session.start()
send(1, { type: 'status', state: 'listening' })
send(1, { type: 'transcript', id: 1, text: 'tengo se', final: false })
await tick()
assert.deepEqual(transcripts, [])
send(1, { type: 'transcript', id: 1, text: 'tengo sed', final: true })
for (let i = 0; i < 20; i++) send(1, { type: 'transcript', id: 1, text: 'tengo sed', final: true })
await tick()
assert.deepEqual(transcripts, ['tengo sed'])
send(1, { type: 'transcript', id: 2, text: 'tengo sed', final: true })
await tick()
assert.deepEqual(transcripts, ['tengo sed', 'tengo sed'], 'repeticiones realmente dichas son válidas')
send(1, { type: 'transcript', id: 1, text: 'historial', final: true })
send(1, { type: 'transcript', id: 3.5, text: 'id inválido', final: true })
await tick()
assert.equal(transcripts.length, 2)
await session.stop()
assert.equal(timers.size, 0)
send(1, { type: 'transcript', id: 3, text: 'resultado atrasado', final: true })
assert.equal(transcripts.length, 2)
assert.deepEqual(stops, [1])
await session.start()
send(1, { type: 'error', message: 'error viejo' })
assert.deepEqual(errors, [])
send(2, { type: 'transcript', id: 1, text: 'hola', final: true })
await tick()
assert.equal(transcripts.at(-1), 'hola', 'nueva sesión permite iniciar IDs de cero')
send(2, { type: 'error', message: 'dispositivo perdido' })
await tick()
assert.equal(errors.at(-1), 'dispositivo perdido')
await Promise.resolve()
assert.equal(statuses.at(-1), 'idle')

// Detener durante el arranque no deja un proceso capturando a escondidas.
delayStart = true
const starting = session.start()
for (let i = 0; i < 6; i++) await Promise.resolve()
assert.ok(resolveStart)
await session.stop()
resolveStart()
await starting
assert.equal(stops.at(-1), 3)
send(3, { type: 'transcript', id: 1, text: 'cancelado', final: true })
assert.equal(transcripts.at(-1), 'hola')

const beforeImmediateCancel = id
const immediatelyCancelled = session.start()
await session.stop()
await immediatelyCancelled
assert.equal(id, beforeImmediateCancel, 'cancelar antes del primer await no debe iniciar captura')

delayStart = false
await session.start()
const retryId = id
send(retryId, { type: 'status', state: 'listening' })
send(retryId, { type: 'transcript', id: 1, text: 'gracias', final: true })
readFailures = 1
await tick()
assert.notEqual(transcripts.at(-1), 'gracias')
await tick()
assert.equal(transcripts.at(-1), 'gracias', 'un fallo IPC no pierde el resultado retenido por Rust')
await tick()
assert.equal(transcripts.filter(text => text === 'gracias').length, 1, 'el cursor no reinterpreta historial')
nativeSessions.get(retryId).running = false
await tick()
assert.equal(statuses.at(-1), 'idle', 'un worker muerto no deja el play activo')

await session.start()
clock = 1001
await tick()
assert.match(errors.at(-1), /no terminó de iniciar/)
assert.equal(statuses.at(-1), 'idle')
await session.start()
readFailures = 3
for (let i = 0; i < 3; i++) await tick()
assert.match(errors.at(-1), /conectar el audio al avatar/)
assert.equal(timers.size, 0)

await session.start()
send(id, { type: 'transcript', id: 1, text: 'respuesta a fuente anterior', final: true })
let finishRead
delayedRead = snapshot => new Promise(resolve => { finishRead = () => resolve(snapshot) })
const oldRead = tick()
await session.stop()
finishRead()
await oldRead
delayedRead = null
assert.notEqual(transcripts.at(-1), 'respuesta a fuente anterior')
assert.equal(timers.size, 0, 'una consulta tardía no reactiva la fuente cancelada')

await session.start()
send(id, { type: 'status', state: 'listening' })
nativeSessions.get(id).events[0].sequence = 2
await tick()
assert.match(errors.at(-1), /perdió resultados/)
assert.equal(statuses.at(-1), 'idle')

// La salida nueva reutiliza contexto, sin convertir SE provisional en señas.
let pending = []
const tokens = []
for (const text of ['tengo', 'sed', 'hola', 'cómo', 'estás']) {
  const update = pushContextWord(pending, text, {
    availableTokens: ['TENGO_SED', 'HOLA', 'COMO_ESTAS', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    fallbackResolver: (words, available) => expandTokens(words, available), source: 'voice',
  })
  pending = update.pendingWords
  tokens.push(...update.committed.flatMap(unit => unit.playTokens))
}
assert.deepEqual(tokens, ['TENGO_SED', 'HOLA', 'COMO_ESTAS'])
assert.deepEqual(pending, [])
// La guía explica el estado real de captura, se recuerda y no requiere storage.
assert.equal(FLOATING_TUTORIAL_STEPS.length, 6)
assert.match(FLOATING_TUTORIAL_STEPS[1].title, /rosado/)
assert.match(FLOATING_TUTORIAL_STEPS[1].body, /después de ese cambio/)
const storage = new Map()
globalThis.window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }
assert.equal(needsFloatingTutorial(), true)
rememberFloatingTutorial()
assert.equal(storage.get(FLOATING_TUTORIAL_KEY), 'done')
assert.equal(needsFloatingTutorial(), false)
globalThis.window = { localStorage: { getItem() { throw new Error('storage bloqueado') }, setItem() { throw new Error('storage bloqueado') } } }
assert.equal(needsFloatingTutorial(), true)
assert.doesNotThrow(rememberFloatingTutorial)
// Renderizar el componente real: controles mínimos, sin caja ni transcripción.
globalThis.window = { __TAURI_INTERNALS__: {}, SpeechRecognition: class {} }
const rendered = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import Widget from './src/components/FloatingAvatarWidget.jsx';
      export default renderToStaticMarkup(React.createElement(Widget));`,
    resolveDir: process.cwd(), loader: 'jsx',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'avatar-placeholder', setup(builder) {
    builder.onResolve({ filter: /AvatarSignerVRM\.jsx$/ }, () => ({ path: 'avatar', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
      contents: 'export default function Avatar() { return null }', loader: 'js',
    }))
  } }],
})
const renderModule = { exports: {} }
new Function('require', 'module', 'exports', rendered.outputFiles[0].text)(
  createRequire(import.meta.url), renderModule, renderModule.exports,
)
const html = renderModule.exports.default
const footer = html.slice(html.indexOf('class="border-t'))
assert.equal((footer.match(/<button/g) || []).length, 2)
assert.match(footer, /Activar micrófono/)
assert.match(footer, /Interpretar audio del PC/)
assert.doesNotMatch(html, /<input|<textarea|Animaciones conectadas|Escuchar micrófono/)
assert.match(html, /role="dialog" aria-modal="true"/)
assert.match(html, /Ver guía del avatar flotante/)
assert.match(html, /inert=""/, 'no se activan controles detrás de la guía')
delete globalThis.window
console.log('Audio del PC: IDs, silencio de eventos, cambios/cancelaciones y contexto OK.')

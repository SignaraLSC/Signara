import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Ejecutar los callbacks de ambas pantallas reales sin micrófono, WASAPI,
// WebGL ni permisos. Solo se sustituyen render/hooks y las fuentes de audio.
const available = [...'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ', 'HOLA', 'COMO_ESTAS', 'TENGO_SED', 'POR_FAVOR', 'GRACIAS', 'AYUDA']
let harness
let microphone, system
let timerId = 0
const timers = new Map()
const originals = { window: globalThis.window, document: globalThis.document,
  fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => 'done' } }
const classes = { add() {}, remove() {} }
globalThis.document = { documentElement: { classList: classes }, body: { classList: classes } }
globalThis.fetch = async () => ({ ok: true, json: async () => ({ tokens: available }) })
globalThis.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id }
globalThis.clearTimeout = id => timers.delete(id)
globalThis.__AVATAR_ROUTING_HOOKS = {
  useRef(initial) { return harness.slot(() => ({ current: initial })) },
  useState(initial) {
    const box = harness.slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    return [box.value, value => { box.value = typeof value === 'function' ? value(box.value) : value }]
  },
  useEffect(effect, deps) {
    const box = harness.slot(() => ({ deps: null }))
    if (!box.deps || !deps || deps.some((value, i) => value !== box.deps[i])) {
      box.deps = deps
      harness.effects.push(effect)
    }
  },
  useCallback(fn) { return fn },
  useMemo(fn) { return fn() },
  useImperativeHandle(ref, create) { if (ref) ref.current = create() },
  forwardRef(render) { return render },
  memo(component) { return component },
}
globalThis.__AVATAR_ROUTING_AUDIO = {
  mic(options) { microphone = options; return { supported: true, listening: false, start() {}, stop() {} } },
  system(options) { system = options; return { supported: true, active: false, ready: false, status: { state: 'idle' }, start() {}, stop() {} } },
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const child of [tree.props?.children].flat(Infinity)) {
    const hit = find(child, predicate)
    if (hit) return hit
  }
  return null
}

class Harness {
  constructor(render) { this.renderComponent = render; this.slots = []; this.effects = []; this.played = [] }
  slot(create) { const i = this.index++; return this.slots[i] ??= create() }
  render() {
    harness = this
    this.index = 0
    this.tree = this.renderComponent({})
    const avatar = find(this.tree, node => node.type?.name === 'AvatarProbe')
    if (avatar) avatar.props.ref.current = {
      queue: token => this.played.push(token), queueBatch: tokens => this.played.push(...tokens), clear() {}, replace() {},
    }
  }
  async settle() {
    this.render()
    while (this.effects.length) for (const effect of this.effects.splice(0)) effect()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    this.render()
    while (this.effects.length) for (const effect of this.effects.splice(0)) effect()
  }
}

try {
  const bundled = await build({
    stdin: { contents: `export { default as Floating } from './src/components/FloatingAvatarWidget.jsx';
      export { default as Normal } from './src/components/TranslationScreen.jsx';`, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'avatar-routing-harness', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'harness' }))
      builder.onResolve({ filter: /^react-dom$/ }, args => ({ path: args.path, namespace: 'harness' }))
      builder.onResolve({ filter: /(?:AvatarSignerVRM\.jsx|useVoiceInput\.js|useSystemAudio\.js)$/ }, args => ({ path: args.path, namespace: 'harness' }))
      builder.onResolve({ filter: /^@tauri-apps\/api\/event$/ }, () => ({ path: 'event', namespace: 'harness' }))
      builder.onLoad({ filter: /.*/, namespace: 'harness' }, args => {
        let contents
        if (args.path === 'react') contents = 'export const { useRef, useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef, memo } = globalThis.__AVATAR_ROUTING_HOOKS; export const useLayoutEffect = useEffect; export const useId = () => "routing-test";'
        else if (args.path === 'react/jsx-runtime') contents = 'export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = "fragment";'
        else if (args.path === 'react-dom') contents = 'export const createPortal = children => children;'
        else if (args.path.endsWith('AvatarSignerVRM.jsx')) contents = 'export default function AvatarProbe() { return null }'
        else if (args.path.endsWith('useVoiceInput.js')) contents = 'export default globalThis.__AVATAR_ROUTING_AUDIO.mic;'
        else if (args.path.endsWith('useSystemAudio.js')) contents = 'export default globalThis.__AVATAR_ROUTING_AUDIO.system;'
        else contents = 'export async function listen() { return () => {} }'
        return { contents, loader: 'js' }
      })
    } }],
  })
  const { Floating, Normal } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  const floating = new Harness(Floating)
  await floating.settle()
  await find(floating.tree, node => node.props?.['aria-label'] === 'Interpretar audio del PC').props.onClick()
  system.onResult('tengo sed por favor necesito ayuda mañana gracias hola')
  assert.equal(floating.played[0], 'TENGO_SED', 'Play no debe deletrear una frase disponible dentro de un delta largo')
  const beforeShort = floating.played.length
  system.onResult('Tengo sed.')
  assert.deepEqual(floating.played.slice(beforeShort), ['TENGO_SED'], 'Play también resuelve una frase corta aislada')
  const before = floating.played.length
  system.onResult('tengo')
  for (const callback of timers.values()) callback()
  assert.equal(floating.played.length, before, 'una pausa no separa TENGO del sufijo pendiente')
  system.onResult('sed gracias hola como estas por favor necesito ayuda mañana')
  assert.equal(floating.played[before], 'TENGO_SED', 'la frase conserva contexto entre entregas de Play')
  await find(floating.tree, node => node.props?.['aria-label'] === 'Activar micrófono').props.onClick()
  const afterSwitch = floating.played.length
  system.onResult('tengo sed')
  assert.equal(floating.played.length, afterSwitch, 'ignorar resultados de la fuente anterior')
  microphone.onResult('tengo sed')
  assert.deepEqual(floating.played.slice(afterSwitch), ['TENGO_SED'])

  const normal = new Harness(Normal)
  await normal.settle()
  let panel = find(normal.tree, node => typeof node.props?.onLiveWord === 'function')
  for (const word of 'tengo sed por favor necesito ayuda mañana gracias hola'.split(' ')) panel.props.onLiveWord(word)
  panel.props.onSubmit('tengo sed por favor necesito ayuda mañana gracias hola', { fromVoice: true })
  await normal.settle()
  assert.equal(normal.played[0], 'TENGO_SED', 'la pantalla normal mantiene su reconocimiento de frase')
  const beforeRepeat = normal.played.length
  panel = find(normal.tree, node => typeof node.props?.onLiveWord === 'function')
  panel.props.onLiveWord('tengo')
  panel.props.onSubmit('tengo', { fromVoice: true })
  assert.equal(normal.played.length, beforeRepeat)
  panel.props.onLiveWord('sed')
  panel.props.onSubmit('sed', { fromVoice: true })
  assert.deepEqual(normal.played.slice(beforeRepeat), ['TENGO_SED'], 'repetición real y fragmentada se reproduce una vez')
  console.log('OK pantallas reales: TENGO_SED con Play, micrófono flotante y voz normal; contexto, bloques largos y cambios de fuente')
} catch (error) {
  // Un stack con el bundle data: completo oculta el motivo del fallo.
  console.error(error.name, error.message)
  process.exitCode = 1
} finally {
  Object.assign(globalThis, originals)
  delete globalThis.__AVATAR_ROUTING_HOOKS
  delete globalThis.__AVATAR_ROUTING_AUDIO
}

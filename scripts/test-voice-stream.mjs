import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pushContextWord } from '../src/utils/contextualSignWindow.js'
import { expandTokens } from '../src/utils/fingerspell.js'
import { advanceVoiceResultLedger, createVoiceResultLedger } from '../src/utils/voiceTranscript.js'

function result(text, isFinal = false) {
  const value = [{ transcript: text }]
  value.isFinal = isFinal
  return value
}

let ledger = createVoiceResultLedger()
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo se')]).delta, '')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo')]).delta, '')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo sed')]).delta, '')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo sed', true)]).delta, 'tengo sed')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo sed', true)]).delta, '')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo sed', true), result('gracias')]).delta, '')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo sed', true), result('gracias', true)]).delta, 'gracias')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo sed', true), result('gracias', true)]).delta, '')
assert.equal(advanceVoiceResultLedger(ledger, []).delta, '', 'un evento vacío no convierte historial en voz nueva')

ledger = createVoiceResultLedger()
assert.equal(advanceVoiceResultLedger(ledger, [result('hola', true), result('hola', true)]).delta, 'hola hola',
  'una repetición realmente dicha no se elimina por igualdad de texto')
ledger = createVoiceResultLedger()
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo'), result('sed', true)]).delta, '',
  'no entregar resultados confirmados fuera de orden')
assert.equal(advanceVoiceResultLedger(ledger, [result('tengo', true), result('sed', true)]).delta, 'tengo sed')
ledger = createVoiceResultLedger(['hola', 'gracias'])
assert.equal(advanceVoiceResultLedger(ledger, [result('hola', true), result('gracias', true)]).delta, '',
  'sin nuevo comienzo de voz, no reproducir resultados del ciclo anterior')
assert.equal(advanceVoiceResultLedger(ledger, [result('hola', true), result('gracias', true), result('bien', true)]).delta, 'bien')
ledger = createVoiceResultLedger(['hola'])
assert.equal(advanceVoiceResultLedger(ledger, [result('hola', true)], { newSpeech: true }).delta, 'hola',
  'hablar de nuevo permite repetir la misma palabra tras reiniciar')

// Ejecutar el hook real con eventos de SpeechRecognition controlados. Solo
// React se sustituye por un entorno mínimo; no requiere permisos de micrófono.
const effects = []
globalThis.__VOICE_TEST_HOOKS = {
  useRef: current => ({ current }),
  useState: initial => [initial, () => {}],
  useCallback: callback => callback,
  useEffect: effect => { effects.push(effect) },
}
const bundled = await build({
  entryPoints: ['src/hooks/useVoiceInput.js'], bundle: true, write: false,
  platform: 'node', format: 'esm',
  plugins: [{ name: 'test-hooks', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
      contents: 'export const { useRef, useState, useCallback, useEffect } = globalThis.__VOICE_TEST_HOOKS;',
      loader: 'js',
    }))
  } }],
})
const hook = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
let recognition
class FakeRecognition {
  constructor() { recognition = this; this.active = false }
  start() {
    if (this.active) throw Error('already started')
    this.active = true
    this.onstart?.()
  }
  stop() { this.active = false; this.onend?.() }
  abort() { this.active = false; this.onend?.() }
  restart() { this.active = false; this.onend?.() }
  send(...results) { this.onresult?.({ results, resultIndex: 0 }) }
}
globalThis.window = { SpeechRecognition: FakeRecognition }
const deltas = []
const previews = []
let pending = []
const played = []
const available = [...'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ', 'TENGO_SED', 'COMO_ESTAS', 'GRACIAS', 'HOLA']
const voice = hook.default({
  onLiveTranscript: (_text, _final, snapshot) => previews.push(snapshot.interimText),
  onResult: text => {
    deltas.push(text)
    for (const word of text.split(/\s+/)) {
      const update = pushContextWord(pending, word, {
        availableTokens: available, fallbackResolver: (words, tokens) => expandTokens(words, tokens), source: 'voice',
      })
      pending = update.pendingWords
      played.push(...update.committed.flatMap(unit => unit.playTokens))
    }
  },
})
const cleanups = effects.map(effect => effect()).filter(Boolean)
voice.start()
recognition.onspeechstart()
recognition.send(result('tengo se'))
recognition.send(result('tengo sed'))
assert.deepEqual(deltas, [])
recognition.send(result('tengo', true), result('se'))
assert.deepEqual(deltas, ['tengo'])
assert.deepEqual(played, [], 'un final de «tengo» sigue esperando «sed», no deletrea TENGO')
recognition.send(result('tengo', true), result('sed'))
recognition.send(result('tengo', true), result('sed', true))
assert.deepEqual(played, ['TENGO_SED'], 'no señar SE antes de TENGO_SED')
recognition.send(result('tengo', true), result('sed', true), result('gracias'))
recognition.send(result('tengo', true), result('sed', true))
recognition.send(result('tengo', true), result('sed', true), result('gracias', true))
assert.deepEqual(played, ['TENGO_SED', 'GRACIAS'], 'acortar/corregir hipótesis no repite lo ya consumido')
for (let i = 0; i < 25; i++) recognition.send(result('tengo', true), result('sed', true), result('gracias', true))
assert.deepEqual(played, ['TENGO_SED', 'GRACIAS'])
recognition.restart()
recognition.restart()
recognition.send(result('tengo', true), result('sed', true), result('gracias', true))
assert.deepEqual(played, ['TENGO_SED', 'GRACIAS'], 'varios reinicios vacíos sin nueva voz no repiten la conversación')
recognition.restart()
recognition.onspeechstart()
recognition.send(result('hola', true))
assert.equal(played.at(-1), 'HOLA')
recognition.send(result('hola', true), result('hola', true))
assert.deepEqual(played.slice(-2), ['HOLA', 'HOLA'], 'repetición legítima dentro de conversación conservada')
recognition.restart()
recognition.onspeechstart()
recognition.send(result('hola', true))
assert.deepEqual(played.slice(-3), ['HOLA', 'HOLA', 'HOLA'])
assert.equal(previews.at(-1), '')
cleanups.forEach(cleanup => cleanup())
const count = deltas.length
recognition.send(result('texto tardío', true))
assert.equal(deltas.length, count, 'una sesión desmontada no entrega resultados atrasados')

// El panel real tampoco debe enviar la vista previa a onLiveWord/onSubmit.
effects.length = 0
globalThis.__VOICE_TEST_HOOKS.forwardRef = render => render
globalThis.__VOICE_TEST_HOOKS.useImperativeHandle = (ref, create) => { ref.current = create() }
const panelBundle = await build({
  entryPoints: ['src/components/TextInputPanel.jsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'test-panel-hooks', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({
      contents: args.path === 'react'
        ? 'export const { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } = globalThis.__VOICE_TEST_HOOKS;'
        : 'export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = "fragment";',
      loader: 'js',
    }))
  } }],
})
const panel = await import(`data:text/javascript;base64,${Buffer.from(panelBundle.outputFiles[0].text).toString('base64')}`)
const panelWords = [], panelFinals = []
panel.default({
  onLiveWord: word => panelWords.push(word),
  onSubmit: (text, options) => panelFinals.push({ text, options }),
}, {})
const panelCleanups = effects.map(effect => effect()).filter(Boolean)
recognition.start()
recognition.onspeechstart()
recognition.send(result('tengo se'))
recognition.send(result('tengo'))
recognition.send(result('tengo sed'))
assert.deepEqual(panelWords, [])
assert.deepEqual(panelFinals, [])
recognition.send(result('tengo sed', true))
assert.deepEqual(panelWords, ['tengo', 'sed'])
assert.deepEqual(panelFinals, [{ text: 'tengo sed', options: { fromVoice: true } }])
recognition.send(result('tengo sed', true), result('gracias'))
recognition.send(result('tengo sed', true))
recognition.send(result('tengo sed', true), result('gracias', true))
assert.deepEqual(panelWords, ['tengo', 'sed', 'gracias'], 'el panel no usa el historial ni resetea el cursor al cambiar hipótesis')
assert.equal(panelFinals.at(-1).text, 'gracias', 'el cierre solo lleva el delta nuevo, no toda la conversación')
panelCleanups.forEach(cleanup => cleanup())
delete globalThis.window
delete globalThis.__VOICE_TEST_HOOKS
console.log('OK voz continua: hipótesis editables, finales por identidad, reinicios/silencio sin replay y repetición legítima')

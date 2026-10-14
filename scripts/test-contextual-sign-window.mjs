import assert from 'node:assert/strict'
import {
  flushContextWindow,
  pushContextWord,
} from '../src/utils/contextualSignWindow.js'
import { expandTokens } from '../src/utils/fingerspell.js'

const letters = 'A B C D E F G H I J K L M N Ñ O P Q R S T U V W X Y Z'.split(' ')
const available = [...letters, 'COMO_ESTAS', 'POR_FAVOR', 'TENGO_SED', 'AYUDA']
const fallbackResolver = (words, tokens) => expandTokens(words, tokens)
const options = { availableTokens: available, fallbackResolver, source: 'voice' }

let pending = []
let played = []
function say(word) {
  const result = pushContextWord(pending, word, options)
  pending = result.pendingWords
  played.push(...result.committed.flatMap((unit) => unit.playTokens))
}

say('como')
assert.deepEqual(played, [])
assert.deepEqual(pending, ['como'])
say('estas')
assert.deepEqual(played, ['COMO_ESTAS'])
assert.deepEqual(pending, [])

say('por')
say('favor')
assert.deepEqual(played, ['COMO_ESTAS', 'POR_FAVOR'])

say('profesor')
assert.deepEqual(played.slice(-8), 'PROFESOR'.split(''))

say('por')
say('la')
assert.deepEqual(pending, ['por', 'la'])
say('mañana')
// La expresión se comprendió completa; como aún no está grabada, se deletrea.
assert.deepEqual(played.slice(-11), 'PORLAMAÑANA'.split(''))

say('necesito')
assert.deepEqual(pending, ['necesito'])
say('ayuda')
assert.equal(played.at(-1), 'AYUDA::self')

say('maria')
const final = flushContextWindow(pending, options)
played.push(...final.committed.flatMap((unit) => unit.playTokens))
assert.deepEqual(played.slice(-5), ['M', 'A', 'R', 'I', 'A'])

// Play entrega bloques, el micrófono normal entrega palabras. Deben resolver
// las mismas frases aun cuando el delta supere el límite de ocho palabras.
const fullAvailable = [...available, 'HOLA', 'GRACIAS']
const fullOptions = { ...options, availableTokens: fullAvailable }
for (const text of [
  'tengo sed por favor necesito ayuda mañana gracias hola',
  'hola como estas por favor tengo sed gracias hola',
  'tengo sed tengo sed tengo sed tengo sed tengo sed',
]) {
  const batch = pushContextWord([], text, fullOptions)
  let incrementalPending = []
  const incrementalTokens = []
  for (const word of text.split(' ')) {
    const next = pushContextWord(incrementalPending, word, fullOptions)
    incrementalPending = next.pendingWords
    incrementalTokens.push(...next.committed.flatMap(unit => unit.playTokens))
  }
  assert.deepEqual(batch.committed.flatMap(unit => unit.playTokens), incrementalTokens,
    `no romper expresiones por el tamaño del fragmento: ${text}`)
  assert.deepEqual(batch.pendingWords, incrementalPending)
  assert.ok(incrementalTokens.includes('TENGO_SED'))
}
const split = pushContextWord(['tengo'], 'sed por favor necesito ayuda mañana gracias hola como estas', fullOptions)
assert.equal(split.committed[0].playTokens[0], 'TENGO_SED', 'conservar prefijo del delta anterior')
const unfinished = pushContextWord([], 'hola gracias hola gracias hola gracias hola gracias tengo', fullOptions)
assert.deepEqual(unfinished.pendingWords, ['tengo'], 'el límite no vacía una frase todavía incompleta')
assert.deepEqual(pushContextWord([], 'tengo', fullOptions).committed, [])
assert.deepEqual(pushContextWord([], 'tengo ser', fullOptions).committed.flatMap(unit => unit.playTokens),
  'TENGOSER'.split(''), 'no cambiar una transcripción distinta a SED por adivinación')
const limited = pushContextWord([], 'por la', { ...fullOptions, maxWords: 1 })
assert.ok(limited.pendingWords.length <= 1, 'mantener límite defensivo del contexto pendiente')

console.log('OK ventana contextual: frases, espera incremental y deletreo de respaldo')

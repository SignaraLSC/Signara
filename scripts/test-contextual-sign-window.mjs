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

console.log('OK ventana contextual: frases, espera incremental y deletreo de respaldo')

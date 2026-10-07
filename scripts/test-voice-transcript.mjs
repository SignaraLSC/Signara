import assert from 'node:assert/strict'
import {
  collapseRepeatedPhrase,
  deriveVoiceClause,
  voiceKey,
} from '../src/utils/voiceTranscript.js'

assert.equal(voiceKey('¿Hóla, cómo estás?'), 'hola como estas')
assert.equal(
  collapseRepeatedPhrase('¿Hola, cómo estás? ¿Hola, cómo estás?'),
  '¿Hola, cómo estás?',
)
assert.equal(collapseRepeatedPhrase('no no'), 'no no')

const first = deriveVoiceClause('Hola cómo estás', '')
assert.equal(first.clause, 'Hola cómo estás')

const stale = deriveVoiceClause('¿Hola, cómo estás?', first.normalized)
assert.equal(stale.clause, '')

const duplicated = deriveVoiceClause(
  'Hola cómo estás Hola cómo estás',
  first.normalized,
)
assert.equal(duplicated.clause, '')

const extended = deriveVoiceClause('Hola cómo estás bien gracias', first.normalized)
assert.equal(extended.clause, 'bien gracias')

console.log('OK voz flotante: silencio/stale no repite, frase duplicada colapsa y extensión entrega solo delta')

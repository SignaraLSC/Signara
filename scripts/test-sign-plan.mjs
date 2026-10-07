import assert from 'node:assert/strict'
import {
  SIGN_TOKEN_TYPES,
  compileSignPlanToPlayTokens,
  createSignPlan,
  legacyPlayTokensToSignPlan,
  validateSignPlan,
} from '../src/utils/signPlan.js'

const plan = createSignPlan({
  sourceText: 'Mañana por la mañana yo te ayudo',
  source: 'voice',
  intent: 'inform',
  planId: 'test-context',
  tokens: [
    {
      type: SIGN_TOKEN_TYPES.TEMPORAL,
      sourceText: 'Mañana',
      gloss: 'MAÑANA',
      playToken: 'MAÑANA',
      payload: { kind: 'day', value: 'tomorrow', orientation: 'future' },
    },
    {
      type: SIGN_TOKEN_TYPES.TEMPORAL,
      sourceText: 'por la mañana',
      gloss: 'POR_LA_MAÑANA',
      playToken: 'POR_LA_MAÑANA',
      payload: { kind: 'day_period', value: 'morning', orientation: 'contextual' },
    },
    {
      type: SIGN_TOKEN_TYPES.PRONOUN,
      sourceText: 'yo',
      gloss: 'YO',
      playToken: 'YO',
      payload: { person: 1, number: 'singular', implicit: false, locus: 'self' },
    },
    {
      id: 'help',
      type: SIGN_TOKEN_TYPES.SIGN,
      sourceText: 'te ayudo',
      gloss: 'AYUDA',
      playToken: 'AYUDA::listener',
      payload: {},
    },
    {
      type: SIGN_TOKEN_TYPES.DIRECTION,
      sourceText: '',
      payload: { direction: 'listener', appliesTo: 'help' },
    },
    {
      type: SIGN_TOKEN_TYPES.FACIAL,
      sourceText: '',
      payload: { appliesTo: 'help', channels: { eyes: 0.4, head: 0.2 } },
    },
  ],
})

assert.equal(validateSignPlan(plan).valid, true)
assert.deepEqual(compileSignPlanToPlayTokens(plan), [
  'MAÑANA',
  'POR_LA_MAÑANA',
  'YO',
  'AYUDA::listener',
])

const phrasePlan = createSignPlan({
  sourceText: 'por favor',
  planId: 'test-phrase',
  tokens: [{
    type: SIGN_TOKEN_TYPES.PHRASE,
    gloss: 'POR_FAVOR',
    playToken: 'POR_FAVOR',
    payload: { words: ['por', 'favor'] },
  }],
})
assert.deepEqual(compileSignPlanToPlayTokens(phrasePlan), ['POR_FAVOR'])

const legacy = legacyPlayTokensToSignPlan('ayúdame por favor', [
  'AYUDA::self',
  'POR_FAVOR',
], { planId: 'test-legacy' })
assert.equal(legacy.tokens[0].payload.direction, 'self')
assert.deepEqual(compileSignPlanToPlayTokens(legacy), ['AYUDA::self', 'POR_FAVOR'])

const pending = createSignPlan({
  sourceText: 'por',
  planId: 'test-pending',
  tokens: [{
    type: SIGN_TOKEN_TYPES.SIGN,
    gloss: 'POR',
    playToken: 'POR',
    status: 'pending',
    payload: {},
  }],
})
assert.deepEqual(compileSignPlanToPlayTokens(pending), [])
assert.deepEqual(compileSignPlanToPlayTokens(pending, { includePending: true }), ['POR'])

const invalid = structuredClone(plan)
invalid.tokens[4].payload.direction = 'invented-direction'
const result = validateSignPlan(invalid)
assert.equal(result.valid, false)
assert.match(result.errors.join('\n'), /direction no es válida/)

const dangling = structuredClone(plan)
dangling.tokens[5].payload.appliesTo = 'missing-token'
const danglingResult = validateSignPlan(dangling)
assert.equal(danglingResult.valid, false)
assert.match(danglingResult.errors.join('\n'), /token inexistente/)

console.log('OK SignPlan v1: 6 tipos, compilación, pending y validación')

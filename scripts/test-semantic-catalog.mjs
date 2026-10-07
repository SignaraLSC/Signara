import assert from 'node:assert/strict'
import {
  EDUCATIONAL_SEMANTIC_CATALOG,
  getSemanticCatalogStats,
  resolveSemanticSegments,
  semanticTextToSignPlan,
} from '../src/utils/semanticCatalog.js'
import { compileSignPlanToPlayTokens } from '../src/utils/signPlan.js'

const noFallback = () => []

// Longest-match: no dividir "por la mañana" en MAÑANA.
const segments = resolveSemanticSegments('Mañana por la mañana')
assert.equal(segments.length, 2)
assert.equal(segments[0].entry.id, 'time.tomorrow_day')
assert.equal(segments[1].entry.id, 'time.morning_period')

// Significado se conserva aunque todavía no exista animación.
const missingTime = semanticTextToSignPlan({
  sourceText: 'Mañana por la mañana',
  availableTokens: [],
  fallbackResolver: noFallback,
  planId: 'missing-time',
})
assert.deepEqual(missingTime.tokens.map((token) => token.gloss), [
  'MAÑANA',
  'POR_LA_MAÑANA',
])
assert.ok(missingTime.tokens.every((token) => token.availability === 'missing'))
assert.deepEqual(compileSignPlanToPlayTokens(missingTime), [])

// Al grabar esas animaciones, el mismo catálogo comienza a reproducirlas sin
// cambiar sus reglas semánticas.
const recordedTime = semanticTextToSignPlan({
  sourceText: 'Mañana por la mañana',
  availableTokens: ['MAÑANA', 'POR_LA_MAÑANA'],
  fallbackResolver: noFallback,
  planId: 'recorded-time',
})
assert.deepEqual(compileSignPlanToPlayTokens(recordedTime), [
  'MAÑANA',
  'POR_LA_MAÑANA',
])

// Una intención en español puede reutilizar la geometría direccional existente.
const help = semanticTextToSignPlan({
  sourceText: 'Necesito ayuda por favor',
  availableTokens: ['AYUDA', 'POR_FAVOR'],
  fallbackResolver: noFallback,
  planId: 'help-request',
})
assert.deepEqual(compileSignPlanToPlayTokens(help), [
  'AYUDA::self',
  'POR_FAVOR',
])

const politeHelp = semanticTextToSignPlan({
  sourceText: 'Por favor ayúdame',
  availableTokens: ['AYUDA', 'POR_FAVOR'],
  fallbackResolver: noFallback,
  planId: 'polite-help-request',
})
assert.deepEqual(compileSignPlanToPlayTokens(politeHelp), [
  'POR_FAVOR',
  'AYUDA::self',
])

// Segmentos fuera del catálogo siguen usando el matcher heredado y conservan
// el orden respecto a las unidades semánticas.
const mixed = semanticTextToSignPlan({
  sourceText: 'hola mañana gracias',
  availableTokens: ['HOLA', 'GRACIAS'],
  fallbackResolver(words, available) {
    return words.filter((word) => available.includes(word))
  },
  planId: 'mixed',
})
assert.deepEqual(mixed.tokens.map((token) => token.gloss), [
  'HOLA',
  'MAÑANA',
  'GRACIAS',
])
assert.deepEqual(compileSignPlanToPlayTokens(mixed), ['HOLA', 'GRACIAS'])

const stats = getSemanticCatalogStats()
assert.ok(stats.entries >= 30)
assert.ok(stats.patterns > stats.entries)
assert.equal(new Set(EDUCATIONAL_SEMANTIC_CATALOG.map((entry) => entry.id)).size, stats.entries)

console.log(`OK catálogo semántico: ${stats.entries} entradas, ${stats.patterns} patrones`)

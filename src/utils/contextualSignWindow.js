import { inspectSemanticPrefix, semanticTextToSignPlan } from './semanticCatalog.js'
import { compileSignPlanToPlayTokens } from './signPlan.js'
import { tokenize } from './textNormalizer.js'

export const CONTEXT_WINDOW_MAX_WORDS = 8

function normalizeWords(words) {
  return (words || []).flatMap((word) => tokenize(word))
}

function buildCommittedUnit(words, options) {
  const sourceText = words.join(' ')
  const plan = semanticTextToSignPlan({
    sourceText,
    availableTokens: options.availableTokens,
    fallbackResolver: options.fallbackResolver,
    source: options.source || 'voice',
    intent: options.intent || 'unknown',
  })
  return {
    sourceText,
    words: [...words],
    plan,
    playTokens: compileSignPlanToPlayTokens(plan),
  }
}

/**
 * Drena únicamente unidades cuyo significado ya es seguro. La última palabra
 * se conserva si todavía puede crecer hasta una frase conocida del catálogo.
 */
function drain(words, options, final) {
  const pending = [...words]
  const committed = []

  while (pending.length) {
    let selectedLength = 0
    let waitingForExtension = false

    // Busca la expresión completa más larga que empiece en la palabra actual.
    for (let length = pending.length; length >= 1; length--) {
      const prefix = inspectSemanticPrefix(pending.slice(0, length))
      if (prefix.exact.length) {
        selectedLength = length
        // Si todo el buffer todavía puede extenderse, esperar otra palabra.
        if (!final && length === pending.length && prefix.extensions.length) {
          waitingForExtension = true
        }
        break
      }
    }

    if (waitingForExtension) break
    if (selectedLength) {
      const unitWords = pending.splice(0, selectedLength)
      committed.push(buildCommittedUnit(unitWords, options))
      continue
    }

    const wholePrefix = inspectSemanticPrefix(pending)
    if (!final && wholePrefix.extensions.length) break

    // No puede convertirse en una expresión conocida: confirmar una palabra
    // y conservar el resto para que aún pueda formar otra frase compuesta.
    committed.push(buildCommittedUnit(pending.splice(0, 1), options))
  }

  return { pendingWords: pending, committed }
}

export function pushContextWord(currentWords, rawWord, options) {
  // Web Speech suele entregar palabras; Play puede entregar varias frases.
  // El límite corresponde al CONTEXTO PENDIENTE, no al tamaño del delta.
  // Resolver antes de limitar: cortar la primera palabra de un bloque largo
  // rompía «tengo sed» en TENGO + SED aunque existiese su animación.
  const result = drain([...normalizeWords(currentWords), ...tokenize(rawWord)], options, false)
  const maximum = options.maxWords || CONTEXT_WINDOW_MAX_WORDS
  while (result.pendingWords.length > maximum) {
    const first = buildCommittedUnit(result.pendingWords.slice(0, 1), options)
    const rest = drain(result.pendingWords.slice(1), options, false)
    result.pendingWords = rest.pendingWords
    result.committed.push(first, ...rest.committed)
  }
  return result
}

export function flushContextWindow(currentWords, options) {
  return drain(normalizeWords(currentWords), options, true)
}

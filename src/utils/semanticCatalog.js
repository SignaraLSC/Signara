import { EDUCATIONAL_SEMANTIC_CATALOG, SEMANTIC_CATALOG_VERSION } from '../data/semanticCatalog.js'
import { parsePlayToken } from './directionalVerbs.js'
import {
  SIGN_TOKEN_AVAILABILITY,
  createSignPlan,
  legacyPlayTokensToSignPlan,
} from './signPlan.js'
import { tokenize } from './textNormalizer.js'

function normalizedPatterns(entry) {
  return entry.patterns.map((pattern) => tokenize(pattern))
}

const INDEXED_CATALOG = EDUCATIONAL_SEMANTIC_CATALOG
  .flatMap((entry) => normalizedPatterns(entry).map((words) => ({ entry, words })))
  .sort((a, b) => b.words.length - a.words.length)

function wordsEqualAt(input, start, pattern) {
  if (start + pattern.length > input.length) return false
  return pattern.every((word, offset) => input[start + offset] === word)
}

function isPlayTokenAvailable(playToken, availableSet) {
  if (!playToken) return false
  return availableSet.has(parsePlayToken(playToken).citationToken)
}

/** Segmenta con longest-match, pero conserva corridas desconocidas en orden. */
export function resolveSemanticSegments(text, catalog = INDEXED_CATALOG) {
  const words = tokenize(text)
  const segments = []
  let i = 0
  while (i < words.length) {
    const match = catalog.find(({ words: pattern }) => wordsEqualAt(words, i, pattern))
    if (match) {
      segments.push({
        kind: 'semantic',
        entry: match.entry,
        words: words.slice(i, i + match.words.length),
      })
      i += match.words.length
      continue
    }
    const last = segments[segments.length - 1]
    if (last?.kind === 'unmatched') last.words.push(words[i])
    else segments.push({ kind: 'unmatched', words: [words[i]] })
    i += 1
  }
  return segments
}

function semanticEntryToToken(segment, availableSet) {
  const { entry, words } = segment
  const desiredPlayToken = entry.playToken || entry.gloss
  const available = isPlayTokenAvailable(desiredPlayToken, availableSet)
  return {
    type: entry.type,
    sourceText: words.join(' '),
    gloss: entry.gloss,
    playToken: available ? desiredPlayToken : null,
    availability: available
      ? SIGN_TOKEN_AVAILABILITY.AVAILABLE
      : SIGN_TOKEN_AVAILABILITY.MISSING,
    payload: {
      ...entry.payload,
      semanticId: entry.id,
      domain: entry.domain,
      reviewStatus: entry.reviewStatus,
      evidence: entry.evidence || null,
      desiredPlayToken,
    },
  }
}

/**
 * Describe si `words` puede ser el comienzo de una expresión del catálogo.
 * La ventana de voz lo usa para no confirmar "como" antes de escuchar
 * "estas", ni "por la" antes de escuchar "mañana".
 */
export function inspectSemanticPrefix(words) {
  const normalized = Array.isArray(words)
    ? words.flatMap((word) => tokenize(word))
    : tokenize(words)
  if (!normalized.length) return { exact: [], extensions: [], maxPatternWords: 0 }

  const exact = []
  const extensions = []
  let maxPatternWords = 0
  for (const item of INDEXED_CATALOG) {
    maxPatternWords = Math.max(maxPatternWords, item.words.length)
    const shared = Math.min(normalized.length, item.words.length)
    const samePrefix = item.words
      .slice(0, shared)
      .every((word, index) => word === normalized[index])
    if (!samePrefix) continue
    if (item.words.length === normalized.length) exact.push(item.entry)
    else if (item.words.length > normalized.length) extensions.push(item.entry)
  }
  return { exact, extensions, maxPatternWords }
}

/**
 * Construye SignPlan desde el catálogo y usa el matcher existente únicamente
 * para las corridas que el catálogo todavía no comprende.
 */
export function semanticTextToSignPlan({
  sourceText,
  availableTokens = [],
  fallbackResolver,
  source = 'text',
  intent = 'unknown',
  locale = 'es-CO',
  planId,
} = {}) {
  const availableSet = new Set(availableTokens)
  const segments = resolveSemanticSegments(sourceText)
  const tokens = []
  const unmatchedWords = []

  for (const segment of segments) {
    if (segment.kind === 'semantic') {
      const semanticToken = semanticEntryToToken(segment, availableSet)
      tokens.push(semanticToken)

      // Comprender una palabra no debe dejarla muda. Si todavía no existe su
      // seña canónica, usar el respaldo heredado (normalmente deletreo A-Z/Ñ)
      // conservando también el token semántico `missing` para diagnóstico.
      if (semanticToken.availability === SIGN_TOKEN_AVAILABILITY.MISSING) {
        const upperWords = segment.words.map((word) => word.toUpperCase())
        const fallbackTokens = fallbackResolver?.(upperWords, availableTokens) || []
        if (fallbackTokens.length) {
          const legacy = legacyPlayTokensToSignPlan(segment.words.join(' '), fallbackTokens, {
            planId: `semantic-fallback-${tokens.length}`,
          })
          tokens.push(...legacy.tokens.map(({ id: _id, ...token }) => ({
            ...token,
            payload: {
              ...token.payload,
              fallbackFor: semanticToken.gloss,
              fallbackReason: 'animation-missing',
            },
          })))
        }
      }
      continue
    }

    const upperWords = segment.words.map((word) => word.toUpperCase())
    const playTokens = fallbackResolver?.(upperWords, availableTokens) || []
    if (!playTokens.length) {
      unmatchedWords.push(...segment.words)
      continue
    }
    const legacy = legacyPlayTokensToSignPlan(segment.words.join(' '), playTokens, {
      planId: `fallback-${tokens.length}`,
    })
    tokens.push(...legacy.tokens.map(({ id: _id, ...token }) => token))
  }

  const missingGlosses = tokens
    .filter((token) => token.availability === SIGN_TOKEN_AVAILABILITY.MISSING)
    .map((token) => token.gloss)

  return createSignPlan({
    sourceText,
    source,
    locale,
    intent,
    planId,
    tokens,
    metadata: {
      catalogVersion: SEMANTIC_CATALOG_VERSION,
      domain: 'education',
      unmatchedWords,
      missingGlosses,
    },
  })
}

export function getSemanticCatalogStats() {
  const patterns = EDUCATIONAL_SEMANTIC_CATALOG.reduce(
    (sum, entry) => sum + entry.patterns.length,
    0,
  )
  return {
    version: SEMANTIC_CATALOG_VERSION,
    entries: EDUCATIONAL_SEMANTIC_CATALOG.length,
    patterns,
  }
}

export { EDUCATIONAL_SEMANTIC_CATALOG, SEMANTIC_CATALOG_VERSION }

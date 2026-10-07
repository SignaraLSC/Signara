import { semanticTextToSignPlan } from './semanticCatalog.js'
import {
  SIGN_TOKEN_AVAILABILITY,
  SIGN_TOKEN_TYPES,
  createSignPlan,
} from './signPlan.js'

function grammarRank(token) {
  if (token.type === SIGN_TOKEN_TYPES.TEMPORAL) return 0
  if (token.type === SIGN_TOKEN_TYPES.PRONOUN) return 1
  if (token.type === SIGN_TOKEN_TYPES.SIGN || token.type === SIGN_TOKEN_TYPES.PHRASE) return 2
  return 3
}

/**
 * Planificador LSC v1: conserva la resolución semántica y aplica únicamente
 * reglas seguras/documentadas. Por ahora adelanta expresiones temporales y
 * representa el componente no manual de la intención. No inventa conjugación
 * ni orden LSC abierto sin validación de la comunidad.
 */
export function planSpanishToLsc({
  sourceText,
  availableTokens,
  fallbackResolver,
  context,
  source = 'text',
} = {}) {
  const semanticPlan = semanticTextToSignPlan({
    sourceText,
    availableTokens,
    fallbackResolver,
    source,
    intent: context?.intent || 'unknown',
  })

  const ordered = semanticPlan.tokens
    .map((token, index) => ({ token, index }))
    .sort((a, b) => grammarRank(a.token) - grammarRank(b.token) || a.index - b.index)
    .map(({ token }) => ({ ...token, id: undefined }))

  const firstPlayableIndex = ordered.findIndex((token) => [
    SIGN_TOKEN_TYPES.SIGN,
    SIGN_TOKEN_TYPES.PHRASE,
    SIGN_TOKEN_TYPES.TEMPORAL,
    SIGN_TOKEN_TYPES.PRONOUN,
  ].includes(token.type))

  if (firstPlayableIndex >= 0 && context?.facial) {
    // createSignPlan asignará IDs estables t1...; tras el ordenamiento el
    // primer token reproducible será t1.
    ordered.push({
      type: SIGN_TOKEN_TYPES.FACIAL,
      sourceText,
      gloss: null,
      playToken: null,
      availability: SIGN_TOKEN_AVAILABILITY.MODIFIER,
      payload: {
        appliesTo: 't1',
        mode: context.facial.mode,
        channels: {
          brows: context.facial.brows,
          eyes: context.facial.eyes,
          head: context.facial.head,
        },
      },
    })
  }

  return createSignPlan({
    sourceText,
    source,
    intent: context?.intent || semanticPlan.intent,
    tokens: ordered,
    metadata: {
      ...semanticPlan.metadata,
      grammarPlanner: 'lsc-rule-v1',
      contextTurn: context?.turn || 0,
      topic: context?.topic || 'general',
      activeTime: context?.activeTime || null,
      spatialLoci: context?.spatialLoci || {},
      communityReviewRequired: true,
    },
  })
}

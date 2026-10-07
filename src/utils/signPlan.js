import { parsePlayToken } from './directionalVerbs.js'

/** Versión estable del contrato entre comprensión de español y avatar. */
export const SIGN_PLAN_VERSION = '1.0'

export const SIGN_TOKEN_TYPES = Object.freeze({
  SIGN: 'sign',
  PHRASE: 'phrase',
  TEMPORAL: 'temporal',
  PRONOUN: 'pronoun',
  DIRECTION: 'direction',
  FACIAL: 'facial',
})

export const SIGN_TOKEN_STATUSES = Object.freeze({
  PENDING: 'pending',
  COMMITTED: 'committed',
})

export const SIGN_TOKEN_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  MISSING: 'missing',
  MODIFIER: 'modifier',
})

/** Debe mantenerse alineado con las direcciones de vrmBaker.js. */
export const SIGN_DIRECTIONS = Object.freeze([
  'neutral',
  'self',
  'listener',
  'third',
  'group_self',
  'group_third',
  'fan_out',
  'third_self',
  'third_group_self',
  'plead',
])

export const TEMPORAL_KINDS = Object.freeze([
  'day',
  'day_period',
  'date',
  'time',
  'duration',
  'frequency',
  'relative',
])

export const PRONOUN_PERSONS = Object.freeze([1, 2, 3])
export const PRONOUN_NUMBERS = Object.freeze(['singular', 'plural'])

export const FACIAL_CHANNELS = Object.freeze([
  'brows',
  'eyes',
  'mouth',
  'cheeks',
  'head',
])

const PLAYABLE_TYPES = new Set([
  SIGN_TOKEN_TYPES.SIGN,
  SIGN_TOKEN_TYPES.PHRASE,
  SIGN_TOKEN_TYPES.TEMPORAL,
  SIGN_TOKEN_TYPES.PRONOUN,
])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite01(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function normalizeGloss(value) {
  return String(value || '').trim().toUpperCase().normalize('NFC')
}

function normalizeSpan(span) {
  if (!span) return null
  return { start: Number(span.start), end: Number(span.end) }
}

/**
 * Construye un plan inmutable en su forma pública. La validación semántica
 * completa queda en validateSignPlan para poder reportar todos los errores.
 */
export function createSignPlan({
  sourceText,
  tokens = [],
  intent = 'unknown',
  source = 'text',
  locale = 'es-CO',
  planId = `plan-${Date.now()}`,
  metadata = {},
} = {}) {
  const normalizedTokens = tokens.map((token, index) => ({
    id: token.id || `t${index + 1}`,
    type: token.type,
    sourceText: String(token.sourceText || ''),
    sourceSpan: normalizeSpan(token.sourceSpan),
    gloss: token.gloss ? normalizeGloss(token.gloss) : null,
    playToken: token.playToken ? String(token.playToken).trim() : null,
    availability: token.availability || (
      [SIGN_TOKEN_TYPES.DIRECTION, SIGN_TOKEN_TYPES.FACIAL].includes(token.type)
        ? SIGN_TOKEN_AVAILABILITY.MODIFIER
        : token.playToken
          ? SIGN_TOKEN_AVAILABILITY.AVAILABLE
          : SIGN_TOKEN_AVAILABILITY.MISSING
    ),
    status: token.status || SIGN_TOKEN_STATUSES.COMMITTED,
    confidence: token.confidence ?? 1,
    payload: isObject(token.payload) ? { ...token.payload } : {},
  }))

  const plan = {
    schemaVersion: SIGN_PLAN_VERSION,
    planId,
    source: {
      kind: source,
      locale,
      text: String(sourceText || ''),
    },
    intent,
    tokens: normalizedTokens,
    metadata: { ...metadata },
  }

  assertValidSignPlan(plan)
  return plan
}

/**
 * Puente de compatibilidad del Día 1: convierte la salida actual de strings
 * en SignPlan v1. La lógica semántica posterior reemplazará gradualmente esta
 * inferencia; el avatar continúa recibiendo exactamente los mismos strings.
 */
export function legacyPlayTokensToSignPlan(sourceText, playTokens, options = {}) {
  const tokens = (playTokens || []).map((playToken) => {
    const { citationToken, direction } = parsePlayToken(String(playToken))
    const type = citationToken.includes('_')
      ? SIGN_TOKEN_TYPES.PHRASE
      : SIGN_TOKEN_TYPES.SIGN
    return {
      type,
      gloss: citationToken,
      playToken,
      availability: SIGN_TOKEN_AVAILABILITY.AVAILABLE,
      payload: direction === 'neutral' ? {} : { direction },
    }
  })
  return createSignPlan({ sourceText, tokens, ...options })
}

/**
 * Compila el plan semántico al contrato existente de AvatarSignerVRM.
 * Los modificadores direction/facial no se reproducen como clips aislados:
 * afectan una seña mediante payload/appliesTo y serán consumidos por el baker.
 */
export function compileSignPlanToPlayTokens(plan, { includePending = false } = {}) {
  assertValidSignPlan(plan)
  return plan.tokens
    .filter((token) => PLAYABLE_TYPES.has(token.type))
    .filter((token) => token.availability === SIGN_TOKEN_AVAILABILITY.AVAILABLE)
    .filter((token) => includePending || token.status === SIGN_TOKEN_STATUSES.COMMITTED)
    .map((token) => token.playToken)
    .filter(Boolean)
}

export function validateSignPlan(plan) {
  const errors = []
  if (!isObject(plan)) return { valid: false, errors: ['El plan debe ser un objeto.'] }
  if (plan.schemaVersion !== SIGN_PLAN_VERSION) {
    errors.push(`schemaVersion debe ser ${SIGN_PLAN_VERSION}.`)
  }
  if (!String(plan.planId || '').trim()) errors.push('planId es obligatorio.')
  if (!isObject(plan.source)) errors.push('source es obligatorio.')
  else {
    if (!['text', 'voice', 'camera'].includes(plan.source.kind)) {
      errors.push('source.kind debe ser text, voice o camera.')
    }
    if (typeof plan.source.text !== 'string') errors.push('source.text debe ser string.')
    if (!String(plan.source.locale || '').trim()) errors.push('source.locale es obligatorio.')
  }
  if (!Array.isArray(plan.tokens)) errors.push('tokens debe ser un arreglo.')
  else {
    const ids = new Set()
    plan.tokens.forEach((token, index) => validateToken(token, index, ids, errors))
    plan.tokens.forEach((token, index) => {
      if (![SIGN_TOKEN_TYPES.DIRECTION, SIGN_TOKEN_TYPES.FACIAL].includes(token?.type)) return
      const target = token?.payload?.appliesTo
      if (target && !ids.has(target)) {
        errors.push(`tokens[${index}].payload.appliesTo referencia un token inexistente: ${target}.`)
      }
    })
  }
  return { valid: errors.length === 0, errors }
}

function validateToken(token, index, ids, errors) {
  const prefix = `tokens[${index}]`
  if (!isObject(token)) {
    errors.push(`${prefix} debe ser un objeto.`)
    return
  }
  if (!String(token.id || '').trim()) errors.push(`${prefix}.id es obligatorio.`)
  else if (ids.has(token.id)) errors.push(`${prefix}.id está duplicado: ${token.id}.`)
  else ids.add(token.id)

  if (!Object.values(SIGN_TOKEN_TYPES).includes(token.type)) {
    errors.push(`${prefix}.type no es válido.`)
    return
  }
  if (!Object.values(SIGN_TOKEN_STATUSES).includes(token.status)) {
    errors.push(`${prefix}.status no es válido.`)
  }
  if (!Object.values(SIGN_TOKEN_AVAILABILITY).includes(token.availability)) {
    errors.push(`${prefix}.availability no es válida.`)
  }
  if (!finite01(token.confidence)) errors.push(`${prefix}.confidence debe estar entre 0 y 1.`)
  if (token.sourceSpan) {
    const { start, end } = token.sourceSpan
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      errors.push(`${prefix}.sourceSpan debe contener enteros 0 <= start <= end.`)
    }
  }

  if (PLAYABLE_TYPES.has(token.type)) {
    if (!token.gloss) errors.push(`${prefix}.gloss es obligatorio para ${token.type}.`)
    if (token.availability === SIGN_TOKEN_AVAILABILITY.AVAILABLE && !token.playToken) {
      errors.push(`${prefix}.playToken es obligatorio cuando availability=available.`)
    }
    if (token.availability === SIGN_TOKEN_AVAILABILITY.MISSING && token.playToken) {
      errors.push(`${prefix}.playToken debe ser null cuando availability=missing.`)
    }
  } else if (token.availability !== SIGN_TOKEN_AVAILABILITY.MODIFIER) {
    errors.push(`${prefix}.availability debe ser modifier para ${token.type}.`)
  }

  const payload = isObject(token.payload) ? token.payload : {}
  if (token.type === SIGN_TOKEN_TYPES.TEMPORAL) {
    if (!TEMPORAL_KINDS.includes(payload.kind)) {
      errors.push(`${prefix}.payload.kind temporal no es válido.`)
    }
    if (!String(payload.value || '').trim()) {
      errors.push(`${prefix}.payload.value es obligatorio para temporal.`)
    }
  }
  if (token.type === SIGN_TOKEN_TYPES.PRONOUN) {
    if (!PRONOUN_PERSONS.includes(payload.person)) {
      errors.push(`${prefix}.payload.person debe ser 1, 2 o 3.`)
    }
    if (!PRONOUN_NUMBERS.includes(payload.number)) {
      errors.push(`${prefix}.payload.number debe ser singular o plural.`)
    }
    if (typeof payload.implicit !== 'boolean') {
      errors.push(`${prefix}.payload.implicit debe ser boolean.`)
    }
  }
  if (token.type === SIGN_TOKEN_TYPES.DIRECTION) {
    if (!SIGN_DIRECTIONS.includes(payload.direction)) {
      errors.push(`${prefix}.payload.direction no es válida.`)
    }
    if (!String(payload.appliesTo || '').trim()) {
      errors.push(`${prefix}.payload.appliesTo es obligatorio para direction.`)
    }
  }
  if (token.type === SIGN_TOKEN_TYPES.FACIAL) {
    if (!String(payload.appliesTo || '').trim()) {
      errors.push(`${prefix}.payload.appliesTo es obligatorio para facial.`)
    }
    if (!isObject(payload.channels) || Object.keys(payload.channels).length === 0) {
      errors.push(`${prefix}.payload.channels debe contener al menos un canal.`)
    } else {
      for (const [channel, value] of Object.entries(payload.channels)) {
        if (!FACIAL_CHANNELS.includes(channel)) {
          errors.push(`${prefix}.payload.channels.${channel} no es un canal válido.`)
        }
        if (!finite01(value)) {
          errors.push(`${prefix}.payload.channels.${channel} debe estar entre 0 y 1.`)
        }
      }
    }
  }
}

export function assertValidSignPlan(plan) {
  const result = validateSignPlan(plan)
  if (!result.valid) {
    throw new TypeError(`SignPlan inválido:\n- ${result.errors.join('\n- ')}`)
  }
  return plan
}

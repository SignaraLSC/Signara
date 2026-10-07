import { normalizeForSearch, tokenize } from './textNormalizer.js'

const TIME_RULES = [
  { patterns: ['pasado mañana'], value: 'pasado_mañana', orientation: 'future' },
  { patterns: ['por la mañana', 'en la mañana'], value: 'mañana_periodo', orientation: 'future' },
  { patterns: ['por la tarde', 'en la tarde'], value: 'tarde', orientation: 'future' },
  { patterns: ['por la noche', 'en la noche'], value: 'noche', orientation: 'future' },
  { patterns: ['mañana'], value: 'mañana_día', orientation: 'future' },
  { patterns: ['ayer'], value: 'ayer', orientation: 'past' },
  { patterns: ['hoy'], value: 'hoy', orientation: 'present' },
  { patterns: ['ahora'], value: 'ahora', orientation: 'present' },
]

const TOPICS = [
  { topic: 'educación', words: ['clase', 'profesor', 'estudiante', 'tarea', 'examen', 'universidad', 'colegio'] },
  { topic: 'salud', words: ['dolor', 'medico', 'médico', 'hospital', 'sed', 'enfermo', 'ayuda'] },
  { topic: 'familia', words: ['mama', 'mamá', 'papa', 'papá', 'hermano', 'hermana', 'familia'] },
]

const PRONOUNS = {
  yo: { person: 1, number: 'singular', role: 'self' },
  me: { person: 1, number: 'singular', role: 'self' },
  nosotros: { person: 1, number: 'plural', role: 'group_self' },
  nosotras: { person: 1, number: 'plural', role: 'group_self' },
  nos: { person: 1, number: 'plural', role: 'group_self' },
  tu: { person: 2, number: 'singular', role: 'listener' },
  tú: { person: 2, number: 'singular', role: 'listener' },
  te: { person: 2, number: 'singular', role: 'listener' },
  usted: { person: 2, number: 'singular', role: 'listener' },
  ustedes: { person: 2, number: 'plural', role: 'group_listener' },
  el: { person: 3, number: 'singular', role: 'third' },
  él: { person: 3, number: 'singular', role: 'third' },
  ella: { person: 3, number: 'singular', role: 'third' },
  ellos: { person: 3, number: 'plural', role: 'group_third' },
  ellas: { person: 3, number: 'plural', role: 'group_third' },
}

export function createConversationContext() {
  return {
    turn: 0,
    topic: 'general',
    activeTime: null,
    intent: 'statement',
    people: [],
    spatialLoci: {},
    facial: { mode: 'neutral', brows: 0.5, eyes: 0.5, head: 0.5 },
    lastText: '',
  }
}

function detectIntent(raw, normalizedWords) {
  const first = normalizedWords[0] || ''
  const questionWords = new Set(['que', 'qué', 'quien', 'quién', 'como', 'cómo', 'cuando', 'cuándo', 'donde', 'dónde', 'por'])
  if (raw.includes('?') || questionWords.has(first)) return 'question'
  const joined = normalizedWords.join(' ')
  if (
    normalizedWords.some((word) => ['ayudame', 'ayúdame', 'necesito', 'puedes'].includes(word)) ||
    joined.includes('por favor')
  ) return 'request'
  if (normalizedWords.some((word) => ['no', 'nunca', 'tampoco'].includes(word))) return 'negation'
  return 'statement'
}

function facialForIntent(intent) {
  if (intent === 'question') return { mode: 'question', brows: 0.85, eyes: 0.75, head: 0.65 }
  if (intent === 'request') return { mode: 'request', brows: 0.7, eyes: 0.7, head: 0.62 }
  if (intent === 'negation') return { mode: 'negation', brows: 0.65, eyes: 0.55, head: 0.72 }
  return { mode: 'neutral', brows: 0.5, eyes: 0.5, head: 0.5 }
}

/**
 * Memoria discursiva v1. No pretende reemplazar un parser lingüístico: deja
 * explícitos tema, tiempo, participantes, loci e intención para que SignPlan
 * y el futuro planificador LSC no dependan de palabras sueltas.
 */
export function analyzeConversationTurn(text, previous = createConversationContext()) {
  const raw = String(text || '').trim()
  const normalized = normalizeForSearch(raw)
  const words = tokenize(normalized)
  const joined = words.join(' ')
  const next = {
    ...previous,
    turn: previous.turn + 1,
    lastText: raw,
    people: [...(previous.people || [])],
    spatialLoci: { ...(previous.spatialLoci || {}) },
  }

  for (const rule of TIME_RULES) {
    if (rule.patterns.some((pattern) => joined.includes(normalizeForSearch(pattern)))) {
      next.activeTime = { value: rule.value, orientation: rule.orientation, turn: next.turn }
      break
    }
  }

  for (const rule of TOPICS) {
    if (rule.words.some((word) => words.includes(normalizeForSearch(word)))) {
      next.topic = rule.topic
      break
    }
  }

  for (const word of words) {
    const pronoun = PRONOUNS[word]
    if (!pronoun) continue
    const key = `${pronoun.person}-${pronoun.number}-${pronoun.role}`
    if (!next.people.some((person) => person.key === key)) {
      next.people.push({ key, source: word, ...pronoun })
    }
    if (!next.spatialLoci[key]) next.spatialLoci[key] = pronoun.role
  }

  next.intent = detectIntent(raw, words)
  next.facial = facialForIntent(next.intent)
  return next
}

export function summarizeConversationContext(context) {
  const parts = [context.topic]
  if (context.activeTime?.value) parts.push(context.activeTime.value.replace('_', ' '))
  if (context.intent !== 'statement') parts.push(context.intent)
  if (context.people?.length) parts.push(`${context.people.length} referente${context.people.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

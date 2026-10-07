import { SIGN_TOKEN_TYPES } from '../utils/signPlan.js'

export const SEMANTIC_CATALOG_VERSION = '2026.08.30-v1'

const documentedTemporal = {
  evidence: 'Naranjo-Orozco-Dieck-2022',
  reviewStatus: 'documented-lsc-time-category',
}

const needsReview = {
  reviewStatus: 'needs-lsc-community-review',
}

/**
 * Catálogo inicial de dominio educativo. Los patrones describen significado
 * del ESPAÑOL; no inventan cómo se ejecuta una seña. `reviewStatus` separa lo
 * lingüísticamente documentado de lo que debe validar la comunidad sorda.
 */
export const EDUCATIONAL_SEMANTIC_CATALOG = Object.freeze([
  // Tiempo: longest-match debe resolver estas antes que MAÑANA aislado.
  {
    id: 'time.day_after_tomorrow',
    domain: 'education',
    patterns: ['pasado mañana'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'PASADO_MAÑANA',
    payload: { kind: 'day', value: 'day_after_tomorrow', orientation: 'future' },
    ...documentedTemporal,
  },
  {
    id: 'time.morning_period',
    domain: 'education',
    patterns: ['por la mañana', 'en la mañana', 'durante la mañana'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'POR_LA_MAÑANA',
    payload: { kind: 'day_period', value: 'morning', orientation: 'contextual' },
    ...documentedTemporal,
  },
  {
    id: 'time.afternoon_period',
    domain: 'education',
    patterns: ['por la tarde', 'en la tarde', 'durante la tarde'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'POR_LA_TARDE',
    payload: { kind: 'day_period', value: 'afternoon', orientation: 'contextual' },
    ...documentedTemporal,
  },
  {
    id: 'time.night_period',
    domain: 'education',
    patterns: ['por la noche', 'en la noche', 'durante la noche'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'POR_LA_NOCHE',
    payload: { kind: 'day_period', value: 'night', orientation: 'contextual' },
    ...documentedTemporal,
  },
  {
    id: 'time.tomorrow_day',
    domain: 'education',
    patterns: ['mañana'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'MAÑANA',
    payload: { kind: 'day', value: 'tomorrow', orientation: 'future' },
    ...documentedTemporal,
  },
  {
    id: 'time.today',
    domain: 'education',
    patterns: ['hoy'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'HOY',
    payload: { kind: 'day', value: 'today', orientation: 'present' },
    ...documentedTemporal,
  },
  {
    id: 'time.yesterday',
    domain: 'education',
    patterns: ['ayer'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'AYER',
    payload: { kind: 'day', value: 'yesterday', orientation: 'past' },
    ...documentedTemporal,
  },
  {
    id: 'time.now',
    domain: 'education',
    patterns: ['ahora', 'en este momento'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'AHORA',
    payload: { kind: 'relative', value: 'now', orientation: 'present' },
    ...documentedTemporal,
  },
  {
    id: 'time.later',
    domain: 'education',
    patterns: ['mas tarde', 'más tarde'],
    type: SIGN_TOKEN_TYPES.TEMPORAL,
    gloss: 'MAS_TARDE',
    payload: { kind: 'relative', value: 'later', orientation: 'future' },
    ...documentedTemporal,
  },

  // Frases y actos comunicativos ya presentes o prioritarios.
  {
    id: 'courtesy.please',
    domain: 'education',
    patterns: ['por favor'],
    type: SIGN_TOKEN_TYPES.PHRASE,
    gloss: 'POR_FAVOR',
    payload: { speechAct: 'courtesy' },
    reviewStatus: 'recorded',
  },
  {
    id: 'greeting.how_are_you',
    domain: 'general',
    patterns: ['como estas', 'cómo estás'],
    type: SIGN_TOKEN_TYPES.PHRASE,
    gloss: 'COMO_ESTAS',
    payload: { speechAct: 'greeting-question' },
    reviewStatus: 'recorded',
  },
  {
    id: 'health.thirsty',
    domain: 'health',
    patterns: ['tengo sed'],
    type: SIGN_TOKEN_TYPES.PHRASE,
    gloss: 'TENGO_SED',
    payload: { speechAct: 'state' },
    reviewStatus: 'recorded',
  },
  {
    id: 'request.help_self',
    domain: 'education',
    patterns: [
      'necesito ayuda',
      'puedes ayudarme',
      'me puedes ayudar',
      'ayudame',
      'ayúdame',
    ],
    type: SIGN_TOKEN_TYPES.PHRASE,
    gloss: 'AYUDA',
    playToken: 'AYUDA::self',
    payload: { speechAct: 'request', direction: 'self' },
    reviewStatus: 'implemented-directional-geometry',
  },

  // Vocabulario educativo inicial. Son significados candidatos y backlog de
  // grabación; la forma exacta/variante LSC debe validarse antes de promoverse.
  ...[
    ['people.teacher', ['profesor', 'profesora', 'docente'], 'PROFESOR'],
    ['people.student', ['estudiante', 'alumno', 'alumna'], 'ESTUDIANTE'],
    ['place.school', ['escuela', 'colegio'], 'ESCUELA'],
    ['place.university', ['universidad'], 'UNIVERSIDAD'],
    ['education.class', ['clase', 'la clase', 'una clase'], 'CLASE'],
    ['education.homework', ['tarea', 'la tarea'], 'TAREA'],
    ['education.exam', ['examen', 'el examen'], 'EXAMEN'],
    ['education.question', ['pregunta', 'una pregunta'], 'PREGUNTA'],
    ['education.answer', ['respuesta', 'la respuesta'], 'RESPUESTA'],
    ['education.book', ['libro', 'el libro'], 'LIBRO'],
    ['education.notebook', ['cuaderno', 'el cuaderno'], 'CUADERNO'],
    ['education.read', ['leer', 'lee', 'leemos'], 'LEER'],
    ['education.write', ['escribir', 'escribe', 'escribimos'], 'ESCRIBIR'],
    ['education.learn', ['aprender', 'aprendo', 'aprendemos'], 'APRENDER'],
    ['education.teach', ['enseñar', 'enseña'], 'ENSEÑAR'],
    ['education.understand', ['entender', 'entiendo', 'comprender'], 'ENTENDER'],
    ['education.repeat', ['repetir', 'repite', 'repita'], 'REPETIR'],
    ['education.explain', ['explicar', 'explica', 'explique'], 'EXPLICAR'],
    ['subject.math', ['matematicas', 'matemáticas'], 'MATEMATICAS'],
    ['subject.science', ['ciencias', 'ciencia'], 'CIENCIAS'],
    ['subject.language', ['lengua castellana', 'español'], 'ESPAÑOL'],
    ['education.schedule', ['horario', 'el horario'], 'HORARIO'],
    ['education.break', ['recreo', 'descanso escolar'], 'RECREO'],
  ].map(([id, patterns, gloss]) => ({
    id,
    domain: 'education',
    patterns,
    type: SIGN_TOKEN_TYPES.SIGN,
    gloss,
    payload: { semanticClass: id.split('.')[0] },
    ...needsReview,
  })),
])

/**
 * Ambigüedades que el analizador de reglas (Días 4-5) debe resolver. No se
 * auto-resuelven todavía si falta una expresión explícita: documentarlas evita
 * esconder decisiones lingüísticas dentro de condicionales dispersos.
 */
export const EDUCATIONAL_AMBIGUITIES = Object.freeze([
  {
    lemma: 'mañana',
    senses: [
      { id: 'time.tomorrow_day', cues: ['mañana', 'pasado mañana'] },
      { id: 'time.morning_period', cues: ['por la mañana', 'en la mañana'] },
    ],
  },
  {
    lemma: 'nota',
    senses: [
      { id: 'grade', cues: ['nota del examen', 'nota final', 'calificacion'] },
      { id: 'written-note', cues: ['tomar nota', 'anotar', 'apunte'] },
    ],
    reviewStatus: 'needs-lsc-community-review',
  },
  {
    lemma: 'materia',
    senses: [
      { id: 'school-subject', cues: ['materia escolar', 'asignatura'] },
      { id: 'physical-material', cues: ['materia prima', 'material'] },
    ],
    reviewStatus: 'needs-lsc-community-review',
  },
  {
    lemma: 'grado',
    senses: [
      { id: 'school-grade', cues: ['grado escolar', 'curso escolar'] },
      { id: 'temperature-degree', cues: ['grados centigrados', 'temperatura'] },
      { id: 'angle-degree', cues: ['grados de angulo', 'ángulo'] },
    ],
    reviewStatus: 'needs-lsc-community-review',
  },
  {
    lemma: 'lengua',
    senses: [
      { id: 'language', cues: ['lengua de señas', 'lengua castellana'] },
      { id: 'organ', cues: ['sacar la lengua', 'dolor de lengua'] },
    ],
    reviewStatus: 'needs-lsc-community-review',
  },
])

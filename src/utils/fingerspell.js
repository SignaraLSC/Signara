/**
 * fingerspell.js — deletreo de nombres (palabras fuera del vocabulario).
 *
 * Si una palabra no tiene seña grabada y es solo letras (incl. ñ), se expande
 * a la secuencia de tokens de letra ['M','A','R','I','A'] para el avatar.
 * Requiere animations/<LETRA>.json en /animations.
 */

const LETTER_RE = /^[A-ZÑ]+$/i

/** Tokens de una sola letra del alfabeto (incl. Ñ). */
export function isLetterToken(token) {
  const t = String(token || '').toUpperCase()
  return t.length === 1 && LETTER_RE.test(t)
}

/**
 * Normaliza una palabra a letras mayúsculas deletreables.
 * á→A, ñ→Ñ. Devuelve [] si no es deletreable (dígitos, símbolos, < 2 letras).
 */
export function wordToLetters(word) {
  const raw = String(word || '')
    .normalize('NFD')
    .replace(/n\u0303/gi, 'Ñ') // ñ como letra propia antes de quitar marcas
    .replace(/Ñ/g, '\u0001')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, 'Ñ')
    .toUpperCase()
    .replace(/[^A-ZÑ]/g, '')
  if (raw.length < 2) return []
  return raw.split('')
}

/** ¿Se puede deletrear `word` con las animaciones disponibles? */
export function canFingerspell(word, available) {
  const letters = wordToLetters(word)
  if (!letters.length) return false
  const set = new Set(available || [])
  return letters.every((L) => set.has(L))
}

/**
 * Expande palabras a tokens de reproducción:
 * seña conocida → un token; OOV deletreable → secuencia de letras;
 * si faltan letras en available → se omite esa palabra.
 *
 * @param {string[]} words - ya uppercased / normalizadas (p.ej. tokenize)
 * @param {string[]} available - tokens de /animations
 * @returns {string[]}
 */
export function expandTokens(words, available) {
  if (!available?.length) return []
  const set = new Set(available)
  const out = []
  for (const w of words || []) {
    const key = String(w || '').toUpperCase().replace(/\s+/g, '_')
    if (!key) continue
    if (set.has(key)) {
      out.push(key)
      continue
    }
    // Una sola letra ya en vocabulario (A.json…)
    if (key.length === 1 && set.has(key)) {
      out.push(key)
      continue
    }
    const letters = wordToLetters(key)
    if (letters.length && letters.every((L) => set.has(L))) {
      out.push(...letters)
    }
    // else: omitir (sin inventar)
  }
  return out
}

/**
 * Para match en vivo (sufijo): si la última palabra es seña o deletreo completo,
 * devuelve { tokens, consumed }.
 */
export function tryFingerspellSuffix(words, available) {
  if (!words?.length || !available?.length) return null
  const last = words[words.length - 1]
  const key = String(last || '').toUpperCase().replace(/\s+/g, '_')
  if (!key) return null
  if (available.includes(key)) {
    return { tokens: [key], consumed: 1 }
  }
  const letters = wordToLetters(key)
  if (!letters.length) return null
  const set = new Set(available)
  if (!letters.every((L) => set.has(L))) return null
  return { tokens: letters, consumed: 1 }
}

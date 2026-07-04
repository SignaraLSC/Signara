/**
 * textNormalizer.js
 *
 * Normalización de texto hablado/escrito para mapeo a señas.
 *
 * Problemas que resuelve:
 *   "holaaaa"   → "hola"      (caracteres repetidos por énfasis)
 *   "Hóla"      → "hola"      (acentos y mayúsculas)
 *   "porfavor"  → "por_favor" (compuestos sin espacio)
 *   "graacias"  ≈ "gracias"   (fuzzy matching por distancia)
 *   "cómo estás?" → "como estas" (puntuación)
 */

// ─── Utilidades básicas ───────────────────────────────────────────────────────

/**
 * Reduce 3+ caracteres consecutivos iguales a 1.
 * "holaaaa" → "hola"   "graacias" → "gracias"
 * Preserva "ll", "rr", "cc" (solo 2 seguidos, no 3+).
 */
export function deduplicateChars(text) {
  return String(text).replace(/([a-záéíóúüñ])\1{2,}/gi, '$1')
}

/**
 * Normalización completa para comparación:
 * minúsculas → sin acentos → sin puntuación → deduplicar → trim
 */
export function normalizeForSearch(text) {
  return deduplicateChars(
    String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // quitar acentos
      .replace(/[¿¡.,!?;:()-]/g, ' ')  // puntuación → espacio
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Tokeniza texto en palabras normalizadas.
 * "¡Hola, cómo estás!" → ["hola", "como", "estas"]
 */
export function tokenize(text) {
  return normalizeForSearch(text).split(' ').filter(w => w.length > 0)
}

// ─── Levenshtein ─────────────────────────────────────────────────────────────

/** Distancia de edición entre dos strings (Levenshtein). */
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  // Usar solo dos filas para ahorrar memoria
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

/**
 * Encuentra la seña más cercana a una palabra usando distancia de Levenshtein.
 *
 * @param {string}   word       - Palabra ya normalizada (sin acentos, minúscula)
 * @param {string[]} signKeys   - Claves canónicas ["HOLA", "POR_FAVOR", ...]
 * @param {number}   [maxDist]  - Distancia máxima permitida (auto si no se pasa)
 * @returns {{ key: string, dist: number } | null}
 */
export function fuzzyMatchSign(word, signKeys, maxDist) {
  if (!word || !signKeys?.length) return null

  // Umbral automático: 30% de la longitud, mínimo 1, máximo 4
  const threshold = maxDist ?? Math.min(4, Math.max(1, Math.floor(word.length * 0.3)))

  let best = null, bestDist = Infinity

  for (const key of signKeys) {
    // "POR_FAVOR" → "por favor" para comparar con el texto hablado
    const candidate = key.toLowerCase().replace(/_/g, ' ')
    const dist = levenshtein(word, candidate)
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist
      best = { key, dist }
    }
  }

  return best
}

// ─── Resolución de tokens ─────────────────────────────────────────────────────

/**
 * Convierte un array de palabras normalizadas en tokens de señas.
 *
 * Estrategia (por orden de prioridad):
 *  1. Match exacto de frase compuesta (hasta 3 palabras): ["por","favor"] → "POR_FAVOR"
 *  2. Match exacto de 1 palabra: "hola" → "HOLA"
 *  3. Fuzzy match de frase corta (1-2 palabras): "graacias" ≈ "GRACIAS"
 *  4. Sin match → token null (palabra desconocida)
 *
 * @param {string[]} words     - Palabras normalizadas
 * @param {string[]} signKeys  - Claves canónicas disponibles
 * @returns {{ token: string|null, input: string, match: string }[]}
 */
export function resolveSignTokens(words, signKeys) {
  const results = []
  let i = 0

  while (i < words.length) {
    let matched = false

    // Probar frases de 3, 2 y 1 palabra (longest match first)
    for (let len = Math.min(3, words.length - i); len >= 1; len--) {
      const phrase = words.slice(i, i + len).join(' ')

      // 1. Match exacto
      const exactKey = phrase.toUpperCase().replace(/ /g, '_')
      if (signKeys.includes(exactKey)) {
        results.push({ token: exactKey, input: phrase, match: 'exact' })
        i += len
        matched = true
        break
      }

      // 2. Fuzzy (solo para frases de ≤2 palabras para evitar falsos positivos)
      if (len <= 2) {
        const fuzzy = fuzzyMatchSign(phrase, signKeys)
        if (fuzzy) {
          results.push({ token: fuzzy.key, input: phrase, match: 'fuzzy', dist: fuzzy.dist })
          i += len
          matched = true
          break
        }
      }
    }

    if (!matched) {
      results.push({ token: null, input: words[i], match: 'none' })
      i++
    }
  }

  return results
}

/**
 * Wrapper de alto nivel: texto libre → array de sign tokens.
 * Retorna solo los tokens que tienen match (filtra los null).
 *
 * @param {string}   text      - Texto del usuario (hablado o escrito)
 * @param {string[]} signKeys  - Claves canónicas disponibles
 * @returns {string[]}         - ["HOLA", "POR_FAVOR", ...]
 */
export function textToSignTokens(text, signKeys) {
  const words = tokenize(text)
  const resolved = resolveSignTokens(words, signKeys)
  return resolved.filter(r => r.token !== null).map(r => r.token)
}

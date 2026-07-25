/**
 * Cliente del proxy /api/translate.
 * - Seña → ES → idioma (Interpretar)
 * - Idioma → ES → señas (Traducir)
 */

const cache = new Map()
const CACHE_VER = 4

async function callTranslate(q, source, target) {
  const key = `v${CACHE_VER}::${source}::${target}::${q.toLowerCase()}`
  if (cache.has(key)) return cache.get(key)

  const resp = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, target, source }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `Traducción HTTP ${resp.status}`)
  }
  const data = await resp.json()
  const translated = String(data.translated || q).trim() || q
  cache.set(key, translated)
  return translated
}

export async function translateFromSpanish(text, targetLang) {
  const q = String(text || '').trim()
  if (!q) return ''
  if (!targetLang || targetLang === 'es') return q
  return callTranslate(q, 'es', targetLang)
}

/** Cualquier idioma → español (para mapear a tokens de seña). */
export async function translateToSpanish(text, sourceLang) {
  const q = String(text || '').trim()
  if (!q) return ''
  if (!sourceLang || sourceLang === 'es') return q
  return callTranslate(q, sourceLang, 'es')
}

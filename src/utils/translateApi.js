/**
 * Cliente del proxy /api/translate.
 * Seña → español (modelo) → idioma elegido.
 * El servidor usa glosario Signara → Google → MyMemory.
 */

const cache = new Map()
const CACHE_VER = 2

export async function translateFromSpanish(text, targetLang) {
  const q = String(text || '').trim()
  if (!q) return ''
  if (!targetLang || targetLang === 'es') return q

  const key = `v${CACHE_VER}::${targetLang}::${q.toLowerCase()}`
  if (cache.has(key)) return cache.get(key)

  const resp = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, target: targetLang, source: 'es' }),
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

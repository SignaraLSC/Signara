/**
 * Proveedores de traducción para /api/translate.
 * Orden: glosario Signara → Google (si hay clave) → MyMemory (filtrado).
 */

import { glossaryTranslate, isJunkTranslation } from './signGlossary.js'

const GOOGLE_URL = 'https://translation.googleapis.com/language/translate/v2'
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function translateGoogle(q, source, target, apiKey) {
  const upstream = await fetch(`${GOOGLE_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, source, target, format: 'text' }),
  })
  const data = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    const msg = data?.error?.message || `Google Translate HTTP ${upstream.status}`
    const err = new Error(msg)
    err.status = upstream.status
    throw err
  }
  return data?.data?.translations?.[0]?.translatedText || q
}

function pickMyMemoryText(data, q) {
  const matches = Array.isArray(data?.matches) ? data.matches : []
  const ranked = matches
    .filter((m) => m?.translation && !isJunkTranslation(q, m.translation))
    .sort((a, b) => {
      const qa = Number(a.quality) || 0
      const qb = Number(b.quality) || 0
      if (qb !== qa) return qb - qa
      return (Number(b.match) || 0) - (Number(a.match) || 0)
    })
  if (ranked[0]?.translation) return ranked[0].translation

  const fallback = data?.responseData?.translatedText
  if (fallback && !isJunkTranslation(q, fallback)) return fallback
  return null
}

async function translateMyMemory(q, source, target, { email, apiKey } = {}) {
  const params = new URLSearchParams({
    q,
    langpair: `${source}|${target}`,
    mt: '1',
  })
  if (email) params.set('de', email)
  if (apiKey) params.set('key', apiKey)

  const upstream = await fetch(`${MYMEMORY_URL}?${params}`)
  const data = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    const err = new Error(`MyMemory HTTP ${upstream.status}`)
    err.status = upstream.status
    throw err
  }
  const status = Number(data?.responseStatus || 0)
  if (status !== 200) {
    const err = new Error(data?.responseDetails || 'MyMemory no pudo traducir')
    err.status = status >= 400 ? status : 502
    throw err
  }
  const translated = pickMyMemoryText(data, q)
  if (!translated) {
    const err = new Error('MyMemory devolvió una traducción no usable')
    err.status = 502
    throw err
  }
  return decodeHtmlEntities(translated)
}

/**
 * @returns {{ translated: string, provider: 'glossary' | 'google' | 'mymemory' }}
 */
export async function translateWithFallback(q, source, target, env = {}) {
  const googleKey = env.googleKey || ''
  const myMemoryEmail = env.myMemoryEmail || ''
  const myMemoryKey = env.myMemoryKey || ''

  const fromGlossary = glossaryTranslate(q, target)
  if (fromGlossary) {
    return { translated: fromGlossary, provider: 'glossary' }
  }

  if (googleKey) {
    try {
      const translated = await translateGoogle(q, source, target, googleKey)
      if (!isJunkTranslation(q, translated)) {
        return { translated, provider: 'google' }
      }
    } catch (err) {
      console.warn('[translate] Google falló, usando MyMemory:', err?.message || err)
    }
  }

  const translated = await translateMyMemory(q, source, target, {
    email: myMemoryEmail,
    apiKey: myMemoryKey,
  })
  return { translated, provider: 'mymemory' }
}

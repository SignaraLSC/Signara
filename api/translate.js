// Proxy serverless → Google (opcional) o MyMemory (gratis, sin clave).
// Ruta: POST /api/translate  body: { q, target, source? }
//
// Variables de entorno (opcionales):
//   GOOGLE_TRANSLATE_API_KEY  — prioridad si existe
//   MYMEMORY_EMAIL            — email de contacto (sube el cupo diario)
//   MYMEMORY_API_KEY          — clave opcional de MyMemory

import { translateWithFallback } from './translateProviders.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  const q = String(body?.q || '').trim()
  const target = String(body?.target || '').trim()
  const source = String(body?.source || 'es').trim() || 'es'

  if (!q || !target) {
    return res.status(400).json({ error: 'Se requieren "q" y "target"' })
  }
  if (target === source) {
    return res.status(200).json({ translated: q, target, source, provider: 'none' })
  }

  try {
    const { translated, provider } = await translateWithFallback(q, source, target, {
      googleKey: process.env.GOOGLE_TRANSLATE_API_KEY || '',
      myMemoryEmail: process.env.MYMEMORY_EMAIL || '',
      myMemoryKey: process.env.MYMEMORY_API_KEY || '',
    })
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.status(200).json({ translated, target, source, provider })
  } catch (err) {
    console.error('[api/translate]', err)
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502
    return res.status(status).json({
      error: err?.message || 'No se pudo traducir',
    })
  }
}

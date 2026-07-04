import { SIGNED_LANG, SPOKEN_LANG } from './signLanguage.js'

const POSE_UPSTREAM =
  'https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_pose'

// Dev: proxy de Vite (vite.config.js) → sign.mt.
// Producción: función serverless de Vercel (api/pose.js) → sign.mt.
// En ambos casos la ruta pública es la misma: /api/pose.
const PROXY_PATHS = [(params) => `/api/pose?${params}`]

function isPoseResponse(response, blob) {
  const type = (response.headers.get('content-type') || blob.type || '').toLowerCase()
  return type.includes('application/pose')
}

/**
 * Descarga el archivo POSE y devuelve un blob: URL para pose-viewer.
 * Producción: función serverless de Vercel (api/pose.js). Dev: proxy de Vite.
 */
export async function fetchPoseBlobUrl(text, {
  spoken = SPOKEN_LANG,
  signed = SIGNED_LANG,
} = {}) {
  const trimmed = String(text).trim()
  if (!trimmed) return null

  const params = new URLSearchParams({ text: trimmed, spoken, signed })

  const load = async (url) => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    if (!blob.size) throw new Error('respuesta vacía')
    // Si el proxy devuelve HTML (p. ej. el index.html del SPA), no es una pose válida.
    if (!isPoseResponse(r, blob)) throw new Error('respuesta no es POSE')
    return URL.createObjectURL(blob)
  }

  let lastErr
  for (const buildUrl of PROXY_PATHS) {
    try {
      return await load(buildUrl(params))
    } catch (err) {
      lastErr = err
      console.warn('[pose]', buildUrl(params).split('?')[0], err?.message || err)
    }
  }

  throw lastErr || new Error('No se pudo cargar la animación 3D')
}

/** @deprecated Solo referencia; el navegador no puede llamar sign.mt directo (403). */
export function buildPoseApiUrl(text, opts = {}) {
  const spoken = opts.spoken ?? SPOKEN_LANG
  const signed = opts.signed ?? SIGNED_LANG
  return `${POSE_UPSTREAM}?${new URLSearchParams({ text: String(text).trim(), spoken, signed })}`
}

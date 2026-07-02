export const ML_API_URL =
  import.meta.env.VITE_ML_API_URL ||
  (import.meta.env.PROD
    ? 'https://signara.onrender.com'
    : 'http://localhost:8000')

const CACHE_TTL_MS = 5 * 60 * 1000

/** @type {{ ok: boolean, at: number } | null} */
let cached = null
/** @type {Promise<{ ok: boolean, at: number }> | null} */
let inflight = null

export function getMlApiCache() {
  return cached
}

export function checkMlApiHealth({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached)
  }
  if (!force && inflight) return inflight

  inflight = fetch(`${ML_API_URL}/health`)
    .then((r) => r.json())
    .then((data) => {
      cached = { ok: !!data.model_loaded, at: Date.now() }
      inflight = null
      return cached
    })
    .catch(() => {
      cached = { ok: false, at: Date.now() }
      inflight = null
      return cached
    })

  return inflight
}

/** Despierta la API en segundo plano (p. ej. desde el landing). */
export function warmupMlApi() {
  return checkMlApiHealth()
}

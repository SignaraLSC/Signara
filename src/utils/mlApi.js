const desktopOrOverlay = typeof window !== 'undefined' && (
  Boolean(window.__TAURI_INTERNALS__) ||
  new URLSearchParams(window.location.search).has('overlay')
)

export const ML_API_URL =
  import.meta.env.VITE_ML_API_URL ||
  (desktopOrOverlay
    ? 'http://127.0.0.1:8000'
    : import.meta.env.PROD
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

// Render free duerme la instancia tras inactividad: el primer health-check
// tras un cold start puede tardar bastante en responder. 20s es generoso para
// no marcar "caído" a un servidor que solo está despertando, pero sigue
// acotado (sin esto, un fetch roto podía quedarse colgado indefinidamente).
const HEALTH_TIMEOUT_MS = 20000

export function checkMlApiHealth({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached)
  }
  if (!force && inflight) return inflight

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)

  inflight = fetch(`${ML_API_URL}/health`, { signal: controller.signal })
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
    .finally(() => clearTimeout(timer))

  return inflight
}

/** Despierta la API en segundo plano (p. ej. desde el landing). */
export function warmupMlApi() {
  return checkMlApiHealth()
}

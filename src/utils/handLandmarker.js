/**
 * HandLandmarker compartido entre montajes de Interpretar.
 * Evita re-descargar WASM/modelo al salir y volver a la pantalla.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const TASKS_VISION_VER = '0.10.35'
const VISION_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VER}/wasm`
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

let sharedHandLandmarker = null
let sharedHandPromise = null
// Subir al cambiar umbrales/opciones (el singleton no se recrea solo).
const LANDMARKER_REV = 2
let sharedRev = 0

export function getSharedHandLandmarker() {
  if (sharedHandLandmarker && sharedRev === LANDMARKER_REV) {
    return Promise.resolve(sharedHandLandmarker)
  }
  if (sharedHandPromise && sharedRev === LANDMARKER_REV) return sharedHandPromise
  sharedHandLandmarker = null
  sharedRev = LANDMARKER_REV
  sharedHandPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL)
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      // Umbrales más bajos: la mano izq. (y far/edge) se perdía mucho a 0.5.
      minHandDetectionConfidence: 0.35,
      minTrackingConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
    })
    let hand
    try {
      hand = await HandLandmarker.createFromOptions(vision, opts('GPU'))
    } catch {
      hand = await HandLandmarker.createFromOptions(vision, opts('CPU'))
    }
    sharedHandLandmarker = hand
    return hand
  })()
  return sharedHandPromise
}

/** Precarga en segundo plano (p. ej. desde la selección de modo). */
export function warmupHandLandmarker() {
  return getSharedHandLandmarker().catch(() => null)
}

/**
 * Traduce texto español → animación 3D LSM (pose-viewer).
 */

import { fetchPoseBlobUrl } from './poseApi.js'

/**
 * @returns {Promise<{
 *   poseSrc: string | null,
 *   text: string,
 *   source: 'pose3d' | 'local'
 * }>}
 */
export async function translateText(text) {
  const trimmed = text.trim()
  if (!trimmed) {
    return { poseSrc: null, text: '', source: 'local' }
  }

  try {
    const poseSrc = await fetchPoseBlobUrl(trimmed)
    if (poseSrc) {
      return { poseSrc, text: trimmed, source: 'pose3d' }
    }
  } catch (err) {
    console.warn('[pose 3D]', err?.message || err)
    throw err
  }

  return { poseSrc: null, text: trimmed, source: 'local' }
}

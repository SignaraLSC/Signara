import { deduplicateChars } from './textNormalizer.js'

/**
 * signMap
 * Mapping of canonical sign tokens (uppercase, no accents) to a video clip URL.
 *
 * Videos live in per-avatar folders under /videos/. Each avatar has its own
 * set of clips (same filenames). The active avatar can be changed at runtime
 * with setCurrentAvatar(id) and getSignSrc() will resolve the video path
 * accordingly.
 *
 *   /videos/videos_avatar/...........  -> Alex      (default)
 *   /videos/videos_avatar_hombre/....  -> Anuar
 *   /videos/videos_avatar_mujer/.....  -> Grace
 *
 * If a sign is missing from SIGN_FILES, AvatarPlayer falls back to its
 * placeholder so the demo never breaks.
 */

export const AVATARS = [
  {
    id: 'alex',
    name: 'Alex',
    folder: '/videos/videos_avatar',
    image: '/avatars/avatar.png'
  },
  {
    id: 'anuar',
    name: 'Anuar',
    folder: '/videos/videos_avatar_hombre',
    image: '/avatars/avatar_hombre.png'
  },
  {
    id: 'grace',
    name: 'Grace',
    folder: '/videos/videos_avatar_mujer',
    image: '/avatars/avatar_mujer.png'
  }
]

// Filenames available for every avatar. New signs go here.
const SIGN_FILES = {
  HOLA: 'hola.mp4',
  COMO_ESTAS: 'como_estas.mp4',
  GRACIAS: 'gracias.mp4',
  POR_FAVOR: 'por_favor.mp4',
  TENGO_SED: 'tengo_sed.mp4',
  TE_AMO: 'te_amo.mp4',
  NECESITO_AYUDA: 'necesito_ayuda.mp4',
  SOMOS: 'somos.mp4',
  SIGNARA: 'signara.mp4',
}

let currentAvatarId = 'alex'

/** Returns the active avatar descriptor (id, name, folder, image). */
export function getCurrentAvatar() {
  return AVATARS.find((a) => a.id === currentAvatarId) || AVATARS[0]
}

/** Switch the active avatar by id. Unknown ids are ignored. */
export function setCurrentAvatar(id) {
  if (AVATARS.some((a) => a.id === id)) {
    currentAvatarId = id
  }
}

/**
 * normalizeSign
 * Convert a free-form word to the canonical sign key:
 *  - uppercase
 *  - strip accents
 *  - replace spaces with underscores
 */
export function normalizeSign(word) {
  return deduplicateChars(String(word))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '_')
    .trim()
}

/** Returns all canonical sign keys available in the current build. */
export function getAllSignKeys() {
  return Object.keys(SIGN_FILES)
}

/**
 * getSignSrc
 * Returns the video URL for a sign in the active avatar's folder, or null
 * if the sign isn't mapped (caller can fall back).
 */
export function getSignSrc(sign) {
  const key = normalizeSign(sign)
  const file = SIGN_FILES[key]
  if (!file) return null
  const avatar = getCurrentAvatar()
  return `${avatar.folder}/${file}`
}

/** Español (México / LATAM) como idioma hablado. */
export const SPOKEN_LANG = 'es'

/**
 * Etiqueta mostrada en la UI: LSC (Lengua de Señas Colombiana). El respaldo
 * de sign.mt usa internamente el código IANA "mfs" (mexicana) porque es el
 * único pose-viewer disponible para español cuando una palabra no tiene
 * animación propia grabada — no representa el idioma real de la app.
 */
export const SIGNED_LANG = import.meta.env.VITE_SIGNED_LANG || 'mfs'

export const SIGNED_LANG_LABEL = 'LSC'

/**
 * directionalVerbs.js — verbos direccionales de LSC (Fase 2 del roadmap, ver
 * CLAUDE.md → "Directional verbs (spatial agreement)"). La misma seña
 * grabada UNA vez en forma neutral/de cita ("AYUDA") se re-dirige en el
 * espacio 3D según la forma conjugada del texto ("ayúdame", "te ayudo"...)
 * en vez de grabar una toma por cada combinación.
 *
 * NOTA sobre el nombre de la toma grabada: se guarda como "AYUDA" (sustantivo/
 * orden), no "AYUDAR" (infinitivo) — "ayudar" solo se lee raro en telegráfico
 * ("Ayudar" suena a título, no a pedido), mientras que "ayuda" ya funciona
 * solo, igual que TENGO_SED/NECESITO_AYUDA. Escribir "ayudar" en Traducir
 * también resuelve a la misma toma (ver forms.AYUDAR más abajo), por si a
 * alguien se le escapa el infinitivo.
 *
 * IMPORTANTE — esto es una tabla de FORMAS CONJUGADAS de un verbo, NO de
 * sinónimos: "necesito ayuda" no entra acá aunque se sienta parecido en
 * español — es una seña propia y distinta, ya grabada (NECESITO_AYUDA).
 * Solo formas reales del verbo direccional van en `forms`. Confirmar
 * cualquier verbo/forma nueva con la referencia de LSC antes de sumarla acá
 * — esta tabla codifica una decisión lingüística, no una adivinanza.
 *
 * `direction` es leído por vrmBaker.js (bakeSolver) para redirigir el punto
 * objetivo de la muñeca — ver DIRECTION_KINDS ahí. 'neutral' no aplica
 * ninguna redirección (se reproduce la toma tal cual se grabó).
 */

export const DIRECTIONAL_VERBS = {
  AYUDA: {
    citationToken: 'AYUDA',
    forms: {
      AYUDA: 'neutral',
      AYUDAR: 'neutral', // por si alguien escribe el infinitivo
      AYUDAME: 'self',
      TE_AYUDO: 'listener',
      // 'third' (AYUDALO…): bake de manos = AYUDA + yaw spine/chest al play.
      AYUDALO: 'third',
      AYUDALA: 'third',
      AYUDALOS: 'third',
      AYUDALAS: 'third',
      // 'group_self': barrido lateral frente al pecho (de un lado de pantalla
      // al otro), NO un punto fijo — ver DIRECTION_TARGETS.group_self en
      // vrmBaker.js.
      AYUDANOS: 'group_self',
    },
  },
}

// token "compuesto" que viaja por el resto del pipeline (queue/replace del
// avatar, caché de bake) como un solo string — 'AYUDAR' para la forma
// neutral (se comporta exactamente igual que antes de existir esto), o
// 'AYUDAR::self' etc. para las formas direccionales.
function playTokenFor(citationToken, direction) {
  return direction === 'neutral' ? citationToken : `${citationToken}::${direction}`
}

/**
 * Igual estrategia que matchSignTokens/tryMatchSuffix (ventanas de hasta 3
 * palabras, `available` = tokens con animación grabada): para una ventana de
 * palabras dada, ¿es una forma conjugada conocida de un verbo direccional
 * cuya toma base SÍ está grabada? Devuelve el playToken compuesto o null —
 * se llama ANTES del match literal, así una forma conjugada nunca compite
 * con un token literal igual de largo.
 */
export function resolveDirectionalForm(candWords, available) {
  const cand = candWords.join('_')
  for (const verb of Object.values(DIRECTIONAL_VERBS)) {
    if (!available.includes(verb.citationToken)) continue
    const direction = verb.forms[cand]
    if (direction) return playTokenFor(verb.citationToken, direction)
  }
  return null
}

// 'AYUDAR::self' -> { citationToken: 'AYUDAR', direction: 'self' }.
// 'AYUDAR' (sin '::') -> { citationToken: 'AYUDAR', direction: 'neutral' }.
export function parsePlayToken(playToken) {
  const i = playToken.indexOf('::')
  if (i === -1) return { citationToken: playToken, direction: 'neutral' }
  return { citationToken: playToken.slice(0, i), direction: playToken.slice(i + 2) }
}

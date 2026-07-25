/**
 * directionalVerbs.js — verbos concordantes / direccionales de LSC (Fase 2).
 * La misma seña grabada UNA vez en forma neutral/de cita se re-dirige en el
 * espacio 3D según origen→destino (quién actúa / quién recibe), en vez de
 * grabar una toma por cada combinación.
 *
 * Categoría gramatical (LSC): modifican punto de origen y final en el espacio.
 *
 * En NUESTRO vocabulario actual:
 *   · Direccionales puros (cableados aquí): AYUDA, PERDON
 *   · Concordancia sutil (cableada): TE_AMO — mirada, inclinación de torso
 *     y proyección suave de la seña hacia la persona objetivo (bake)
 *   · Fijos / invariables (NO van aquí): HOLA, ADIOS, GRACIAS, POR_FAVOR,
 *     BIEN, MAL, SI, NO, FAMILIA, CABEZA, OJOS, TENGO_SED, COMO_ESTAS,
 *     SCOOBA, IDLE — usan indexación o tiempo aparte, no conjugación espacial
 *
 * Direccionales puros comunes en LSC pero SIN toma en el set aún (no inventar
 * forms hasta grabar la seña base): ENSEÑAR, PREGUNTAR, EXPLICAR/INFORMAR,
 * AVISAR, ACONSEJAR, ENVIAR/MANDAR. Concordancia sutil también: COPIAR,
 * DETESTAR/ODIAR.
 *
 * NOTA — toma "AYUDA" (no "AYUDAR"): "ayuda" funciona solo en telegráfico;
 * escribir "ayudar" también resuelve (forms.AYUDAR). "necesito ayuda" NO es
 * conjugación de AYUDA — es seña propia (si existiera NECESITO_AYUDA).
 *
 * Solo formas reales del verbo concordante van en `forms`. Confirmar con
 * referencia LSC antes de sumar — decisión lingüística, no adivinanza.
 *
 * Fases 2 / 2B / 3: ver CLAUDE.md → "Directional verbs (spatial agreement)".
 * Espejo cámara: sign_ai/core/directional_verbs.py + direction_reader.py.
 *
 * `direction` lo lee vrmBaker.js (bakeSolver). 'neutral' = toma tal cual.
 */

export const DIRECTIONAL_VERBS = {
  // AYUDA — formas direccionales básicas (referencia LSC). Aprox. en bake:
  // no hay número fijo en la práctica (ubicación real / uno-por-uno = Fase 3).
  // · Ayúdame (tú→mí): oyente → pecho → 'self' (toma al revés)
  // · Ayúdalo/la (tú→3º): oyente → punto lateral → 'third'
  // · Ayúdanos (tú→nosotros): frente → pecho + semicírculo → 'group_self'
  // · Ayúdalos/las (tú→ellos): frente → semicírculo lateral → 'group_third'
  // · Yo los/las ayudo (yo→ellos): pecho → abanico al frente/lado → 'fan_out'
  // · Yo te ayudo (yo→tú): pecho → oyente → 'listener'
  // · Él/Ella me ayuda (3º→mí): lateral → pecho → 'third_self'
  // · Ellos/as nos ayudan (ellos→nosotros): semicírculo lateral → pecho/grupo
  //   → 'third_group_self'
  AYUDA: {
    citationToken: 'AYUDA',
    forms: {
      AYUDA: 'neutral',
      AYUDAR: 'neutral', // por si alguien escribe el infinitivo
      // Tú → mí
      AYUDAME: 'self',
      // Yo → tú
      TE_AYUDO: 'listener',
      YO_TE_AYUDO: 'listener',
      // Tú → un tercero
      AYUDALO: 'third',
      AYUDALA: 'third',
      YO_LO_AYUDO: 'third',
      YO_LA_AYUDO: 'third',
      // Tú → ellos (semicírculo en zona lateral — distinto de ayúdalo)
      AYUDALOS: 'group_third',
      AYUDALAS: 'group_third',
      // Tú → nosotros
      AYUDANOS: 'group_self',
      // Yo → ellos (abanico desde el pecho)
      YO_LOS_AYUDO: 'fan_out',
      YO_LAS_AYUDO: 'fan_out',
      LOS_AYUDO: 'fan_out',
      LAS_AYUDO: 'fan_out',
      // Tercero → mí
      EL_ME_AYUDA: 'third_self',
      ELLA_ME_AYUDA: 'third_self',
      ME_AYUDA: 'third_self',
      // Ellos → nosotros
      ELLOS_NOS_AYUDAN: 'third_group_self',
      ELLAS_NOS_AYUDAN: 'third_group_self',
      NOS_AYUDAN: 'third_group_self',
    },
  },
  // PERDON — seña base + acuerdo espacial / postura (referencia LSC):
  // · Yo te perdono → base + indexar / extender hacia el interlocutor (listener)
  // · Tú me perdonas / pedir perdón → base + torso adelante + súplica (plead)
  // · Él/Ella me perdonó → espacio 3º + hacia el pecho (third_self)
  // · Nosotros nos perdonamos → base + barrido/espacio compartido (group_self)
  PERDON: {
    citationToken: 'PERDON',
    forms: {
      PERDON: 'neutral',
      PERDONAR: 'neutral',
      // Pedir perdón (tú me perdonas / perdóname)
      PERDONAME: 'plead',
      ME_PERDONAS: 'plead',
      TU_ME_PERDONAS: 'plead',
      // Yo te perdono
      TE_PERDONO: 'listener',
      YO_TE_PERDONO: 'listener',
      // Él/Ella me perdonó
      EL_ME_PERDONO: 'third_self',
      ELLA_ME_PERDONO: 'third_self',
      // Nosotros nos perdonamos / perdónanos (pidan perdón al grupo)
      NOS_PERDONAMOS: 'group_self',
      NOSOTROS_NOS_PERDONAMOS: 'group_self',
      PERDONAMOS: 'group_self',
      PERDONANOS: 'group_self',
    },
  },
  // TE_AMO — concordancia sutil (AMAR): no es un redirect duro como AYUDA;
  // el bake añade mirada + torso hacia el receptor y una proyección suave.
  // La toma grabada es la cita "te amo" (yo→tú).
  // · Te amo / yo te amo → proyección al oyente (listener)
  // · Me amas → hacia el pecho (self)
  // · Lo/la amo → espacio 3º (third)
  // · Me ama (él/ella) → 3º → pecho (third_self)
  // · Nos amamos → barrido compartido (group_self)
  TE_AMO: {
    citationToken: 'TE_AMO',
    forms: {
      TE_AMO: 'listener',
      YO_TE_AMO: 'listener',
      AMAR: 'listener',
      ME_AMAS: 'self',
      TU_ME_AMAS: 'self',
      LO_AMO: 'third',
      LA_AMO: 'third',
      YO_LO_AMO: 'third',
      YO_LA_AMO: 'third',
      ME_AMA: 'third_self',
      EL_ME_AMA: 'third_self',
      ELLA_ME_AMA: 'third_self',
      NOS_AMAMOS: 'group_self',
      NOSOTROS_NOS_AMAMOS: 'group_self',
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

# SignPlan v1 - representación intermedia de Signara

`SignPlan` es el contrato entre la comprensión del mensaje y la reproducción.
Evita que el traductor dependa de una lista plana de nombres de archivos y
permite agregar contexto sin romper `AvatarSignerVRM`.

## Flujo

```text
texto / voz / cámara
        ↓
comprensión semántica y gramática LSC
        ↓
SignPlan v1
        ↓
compileSignPlanToPlayTokens()
        ↓
AvatarSignerVRM (contrato actual de strings)
```

El JSON Schema formal está en `src/schemas/signPlan.schema.json`. La
implementación y la validación en tiempo de ejecución están en
`src/utils/signPlan.js`.

## Tipos de token

### `sign`

Una seña léxica aislada. Ejemplo: `HOLA`.

### `phrase`

Una unidad indivisible expresada con varias palabras en español. Ejemplo:
`POR_FAVOR`. No significa "varias señas"; es un solo token reproducible.

### `temporal`

Una expresión de tiempo con significado explícito. Distingue, por ejemplo,
`MAÑANA` (`kind: day`, futuro) de `POR_LA_MAÑANA` (`kind: day_period`, cuya
orientación depende del contexto).

### `pronoun`

Persona gramatical y número, incluso cuando el español omite el pronombre.
Puede conservar un referente y un locus espacial para fases posteriores.

### `direction`

Modificador espacial aplicado a otra seña. No se reproduce solo. Usa las
mismas direcciones que `vrmBaker.js`, por ejemplo `self`, `listener`, `third`
o `group_self`.

### `facial`

Modificador no manual aplicado a una seña o alcance. Sus canales v1 son
cejas, ojos, boca, mejillas y cabeza, cada uno con intensidad de 0 a 1.

## Ejemplo contextual

```js
createSignPlan({
  sourceText: 'Mañana por la mañana te ayudaré',
  intent: 'inform',
  tokens: [
    {
      type: 'temporal',
      gloss: 'MAÑANA',
      playToken: 'MAÑANA',
      payload: { kind: 'day', value: 'tomorrow', orientation: 'future' },
    },
    {
      type: 'temporal',
      gloss: 'POR_LA_MAÑANA',
      playToken: 'POR_LA_MAÑANA',
      payload: { kind: 'day_period', value: 'morning', orientation: 'contextual' },
    },
    {
      id: 'verb-help',
      type: 'sign',
      gloss: 'AYUDA',
      playToken: 'AYUDA::listener',
      payload: {},
    },
    {
      type: 'direction',
      payload: { direction: 'listener', appliesTo: 'verb-help' },
    },
  ],
})
```

## Reglas de compatibilidad

1. `playToken` es el único valor que llega hoy a la cola del avatar.
2. `direction` y `facial` son modificadores y no clips independientes.
3. Los tokens `pending` no se reproducen hasta que el contexto los confirme.
4. Una unidad comprendida pero aún no grabada usa `availability: missing` y
   `playToken: null`: conserva el significado sin inventar una animación.
5. Ningún plan inválido debe llegar al avatar; `assertValidSignPlan` falla con
   todos los errores encontrados.
6. Toda ampliación incompatible requiere una nueva `schemaVersion`.

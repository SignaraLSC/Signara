# Catálogo semántico educativo v1

El catálogo de `src/data/semanticCatalog.js` reúne expresiones del español por
significado, no solo por ortografía. Es la fuente versionada de los Días 2-3
del plan contextual.

## Principios

1. **Longest-match:** `POR LA MAÑANA` se resuelve antes que `MAÑANA`.
2. **Comprender no significa inventar:** si la glosa está catalogada pero aún
   no tiene animación, el SignPlan conserva `availability: missing` y no la
   envía al avatar.
3. **Separar evidencia de hipótesis:** cada entrada indica si está grabada,
   documentada lingüísticamente o pendiente de revisión comunitaria.
4. **Dominio primero:** el catálogo inicial prioriza educación y algunas
   expresiones generales/salud que Signara ya utiliza.
5. **Compatibilidad:** las corridas no comprendidas por el catálogo pasan al
   matcher anterior, manteniendo verbos direccionales, frases existentes y
   deletreo.

## Ambigüedades registradas

- `mañana`: día posterior / periodo matutino.
- `nota`: calificación / apunte escrito.
- `materia`: asignatura / material físico.
- `grado`: nivel escolar / temperatura / ángulo.
- `lengua`: idioma / órgano.

Solo `mañana` tiene reglas activas completas en esta versión porque cuenta con
patrones explícitos y documentación lingüística de LSC. Las demás quedan como
backlog estructurado para el analizador de reglas de los Días 4-5 y requieren
validación de sus realizaciones en LSC.

## Cómo agregar una entrada

Cada entrada necesita:

- `id` semántico estable;
- `domain`;
- uno o varios `patterns` normalizables;
- `type` de SignPlan;
- `gloss` canónica;
- `payload` semántico;
- `reviewStatus` y, cuando exista, `evidence`.

Agregar una palabra al catálogo no implica que el avatar pueda ejecutarla. La
animación aparece automáticamente cuando `/animations` incluya la glosa o el
token base requerido.

"""
directional_verbs.py — mapeo dirección → palabra conjugada, lado RECONOCIMIENTO
(cámara). Contraparte de src/utils/directionalVerbs.js (lado avatar/salida) —
misma decisión lingüística, aplicada en el sentido inverso: allá una forma de
texto ("ayúdame") se traduce a una dirección para redirigir la seña; acá una
dirección leída de la cámara (ver core/direction_reader.py) se traduce a la
forma de texto que se muestra/lee en voz alta.

Mantener las claves de dirección ('self'/'listener'/'third'/'group_self')
sincronizadas entre ambos archivos — son el mismo vocabulario geométrico.
"""

DIRECTIONAL_VERBS: dict[str, dict[str, str]] = {
    "AYUDA": {
        "neutral": "AYUDA",
        "self": "AYUDAME",
        "listener": "TE_AYUDO",
        # 'third' es un lado fijo, no la persona gramaticalmente correcta
        # (necesita Fase 3) — mismo trade-off que el lado avatar.
        "third": "AYUDALO",
        "group_self": "AYUDANOS",
    },
}


def conjugate(citation_label: str, direction: str) -> str:
    """AYUDA + 'self' -> AYUDAME. Si el label no es un verbo direccional
    conocido, o la dirección no tiene forma mapeada, devuelve el label tal
    cual (comportamiento neutro/no-op)."""
    forms = DIRECTIONAL_VERBS.get(citation_label)
    if not forms:
        return citation_label
    return forms.get(direction, citation_label)

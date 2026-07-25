"""
directional_verbs.py — mapeo dirección → palabra conjugada, lado RECONOCIMIENTO
(cámara). Contraparte de src/utils/directionalVerbs.js (lado avatar/salida) —
misma decisión lingüística, aplicada en el sentido inverso: allá una forma de
texto ("ayúdame") se traduce a una dirección para redirigir la seña; acá una
dirección leída de la cámara (ver core/direction_reader.py) se traduce a la
forma de texto que se muestra/lee en voz alta.

Mantener las claves de dirección sincronizadas entre ambos archivos — son el
mismo vocabulario geométrico. Ver CLAUDE.md → "Directional verbs (spatial
agreement)" (Fase 2 / 2B / 3).
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
        "group_third": "AYUDALOS",
        "third_self": "ME_AYUDA",
        "third_group_self": "NOS_AYUDAN",
        "fan_out": "LOS_AYUDO",
    },
    "PERDON": {
        "neutral": "PERDON",
        # Pedir perdón: en cámara no hay torso lean fiable → self ≈ pecho.
        "plead": "PERDONAME",
        "self": "PERDONAME",
        "listener": "TE_PERDONO",
        "third_self": "EL_ME_PERDONO",
        "group_self": "PERDONANOS",
    },
    "TE_AMO": {
        # Cita / proyección al oyente; seña casi estática → suele quedar aquí.
        "neutral": "TE_AMO",
        "listener": "TE_AMO",
        "self": "ME_AMAS",
        "third": "LO_AMO",
        "third_self": "ME_AMA",
        "group_self": "NOS_AMAMOS",
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

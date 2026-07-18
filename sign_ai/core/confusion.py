"""
Pares de señas que el modelo suele confundir.
Si el top-2 cae en uno de estos pares, exigimos más margen antes de confirmar.

Variantes de una misma palabra
-------------------------------
Cuando una palabra tiene varias formas VÁLIDAS de hacerse (p. ej. una variante
regional de LSC), se graba cada forma como una sub-etiqueta con sufijo
"_V<N>": HOLA_V1, HOLA_V2, ... (ver sign_ai/00_capture.py). El modelo entrena
cada variante como una clase separada (fronteras de decisión más limpias que
si se mezclaran movimientos distintos bajo una sola etiqueta), pero antes de
decidir la predicción, canonical_label() les quita el sufijo y evaluate_
prediction() SUMA sus probabilidades — así, si el modelo duda entre dos
variantes de la MISMA palabra, no se penaliza como ambigüedad (a diferencia
de dudar entre dos palabras distintas, que sí exige el margen de más arriba).
"""

from __future__ import annotations

import re

CONFUSION_PAIRS: set[frozenset[str]] = {
    frozenset({"HOLA", "BIEN"}),
    frozenset({"HOLA", "COMO_ESTAS"}),
    frozenset({"HOLA", "GRACIAS"}),
    frozenset({"BIEN", "MAL"}),
    frozenset({"SED", "NECESITO_AYUDA"}),
    frozenset({"MAL", "NECESITO_AYUDA"}),
    frozenset({"BIEN", "NECESITO_AYUDA"}),
    frozenset({"COMO_ESTAS", "GRACIAS"}),
}

DEFAULT_MIN_CONF = 0.80
DEFAULT_MIN_MARGIN = 0.16
STRICT_MIN_MARGIN = 0.24

_VARIANT_RE = re.compile(r"_V\d+$")


def canonical_label(label: str) -> str:
    """Quita el sufijo de variante para obtener la palabra canónica.
    HOLA_V1 -> HOLA · HOLA_V2 -> HOLA · HOLA -> HOLA (sin cambios si no hay sufijo)."""
    return _VARIANT_RE.sub("", label.upper())


def pair_is_confusable(label_a: str, label_b: str) -> bool:
    return frozenset({label_a.upper(), label_b.upper()}) in CONFUSION_PAIRS


def required_margin(
    top_label: str, second_label: str, base_margin: float = DEFAULT_MIN_MARGIN
) -> float:
    """`base_margin` es el margen normal (configurable vía SIGNARA_MARGEN_TOP2
    en api.py). Para pares confundibles se exige ese mismo margen MÁS el extra
    fijo que separaba antes a DEFAULT_MIN_MARGIN de STRICT_MIN_MARGIN, así que
    subir/bajar el margen base también mueve el umbral estricto en proporción."""
    if pair_is_confusable(top_label, second_label):
        return base_margin + (STRICT_MIN_MARGIN - DEFAULT_MIN_MARGIN)
    return base_margin


def evaluate_prediction(
    labels: list[str],
    probs,
    *,
    min_conf: float = DEFAULT_MIN_CONF,
    min_margin: float = DEFAULT_MIN_MARGIN,
) -> tuple[str | None, float, float]:
    """
    Devuelve (predicción aceptada o None, confianza top1, margen top1-top2).

    `labels` puede incluir sub-etiquetas de variante (HOLA_V1, HOLA_V2, ...);
    aquí se fusionan por palabra canónica antes de decidir, así el resultado
    y el margen de confusión operan siempre sobre palabras, no variantes.

    `min_margin` es el margen BASE (no confundible); antes este parámetro no
    existía y la función siempre usaba el default aunque api.py exponía
    SIGNARA_MARGEN_TOP2 como si fuera configurable — quedaba muerto. Ahora sí
    se respeta.
    """
    import numpy as np

    probs = np.asarray(probs, dtype=np.float32)

    merged: dict[str, float] = {}
    for label, p in zip(labels, probs):
        canon = canonical_label(label)
        merged[canon] = merged.get(canon, 0.0) + float(p)

    canon_labels = list(merged.keys())
    canon_probs = np.array([merged[l] for l in canon_labels], dtype=np.float32)

    order = np.argsort(canon_probs)[::-1]
    top = int(order[0])
    conf = float(canon_probs[top])

    if conf < min_conf:
        return None, conf, 0.0

    if len(order) < 2:
        return canon_labels[top], conf, conf

    second = int(order[1])
    margin = float(canon_probs[top] - canon_probs[second])
    need = required_margin(canon_labels[top], canon_labels[second], min_margin)

    if margin < need:
        return None, conf, margin

    return canon_labels[top], conf, margin

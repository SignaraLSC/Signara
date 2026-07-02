"""
Pares de señas que el modelo suele confundir.
Si el top-2 cae en uno de estos pares, exigimos más margen antes de confirmar.
"""

from __future__ import annotations

CONFUSION_PAIRS: set[frozenset[str]] = {
    frozenset({"HOLA", "BIEN"}),
    frozenset({"HOLA", "COMO_ESTAS"}),
    frozenset({"HOLA", "GRACIAS"}),
    frozenset({"BIEN", "MAL"}),
    frozenset({"SED", "NECESITO_AYUDA"}),
    frozenset({"MAL", "NECESITO_AYUDA"}),
    frozenset({"COMO_ESTAS", "GRACIAS"}),
}

DEFAULT_MIN_CONF = 0.80
DEFAULT_MIN_MARGIN = 0.16
STRICT_MIN_MARGIN = 0.24


def pair_is_confusable(label_a: str, label_b: str) -> bool:
    return frozenset({label_a.upper(), label_b.upper()}) in CONFUSION_PAIRS


def required_margin(top_label: str, second_label: str) -> float:
    if pair_is_confusable(top_label, second_label):
        return STRICT_MIN_MARGIN
    return DEFAULT_MIN_MARGIN


def evaluate_prediction(
    labels: list[str],
    probs,
    *,
    min_conf: float = DEFAULT_MIN_CONF,
) -> tuple[str | None, float, float]:
    """
    Devuelve (predicción aceptada o None, confianza top1, margen top1-top2).
    """
    import numpy as np

    probs = np.asarray(probs, dtype=np.float32)
    order = np.argsort(probs)[::-1]
    top = int(order[0])
    conf = float(probs[top])

    if conf < min_conf:
        return None, conf, 0.0

    if len(order) < 2:
        return labels[top], conf, conf

    second = int(order[1])
    margin = float(probs[top] - probs[second])
    need = required_margin(labels[top], labels[second])

    if margin < need:
        return None, conf, margin

    return labels[top], conf, margin

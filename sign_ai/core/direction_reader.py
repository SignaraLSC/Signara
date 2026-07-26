"""
direction_reader.py — Fase 2B: lectura geométrica de dirección desde cámara.

Complemento del GNN (que solo reconoce la seña AISLADA, ej. "AYUDA"): para
verbos direccionales, lee la trayectoria de la mano activa dentro de los
mismos frames que ya llegan a /predict y clasifica hacia dónde se dirigió
el gesto. Ver DIRECTIONAL_VERBS en directional_verbs.py y CLAUDE.md →
"Directional verbs (spatial agreement)".

Restricción real (decisión 2026-07-21): /predict solo recibe landmarks de
MANO (T×126), no pose/hombros. La profundidad se aproxima con el tamaño
proyectado de la mano; lateral/vertical con x,y de la muñeca.

Calibración AYUDA (2026-07-26):
  · AYUDA     = empujón adelante (mano crece) → 'listener' / 'neutral'
  · AYUDAME   = hacia el PECHO (mano baja y/o se achica) → 'self'  [PRIORIDAD]
  · AYUDANOS  = circular / barrido lateral claro → 'group_self'
  · TE_AYUDO  = Fase 3 (señalar + misma seña)

Sin evidencia fuerte → 'neutral'. Mejor AYUDA que inventar otras formas.
"""

from __future__ import annotations

import numpy as np

WRIST = 0
N_HAND_LANDMARKS = 21

EDGE_WINDOW = 4

MIN_NET_MOVEMENT = 0.045
# Empujón claro hacia la cámara = cita AYUDA.
FORWARD_SPREAD_GROWTH = 0.30
# Hacia el pecho: achicar la mano (aleja de cámara) — señal principal de AYUDAME.
SELF_SPREAD_SHRINK = 0.14
# En coords de imagen, Y crece hacia ABAJO → pecho = muñeca baja (net[1] > 0).
SELF_DOWN_THRESHOLD = 0.06
LATERAL_X_THRESHOLD = 0.14
SWEEP_MIN_RANGE = 0.32
SWEEP_MIN_REVERSALS = 2
SWEEP_DOMINANCE = 1.25
CIRCULAR_MIN_XY_RANGE = 0.24
CIRCULAR_MIN_PATH_RATIO = 2.8
GROUP_THIRD_MIN_RANGE = 0.24
GROUP_THIRD_MAX_REVERSALS = 1


def _hand_block(frames_compact: np.ndarray, side: str) -> np.ndarray:
    """side: 'lh' o 'rh' → (T, 21, 3)."""
    start = 0 if side == "lh" else 63
    return frames_compact[:, start:start + 63].reshape(-1, N_HAND_LANDMARKS, 3)


def _hand_present(hand: np.ndarray) -> np.ndarray:
    """Frames donde la mano no está vacía (todo-ceros = no detectada ese frame)."""
    return np.abs(hand).sum(axis=(1, 2)) > 1e-6


def _hand_spread(hand_frame: np.ndarray) -> float:
    """Tamaño proyectado de la mano en un frame — diagonal del bbox en x,y."""
    xs = hand_frame[:, 0]
    ys = hand_frame[:, 1]
    return float(np.hypot(xs.max() - xs.min(), ys.max() - ys.min()))


def _pick_active_hand(frames_compact: np.ndarray) -> tuple[str, np.ndarray] | None:
    """Elige la mano con más movimiento neto de muñeca — es la que lleva la
    dirección del verbo (ej. en AYUDA, el puño que empuja, no la palma base)."""
    candidates = []
    for side in ("lh", "rh"):
        hand = _hand_block(frames_compact, side)
        present = _hand_present(hand)
        if present.sum() < EDGE_WINDOW * 2:
            continue
        wrist_xy = hand[:, WRIST, :2]
        total_motion = float(np.sum(np.linalg.norm(np.diff(wrist_xy[present], axis=0), axis=1)))
        candidates.append((total_motion, side, hand, present))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0], reverse=True)
    _, side, hand, present = candidates[0]
    return side, hand[present]


def classify_direction(frames_compact: np.ndarray, verb: str | None = None) -> dict:
    """frames_compact: (T, 126) crudo (sin normalizar), tal como llega a /predict.

    Devuelve {"direction": str, "debug": {...}}.
    Prioridad para AYUDA: self (AYUDAME) > group_self (AYUDANOS) > listener/neutral (AYUDA).
    Para TE_AMO: umbrales más altos — ILY estático no debe inventar ME_AMAS.
    """
    verb = (verb or "").upper()
    picked = _pick_active_hand(frames_compact)
    if picked is None:
        return {"direction": "neutral", "debug": {"reason": "no_hand"}}

    side, hand = picked
    n = len(hand)
    if n < EDGE_WINDOW * 2:
        return {"direction": "neutral", "debug": { "reason": "too_short", "side": side}}

    wrist = hand[:, WRIST, :2]  # (n, 2) x,y
    start = wrist[:EDGE_WINDOW].mean(axis=0)
    end = wrist[-EDGE_WINDOW:].mean(axis=0)
    net = end - start
    net_mag = float(np.linalg.norm(net))

    spreads = np.array([_hand_spread(hand[i]) for i in range(n)])
    spread_start = float(spreads[:EDGE_WINDOW].mean())
    spread_end = float(spreads[-EDGE_WINDOW:].mean())
    spread_growth = (spread_end - spread_start) / max(spread_start, 1e-4)
    spread_shrink = (spread_start - spread_end) / max(spread_start, 1e-4)

    xs = wrist[:, 0]
    ys = wrist[:, 1]
    x_range = float(xs.max() - xs.min())
    y_range = float(ys.max() - ys.min())
    xy_range = float(np.hypot(x_range, y_range))
    dx = np.diff(xs)
    dx = dx[np.abs(dx) > 1e-4]
    reversals = int(np.sum(np.diff(np.sign(dx)) != 0)) if len(dx) > 1 else 0

    path_len = float(np.sum(np.linalg.norm(np.diff(wrist, axis=0), axis=1))) if n > 1 else 0.0
    path_ratio = path_len / max(net_mag, 1e-4)

    debug = {
        "side": side,
        "verb": verb or None,
        "net": net.tolist(),
        "net_mag": net_mag,
        "spread_growth": spread_growth,
        "spread_shrink": spread_shrink,
        "x_range": x_range,
        "y_range": y_range,
        "xy_range": xy_range,
        "path_ratio": path_ratio,
        "reversals": reversals,
    }

    # ── TE_AMO: ILY quieto → TE_AMO; ME_AMAS si hay gesto claro al pecho ──
    if verb == "TE_AMO":
        # Cita estática: poco movimiento y sin achicar → no inventar conjugación.
        static_ily = net_mag < 0.035 and spread_shrink < 0.10 and y_range < 0.06
        if static_ily:
            return {"direction": "listener", "debug": {**debug, "reason": "te_amo_static"}}

        # ME_AMAS: hacia el pecho (achicar y/o bajar). Un poco más estricto que AYUDA.
        te_shrink = 0.15
        te_down = 0.07
        down = float(net[1]) >= te_down
        down_dom = abs(float(net[1])) >= abs(float(net[0])) * 0.75
        shrink = spread_shrink >= te_shrink
        not_forward = spread_growth < FORWARD_SPREAD_GROWTH * 0.85
        if not_forward and (
            (shrink and (down or float(net[1]) >= 0.04))
            or (down and down_dom and net_mag >= 0.05)
            or (shrink and spread_shrink >= 0.18)
        ):
            return {"direction": "self", "debug": {**debug, "reason": "te_amo_chest"}}

        # NOS_AMAMOS: barrido/círculo claro
        if (
            x_range >= SWEEP_MIN_RANGE
            and reversals >= SWEEP_MIN_REVERSALS
            and x_range >= abs(float(net[1])) * SWEEP_DOMINANCE
        ):
            return {"direction": "group_self", "debug": {**debug, "reason": "te_amo_sweep"}}
        if (
            xy_range >= CIRCULAR_MIN_XY_RANGE
            and path_ratio >= CIRCULAR_MIN_PATH_RATIO
            and x_range >= CIRCULAR_MIN_XY_RANGE * 0.6
        ):
            return {"direction": "group_self", "debug": {**debug, "reason": "te_amo_circular"}}

        # LO_AMO: lateral marcado
        if abs(float(net[0])) >= 0.16 and abs(float(net[0])) >= abs(float(net[1])) * 1.1:
            return {"direction": "third", "debug": {**debug, "reason": "te_amo_third"}}

        # ME_AMA: lateral + hacia pecho
        if abs(float(net[0])) >= 0.12 and shrink and float(net[1]) >= 0.05:
            return {"direction": "third_self", "debug": {**debug, "reason": "te_amo_third_self"}}

        if spread_growth >= FORWARD_SPREAD_GROWTH * 0.7:
            return {"direction": "listener", "debug": {**debug, "reason": "te_amo_forward"}}
        return {"direction": "listener", "debug": {**debug, "reason": "te_amo_default"}}

    # ── 1) AYUDAME (pecho) ANTES que adelante ───────────────────────────────
    # Hacia el cuerpo: la mano se aleja de la cámara (se achica) y/o la muñeca
    # baja en imagen. No exigir ambas; el shrink solo ya es fuerte en profundidad.
    down = float(net[1]) >= SELF_DOWN_THRESHOLD
    down_dom = abs(float(net[1])) >= abs(float(net[0])) * 0.85
    shrink = spread_shrink >= SELF_SPREAD_SHRINK
    # No es empujón claro hacia cámara
    not_forward = spread_growth < FORWARD_SPREAD_GROWTH * 0.85

    if not_forward and (
        shrink
        or (down and down_dom)
        or (shrink and float(net[1]) >= SELF_DOWN_THRESHOLD * 0.35)
    ):
        return {"direction": "self", "debug": {**debug, "reason": "toward_chest"}}

    # ── 2) AYUDANOS: barrido / círculo (umbrales altos, evitar tembleque) ───
    if (
        x_range >= SWEEP_MIN_RANGE
        and reversals >= SWEEP_MIN_REVERSALS
        and x_range >= abs(float(net[1])) * SWEEP_DOMINANCE
    ):
        return {"direction": "group_self", "debug": {**debug, "reason": "sweep"}}

    if (
        xy_range >= CIRCULAR_MIN_XY_RANGE
        and path_ratio >= CIRCULAR_MIN_PATH_RATIO
        and x_range >= CIRCULAR_MIN_XY_RANGE * 0.6
        and not shrink
    ):
        return {"direction": "group_self", "debug": {**debug, "reason": "circular"}}

    # ── 3) AYUDA (cita): empujón hacia la cámara ───────────────────────────
    if spread_growth >= FORWARD_SPREAD_GROWTH and not shrink:
        return {"direction": "listener", "debug": {**debug, "reason": "forward_citation"}}

    if net_mag < MIN_NET_MOVEMENT and not shrink:
        return {"direction": "neutral", "debug": {**debug, "reason": "little_motion"}}

    # Lateral / otras formas: NO inventar AYUDALO etc. → neutral (→ AYUDA).
    # (Fase 3 / más calibración si se reactivan.)
    if abs(float(net[0])) >= LATERAL_X_THRESHOLD and abs(float(net[0])) >= abs(float(net[1])):
        return {"direction": "neutral", "debug": {**debug, "reason": "lateral_as_neutral"}}

    return {"direction": "neutral", "debug": {**debug, "reason": "default_neutral"}}

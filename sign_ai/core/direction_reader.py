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

IMPORTANTE — conjugación (2026-07-24+):
En api.py la conjugación está OFF por defecto (SIGNARA_CONJUGATE=0).
`self` = hacia el PECHO (muñeca baja en imagen y/o mano se achica al alejarse
de la cámara), NO hacia la cara. Sin evidencia fuerte → 'neutral'.
"""

from __future__ import annotations

import numpy as np

WRIST = 0
N_HAND_LANDMARKS = 21

EDGE_WINDOW = 4

# Umbrales conservadores: mejor decir AYUDA que inventar AYUDANOS/AYUDAME.
MIN_NET_MOVEMENT = 0.055
FORWARD_SPREAD_GROWTH = 0.32   # empuje claro hacia la cámara (TE_AYUDO)
SELF_SPREAD_SHRINK = 0.22      # mano se achica → hacia el cuerpo/pecho
LATERAL_X_THRESHOLD = 0.12     # desplazamiento lateral neto (AYUDALO)
# En coords de imagen, Y crece hacia ABAJO → pecho = muñeca baja (net[1] > 0).
SELF_DOWN_THRESHOLD = 0.09
SWEEP_MIN_RANGE = 0.30         # barrido ancho (AYUDANOS)
SWEEP_MIN_REVERSALS = 2        # ida y vuelta real, no un tembleque
SWEEP_DOMINANCE = 1.15         # rango X debe dominar al |net| vertical
# Semicírculo en UNA zona lateral (AYUDALOS): rango X alto, poco reversal.
GROUP_THIRD_MIN_RANGE = 0.22
GROUP_THIRD_MAX_REVERSALS = 1
# third_self: lateral claro en la 1ª mitad + baja hacia pecho en la 2ª.
THIRD_SELF_LATERAL = 0.10
THIRD_SELF_DOWN = 0.07


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


def classify_direction(frames_compact: np.ndarray) -> dict:
    """frames_compact: (T, 126) crudo (sin normalizar), tal como llega a /predict.

    Devuelve {"direction": str, "debug": {...}}. "direction" es uno de
    'neutral' | 'self' | 'listener' | 'third' | 'group_self' | 'group_third'
    | 'third_self' | 'fan_out' | …
    Por defecto 'neutral' si no hay señal clara.
    """
    picked = _pick_active_hand(frames_compact)
    if picked is None:
        return {"direction": "neutral", "debug": {"reason": "no_hand"}}

    side, hand = picked
    n = len(hand)
    if n < EDGE_WINDOW * 2:
        return {"direction": "neutral", "debug": {"reason": "too_short", "side": side}}

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
    x_range = float(xs.max() - xs.min())
    dx = np.diff(xs)
    dx = dx[np.abs(dx) > 1e-4]
    reversals = int(np.sum(np.diff(np.sign(dx)) != 0)) if len(dx) > 1 else 0

    # Mitades para third_self (lateral → pecho).
    mid = n // 2
    if mid >= EDGE_WINDOW:
        first_net = wrist[mid - EDGE_WINDOW:mid].mean(axis=0) - start
        second_net = end - wrist[mid:mid + EDGE_WINDOW].mean(axis=0)
    else:
        first_net = net
        second_net = net

    debug = {
        "side": side,
        "net": net.tolist(),
        "net_mag": net_mag,
        "spread_growth": spread_growth,
        "spread_shrink": spread_shrink,
        "x_range": x_range,
        "reversals": reversals,
    }

    # AYUDANOS: barrido lateral amplio con ida-y-vuelta (no tembleque de AYUDA).
    if (
        x_range >= SWEEP_MIN_RANGE
        and reversals >= SWEEP_MIN_REVERSALS
        and x_range >= abs(float(net[1])) * SWEEP_DOMINANCE
    ):
        return {"direction": "group_self", "debug": {**debug, "reason": "sweep"}}

    # AYUDALOS: arco lateral amplio sin ida-y-vuelta (una zona).
    if (
        x_range >= GROUP_THIRD_MIN_RANGE
        and reversals <= GROUP_THIRD_MAX_REVERSALS
        and abs(float(net[0])) >= LATERAL_X_THRESHOLD
        and abs(float(net[0])) >= abs(float(net[1])) * 0.9
    ):
        return {"direction": "group_third", "debug": {**debug, "reason": "lateral_arc"}}

    # TE_AYUDO: la mano crece claramente (se acerca a la cámara).
    if spread_growth >= FORWARD_SPREAD_GROWTH:
        return {"direction": "listener", "debug": {**debug, "reason": "forward"}}

    # Él me ayuda: lateral en la 1ª mitad + baja al pecho en la 2ª.
    if (
        mid >= EDGE_WINDOW
        and abs(float(first_net[0])) >= THIRD_SELF_LATERAL
        and abs(float(first_net[0])) >= abs(float(first_net[1]))
        and float(second_net[1]) >= THIRD_SELF_DOWN
    ):
        return {"direction": "third_self", "debug": {**debug, "reason": "lateral_then_chest"}}

    if net_mag < MIN_NET_MOVEMENT and spread_shrink < SELF_SPREAD_SHRINK:
        return {"direction": "neutral", "debug": {**debug, "reason": "little_motion"}}

    # AYUDALO: desplazamiento horizontal neto dominante (sin arco group_third).
    if abs(float(net[0])) >= LATERAL_X_THRESHOLD and abs(float(net[0])) >= abs(float(net[1])):
        return {"direction": "third", "debug": {**debug, "reason": "lateral"}}

    # AYUDAME / me amas: hacia el PECHO — muñeca baja (Y imagen ↑) y/o spread↓.
    toward_chest = (
        float(net[1]) >= SELF_DOWN_THRESHOLD
        and abs(float(net[1])) >= abs(float(net[0])) * 0.85
    ) or spread_shrink >= SELF_SPREAD_SHRINK
    if toward_chest:
        return {"direction": "self", "debug": {**debug, "reason": "toward_chest"}}

    # Abanico desde pecho hacia afuera (yo los ayudo): baja→sube o abre X + crece.
    if (
        float(net[1]) <= -SELF_DOWN_THRESHOLD * 0.7
        and x_range >= GROUP_THIRD_MIN_RANGE * 0.85
        and spread_growth >= FORWARD_SPREAD_GROWTH * 0.45
    ):
        return {"direction": "fan_out", "debug": {**debug, "reason": "fan_out"}}

    # Sin evidencia fuerte → glosa citación (neutral). Nunca inventar conjugación.
    return {"direction": "neutral", "debug": {**debug, "reason": "default_neutral"}}

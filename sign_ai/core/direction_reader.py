"""
direction_reader.py — Fase 2B: lectura geométrica de dirección desde cámara.

Complemento del GNN (que solo reconoce la seña AISLADA, ej. "AYUDA"): para
verbos direccionales, lee la trayectoria de la mano activa dentro de los
mismos frames que ya llegan a /predict y clasifica hacia dónde se dirigió
el gesto (self/listener/third/group_self). Ver DIRECTIONAL_VERBS en
directional_verbs.py para el mapeo dirección → palabra.

Restricción real (decisión 2026-07-21): /predict solo recibe landmarks de
MANO (T×126), no pose/hombros. La profundidad se aproxima con el tamaño
proyectado de la mano; lateral/vertical con x,y de la muñeca.

IMPORTANTE — conjugación (2026-07-24):
En api.py la conjugación está OFF por defecto (SIGNARA_CONJUGATE=0).
Sin landmarks de pose/hombros, AYUDA neutro se clasificaba como AYUDAME y
viceversa. Esta heurística queda para cuando existan tomas calibradas de
AYUDAME / AYUDANOS / TE_AYUDO y se reactive con SIGNARA_CONJUGATE=1.
"""

from __future__ import annotations

import numpy as np

WRIST = 0
N_HAND_LANDMARKS = 21

EDGE_WINDOW = 4

# Umbrales conservadores: mejor decir AYUDA que inventar AYUDANOS/AYUDAME.
MIN_NET_MOVEMENT = 0.055
FORWARD_SPREAD_GROWTH = 0.32   # empuje claro hacia la cámara (TE_AYUDO)
LATERAL_X_THRESHOLD = 0.12     # desplazamiento lateral neto (AYUDALO)
SELF_UP_THRESHOLD = 0.09       # muñeca sube hacia la cara (AYUDAME); y↓ en imagen
SWEEP_MIN_RANGE = 0.30         # barrido ancho (AYUDANOS)
SWEEP_MIN_REVERSALS = 2        # ida y vuelta real, no un tembleque
SWEEP_DOMINANCE = 1.15         # rango X debe dominar al |net| vertical


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
    'neutral' | 'self' | 'listener' | 'third' | 'group_self'.
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

    xs = wrist[:, 0]
    x_range = float(xs.max() - xs.min())
    dx = np.diff(xs)
    dx = dx[np.abs(dx) > 1e-4]
    reversals = int(np.sum(np.diff(np.sign(dx)) != 0)) if len(dx) > 1 else 0

    debug = {
        "side": side,
        "net": net.tolist(),
        "net_mag": net_mag,
        "spread_growth": spread_growth,
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

    # TE_AYUDO: la mano crece claramente (se acerca a la cámara).
    if spread_growth >= FORWARD_SPREAD_GROWTH:
        return {"direction": "listener", "debug": {**debug, "reason": "forward"}}

    if net_mag < MIN_NET_MOVEMENT:
        return {"direction": "neutral", "debug": {**debug, "reason": "little_motion"}}

    # AYUDALO: desplazamiento horizontal neto dominante.
    if abs(float(net[0])) >= LATERAL_X_THRESHOLD and abs(float(net[0])) >= abs(float(net[1])):
        return {"direction": "third", "debug": {**debug, "reason": "lateral"}}

    # AYUDAME: la mano sube hacia la cara (y disminuye en coords de imagen).
    if float(net[1]) <= -SELF_UP_THRESHOLD and abs(float(net[1])) >= abs(float(net[0])):
        return {"direction": "self", "debug": {**debug, "reason": "up_to_face"}}

    # Sin evidencia fuerte → AYUDA (neutral). Nunca inventar conjugación.
    return {"direction": "neutral", "debug": {**debug, "reason": "default_neutral"}}

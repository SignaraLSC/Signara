"""
direction_reader.py — Fase 2B: lectura geométrica de dirección desde cámara.

Complemento del GNN (que solo reconoce la seña AISLADA, ej. "AYUDA"): para
verbos direccionales, lee la trayectoria de la mano activa dentro de los
mismos 30 frames que ya llegan a /predict y clasifica hacia dónde se dirigió
el gesto (self/listener/third/group_self), igual que el lado del avatar
(vrmBaker.js) hace en reversa para SALIDA. Ver
DIRECTIONAL_VERBS en directional_verbs.py para el mapeo dirección → palabra.

Restricción real (decisión tomada 2026-07-21, ver memoria signara-sign-
grammar-roadmap.md): /predict solo recibe landmarks de MANO (frames 30×126,
lh 63 + rh 63 — ver core/preprocess.py), no hay pose/hombros en tiempo real
(se sacó al migrar a MediaPipe Tasks Vision por lag). Sin esa referencia de
cuerpo:
  - El landmark 0 (muñeca) de cada mano es el ORIGEN de esa mano en el
    formato de MediaPipe — su propio z es ~0 siempre, así que no sirve para
    leer profundidad de la trayectoria.
  - En su lugar, la profundidad ("¿la mano se acercó a la cámara, como
    empujando hacia el interlocutor?") se aproxima con el TAMAÑO proyectado
    de la mano (qué tan separados están sus 21 puntos en x,y) — una mano más
    cerca de la cámara ocupa más píxeles normalizados.
  - Lateral/vertical (¿se quedó a un lado? ¿barrió de lado a lado?) sí se lee
    directo de x,y de la muñeca, sin necesitar cuerpo.

Esto es deliberadamente aproximado — los umbrales de abajo son un punto de
partida razonable, no calibrado contra grabaciones reales todavía (no existe
aún ningún AYUDAME/AYUDANOS/etc. grabado). Recalibrar en cuanto haya tomas
reales, igual que se hizo con UMBRAL_CONFIANZA/MARGEN_TOP2 del GNN.
"""

from __future__ import annotations

import numpy as np

WRIST = 0
N_HAND_LANDMARKS = 21

# Cuántos frames del inicio/final se promedian para el punto de partida y de
# llegada (suaviza contra un frame ruidoso suelto en los extremos).
EDGE_WINDOW = 4

# Umbrales sobre coordenadas normalizadas de imagen (x,y en [0,1], escala de
# mano relativa al propio tamaño de la mano para el "spread").
MIN_NET_MOVEMENT = 0.03       # por debajo de esto, se considera 'neutral' (sin redirección clara)
FORWARD_SPREAD_GROWTH = 0.18  # crecimiento relativo del tamaño de mano para contar como "empuje hacia adelante"
LATERAL_X_THRESHOLD = 0.08    # desplazamiento horizontal neto para contar como 'third'
SWEEP_MIN_RANGE = 0.14        # rango horizontal total (max-min) para contar como barrido ('group_self')
SWEEP_MIN_REVERSALS = 1       # al menos un cambio de sentido en x para distinguir barrido de un solo tramo


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
    'neutral' | 'self' | 'listener' | 'third' | 'group_self' — mismos nombres
    que DIRECTION_TARGETS en vrmBaker.js, para que el mapeo a palabra final
    (directional_verbs.py) sea compartido conceptualmente con el lado avatar.
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
    # cuántas veces la dirección del movimiento en x cambia de signo (barrido
    # real de lado a lado, no solo ida a un lado).
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

    if x_range >= SWEEP_MIN_RANGE and reversals >= SWEEP_MIN_REVERSALS:
        return {"direction": "group_self", "debug": debug}

    if spread_growth >= FORWARD_SPREAD_GROWTH:
        return {"direction": "listener", "debug": debug}

    if net_mag < MIN_NET_MOVEMENT:
        return {"direction": "neutral", "debug": debug}

    if abs(net[0]) >= LATERAL_X_THRESHOLD:
        return {"direction": "third", "debug": debug}

    return {"direction": "self", "debug": debug}

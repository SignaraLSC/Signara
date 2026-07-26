"""
handshape_hints.py — heurísticas de forma de mano sobre frames compactos (T×126).

Complemento del GNN cuando dos clases one-hand se confunden (p. ej. TE_AMO vs NO).
MediaPipe: 0 muñeca, 5–8 índice, 9–12 medio, 13–16 anular, 17–20 meñique.

La extensión se mide tip↔MCP relativa a muñeca→MCP (no al bbox de toda la
mano): si el índice está muy abierto, el bbox infla y el meñique “parece”
corto — eso hacía fallar el filtro en cámara real.
"""

from __future__ import annotations

import numpy as np

N_HAND = 21
WRIST = 0
INDEX_MCP, INDEX_TIP = 5, 8
MIDDLE_MCP, MIDDLE_TIP = 9, 12
RING_MCP, RING_TIP = 13, 16
PINKY_MCP, PINKY_TIP = 17, 20


def _hand_block(frames: np.ndarray, side: str) -> np.ndarray:
    start = 0 if side == "lh" else 63
    return frames[:, start : start + 63].reshape(-1, N_HAND, 3)


def _present_mask(hand: np.ndarray) -> np.ndarray:
    return np.abs(hand).sum(axis=(1, 2)) > 1e-6


def _pick_active_hand(frames: np.ndarray) -> np.ndarray | None:
    best = None
    best_n = 0
    for side in ("lh", "rh"):
        hand = _hand_block(frames, side)
        mask = _present_mask(hand)
        n = int(mask.sum())
        if n > best_n:
            best_n = n
            best = hand[mask]
    if best is None or best_n < 4:
        return None
    return best


def _finger_extension(hand: np.ndarray, mcp: int, tip: int) -> float:
    """tip↔MCP / muñeca↔MCP — estable ante bbox grande."""
    bone = float(np.linalg.norm(hand[mcp, :2] - hand[WRIST, :2]))
    bone = max(bone, 1e-4)
    tip_len = float(np.linalg.norm(hand[tip, :2] - hand[mcp, :2]))
    return tip_len / bone


def looks_like_ily(frames_compact: np.ndarray) -> dict:
    """True si la forma media parece 'I love you'."""
    hand_seq = _pick_active_hand(np.asarray(frames_compact, dtype=np.float32))
    if hand_seq is None:
        return {"ily": False, "score": 0.0, "reason": "no_hand"}

    tail = hand_seq[-min(8, len(hand_seq)) :]
    mean_hand = tail.mean(axis=0)

    index_e = _finger_extension(mean_hand, INDEX_MCP, INDEX_TIP)
    middle_e = _finger_extension(mean_hand, MIDDLE_MCP, MIDDLE_TIP)
    ring_e = _finger_extension(mean_hand, RING_MCP, RING_TIP)
    pinky_e = _finger_extension(mean_hand, PINKY_MCP, PINKY_TIP)

    open_pair = min(index_e, pinky_e)
    closed_pair = max(middle_e, ring_e)
    contrast = open_pair - closed_pair

    score = (
        (1.0 if index_e >= 0.85 else index_e / 0.85) * 0.3
        + (1.0 if pinky_e >= 0.75 else pinky_e / 0.75) * 0.3
        + (1.0 if middle_e <= 1.05 else max(0.0, 1.4 - middle_e)) * 0.2
        + (1.0 if ring_e <= 1.05 else max(0.0, 1.4 - ring_e)) * 0.2
    )

    strict = (
        index_e >= 0.9
        and pinky_e >= 0.75
        and middle_e <= 1.15
        and ring_e <= 1.15
        and index_e > middle_e * 1.05
        and pinky_e > ring_e
        and contrast >= 0.05
    )
    soft = (
        score >= 0.68
        and pinky_e >= 0.60
        and index_e >= 0.80
        and middle_e < index_e * 1.05
        and contrast >= -0.02
    )
    ily = bool(strict or soft)

    return {
        "ily": ily,
        "score": float(score),
        "reason": "ily" if ily else "not_ily",
        "index_e": index_e,
        "middle_e": middle_e,
        "ring_e": ring_e,
        "pinky_e": pinky_e,
    }


def _mean_hand_block(frames: np.ndarray, side: str) -> np.ndarray | None:
    hand = _hand_block(frames, side)
    mask = _present_mask(hand)
    if int(mask.sum()) < 4:
        return None
    tail = hand[mask][-min(10, int(mask.sum())) :]
    return tail.mean(axis=0)


def _f_shape_score(mean_hand: np.ndarray) -> float:
    """Forma F (FAMILIA): pulgar+índice juntos, índice poco extendido."""
    bone = float(np.linalg.norm(mean_hand[INDEX_MCP, :2] - mean_hand[WRIST, :2]))
    bone = max(bone, 1e-4)
    index_e = _finger_extension(mean_hand, INDEX_MCP, INDEX_TIP)
    tip_i = mean_hand[INDEX_TIP, :2]
    tip_t = mean_hand[4, :2]  # thumb tip
    it = float(np.linalg.norm(tip_i - tip_t)) / bone
    # IT pequeño + índice corto → F; IT grande / índice largo → no F
    close = 1.0 if it <= 0.25 else max(0.0, 1.0 - (it - 0.25) / 0.55)
    curled = 1.0 if index_e <= 0.55 else max(0.0, 1.0 - (index_e - 0.55) / 0.70)
    return 0.55 * close + 0.45 * curled


def _wrist_traj(frames: np.ndarray, side: str) -> np.ndarray | None:
    hand = _hand_block(frames, side)
    mask = _present_mask(hand)
    if int(mask.sum()) < 4:
        return None
    return hand[mask][:, WRIST, :2]


def resolve_como_familia(frames_compact: np.ndarray) -> dict:
    """Desambigua COMO_ESTAS vs FAMILIA (inician parecido: órbita a dos manos).

    FAMILIA: forma F (pulgar-índice juntos), muñecas cerca, círculo chico.
    COMO_ESTAS: índices más abiertos, muñecas más separadas, órbita más amplia.
    """
    frames = np.asarray(frames_compact, dtype=np.float32)
    f_scores = []
    index_es = []
    for side in ("lh", "rh"):
        mh = _mean_hand_block(frames, side)
        if mh is None:
            continue
        f_scores.append(_f_shape_score(mh))
        index_es.append(_finger_extension(mh, INDEX_MCP, INDEX_TIP))

    if not f_scores:
        return {"preferred": None, "familia": 0.0, "como": 0.0, "reason": "no_hand"}

    f_shape = float(np.mean(f_scores))
    index_open = float(np.mean(index_es))

    lh = _wrist_traj(frames, "lh")
    rh = _wrist_traj(frames, "rh")
    wrist_dist = 0.35
    orbit_rad = 0.08
    if lh is not None and rh is not None:
        n = min(len(lh), len(rh))
        lh, rh = lh[-n:], rh[-n:]
        dists = np.linalg.norm(lh - rh, axis=1)
        wrist_dist = float(dists.mean())
        rel = lh - rh
        mean_rel = rel.mean(axis=0)
        orbit_rad = float(np.linalg.norm(rel - mean_rel, axis=1).mean())

    close_wrists = 1.0 if wrist_dist <= 0.28 else max(0.0, 1.0 - (wrist_dist - 0.28) / 0.22)
    tight_orbit = 1.0 if orbit_rad <= 0.04 else max(0.0, 1.0 - (orbit_rad - 0.04) / 0.10)
    familia = 0.50 * f_shape + 0.30 * close_wrists + 0.20 * tight_orbit

    open_idx = 1.0 if index_open >= 0.95 else index_open / 0.95
    far_wrists = 1.0 if wrist_dist >= 0.36 else max(0.0, wrist_dist / 0.36)
    wide_orbit = 1.0 if orbit_rad >= 0.07 else orbit_rad / 0.07
    como = 0.40 * open_idx + 0.40 * far_wrists + 0.20 * wide_orbit

    # Decisión: sesgo a FAMILIA (arranque parecido a COMO). COMO solo si está claro.
    preferred = None
    looks_f = f_shape >= 0.42 or (wrist_dist <= 0.30 and f_shape >= 0.28)
    clear_como = (
        wrist_dist >= 0.38
        and index_open >= 0.95
        and f_shape < 0.40
        and como >= familia + 0.12
    )
    if looks_f and not clear_como:
        preferred = "FAMILIA"
    elif clear_como:
        preferred = "COMO_ESTAS"
    elif familia >= como:
        preferred = "FAMILIA"
    else:
        # Empate / leve ventaja COMO sin evidencia fuerte → FAMILIA (evita falso COMO).
        preferred = "FAMILIA" if como < familia + 0.20 else "COMO_ESTAS"

    return {
        "preferred": preferred,
        "familia": float(familia),
        "como": float(como),
        "f_shape": float(f_shape),
        "index_open": float(index_open),
        "wrist_dist": float(wrist_dist),
        "orbit_rad": float(orbit_rad),
        "reason": preferred or "ambiguous",
    }

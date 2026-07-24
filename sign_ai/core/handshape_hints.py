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
        score >= 0.72
        and pinky_e >= 0.65
        and index_e >= 0.85
        and middle_e < index_e
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

"""
Preprocesado compartido entre entrenamiento, API y predicción en tiempo real.

Normalización por mano (muñeca como origen + escala por tamaño de la mano)
mejora generalización entre personas y distancias a la cámara.
"""

import numpy as np

from core.gnn_model import N_FEATURES, N_NODES

MIN_HAND_SCALE = 0.05


def compact_to_gnn(frame_compact: np.ndarray) -> np.ndarray:
    """Convierte 1 frame compacto 126 (lh 63 + rh 63) → (42, 4)."""
    lh = frame_compact[:63].reshape(21, 3)
    rh = frame_compact[63:].reshape(21, 3)

    nodes = np.zeros((N_NODES, N_FEATURES), dtype=np.float32)
    nodes[:21, :3] = lh
    nodes[:21, 3] = 0.0
    nodes[21:, :3] = rh
    nodes[21:, 3] = 1.0
    return nodes


def normalize_hand_nodes(nodes: np.ndarray, start: int, end: int) -> None:
    """Normaliza in-place una mano (nodos start..end-1) respecto a la muñeca."""
    wrist = nodes[start, :3].copy()
    if np.linalg.norm(wrist) < 1e-6:
        return

    nodes[start:end, :3] -= wrist

    span = 0.0
    for i in range(start, end):
        span = max(span, float(np.linalg.norm(nodes[i, :3])))
    scale = max(span, MIN_HAND_SCALE)
    nodes[start:end, :3] /= scale


def normalize_frame_nodes(nodes: np.ndarray) -> np.ndarray:
    """Normaliza ambas manos en un frame (42, 4)."""
    out = nodes.astype(np.float32, copy=True)
    normalize_hand_nodes(out, 0, 21)
    normalize_hand_nodes(out, 21, 42)
    return out


def normalize_sequence(seq: np.ndarray) -> np.ndarray:
    """Normaliza cada frame de una secuencia (T, 42, 4)."""
    return np.stack([normalize_frame_nodes(frame) for frame in seq], axis=0)


def sequence_compact_to_gnn(
    frames_compact: np.ndarray,
    *,
    normalize: bool = True,
) -> np.ndarray:
    """(T, 126) → (T, 42, 4), opcionalmente normalizado."""
    seq = np.stack([compact_to_gnn(frames_compact[i]) for i in range(len(frames_compact))])
    if normalize:
        seq = normalize_sequence(seq)
    return seq


def predict_logits(model, gnn_seq: np.ndarray):
    """Ejecuta el modelo y devuelve probabilidades ordenadas."""
    import torch

    x = torch.as_tensor(gnn_seq, dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        logits = model(x)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
    order = np.argsort(probs)[::-1]
    return probs, order

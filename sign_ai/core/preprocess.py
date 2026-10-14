"""
Preprocesado compartido entre entrenamiento, API y predicción en tiempo real.

Normalización por mano (muñeca como origen + escala por tamaño de la mano)
mejora generalización entre personas y distancias a la cámara.
"""

import numpy as np

from core.gnn_model import N_FEATURES, N_NODES

MIN_HAND_SCALE = 0.05
LEGACY_PREPROCESS = "hand_local_v1"
MOTION_PREPROCESS = "wrist_motion_v1"
TRAJECTORY_PREPROCESS = "wrist_trajectory_xyz_v1"


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


def normalize_sequence_motion(seq: np.ndarray) -> np.ndarray:
    """Forma local + trayectoria de cada muñeca respecto al inicio del gesto.

    La normalización anterior restaba la muñeca EN CADA FRAME: un traslado
    puro de la mano producía exactamente la misma entrada al GNN. Esta versión
    mantiene la forma local pero suma el desplazamiento X/Y de la muñeca,
    dividido por el tamaño mediano de la mano para ser invariante a distancia.
    Se requiere reentrenar; no aplicar a un checkpoint antiguo.
    """
    out = normalize_sequence(seq)
    for start, end in ((0, 21), (21, 42)):
        wrists = seq[:, start, :3]
        visible = np.linalg.norm(wrists[:, :2], axis=1) > 1e-6
        if not visible.any():
            continue
        local = seq[visible, start:end, :3] - wrists[visible, None, :]
        spans = np.linalg.norm(local, axis=2).max(axis=1)
        scale = max(float(np.median(spans)), MIN_HAND_SCALE)
        first = wrists[visible, :2][:3]
        anchor = np.median(first, axis=0)
        travel = np.clip((wrists[visible, :2] - anchor) / scale, -4.0, 4.0)
        out[visible, start:end, :2] += travel[:, None, :]
    return out


def normalize_sequence_trajectory(seq: np.ndarray) -> np.ndarray:
    """Forma local + recorrido XYZ de cada muñeca en todos los cuadros reales.

    Es una representación nueva para entrenamiento de duración variable. El
    ancla se calcula al inicio de cada mano, no en cada cuadro; así un trazo
    de letra no desaparece al centrar la forma de los dedos. Las manos ausentes
    permanecen a cero y no generan trayectorias ficticias.
    """
    out = normalize_sequence(seq)
    for start, end in ((0, 21), (21, 42)):
        wrists = seq[:, start, :3]
        visible = np.linalg.norm(wrists[:, :2], axis=1) > 1e-6
        if not visible.any():
            continue
        local = seq[visible, start:end, :3] - wrists[visible, None, :]
        spans = np.linalg.norm(local, axis=2).max(axis=1)
        scale = max(float(np.median(spans)), MIN_HAND_SCALE)
        anchor = np.median(wrists[visible][:3], axis=0)
        travel = np.clip((wrists[visible] - anchor) / scale, -4.0, 4.0)
        out[visible, start:end, :3] += travel[:, None, :]
    return out


def sequence_compact_to_gnn(
    frames_compact: np.ndarray,
    *,
    normalize: bool = True,
    preprocess: str = LEGACY_PREPROCESS,
) -> np.ndarray:
    """(T, 126) → (T, 42, 4), opcionalmente normalizado."""
    seq = np.stack([compact_to_gnn(frames_compact[i]) for i in range(len(frames_compact))])
    if preprocess not in (LEGACY_PREPROCESS, MOTION_PREPROCESS, TRAJECTORY_PREPROCESS):
        raise ValueError(f"Preprocesamiento desconocido: {preprocess}")
    if normalize:
        if preprocess == TRAJECTORY_PREPROCESS:
            seq = normalize_sequence_trajectory(seq)
        elif preprocess == MOTION_PREPROCESS:
            seq = normalize_sequence_motion(seq)
        else:
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

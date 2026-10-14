"""Lectura y lotes de tomas completas para el GCN+LSTM variable.

El CSV *_raw.csv es una proyección a 24 cuadros y nunca se usa aquí.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
import json
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from core.preprocess import TRAJECTORY_PREPROCESS, sequence_compact_to_gnn

MIN_FRAMES = 6
MAX_FRAMES = 180  # Debe coincidir con /predict/sequence en api.py.


@dataclass(frozen=True)
class Take:
    label: str
    persona: str
    frames: np.ndarray  # (T, 126), sin remuestrear
    complete_capture: bool
    source: Path


def read_take(path: Path) -> Take:
    payload = json.loads(path.read_text(encoding="utf-8"))
    label = str(payload["label"]).strip().upper()
    if not label or label.isdecimal():
        raise ValueError("etiqueta inválida")
    persona = str(payload.get("persona") or path.parent.name).strip()
    raw_frames = payload["frames"]
    if not MIN_FRAMES <= len(raw_frames) <= MAX_FRAMES:
        raise ValueError(f"duración fuera de {MIN_FRAMES}..{MAX_FRAMES}: {len(raw_frames)}")
    frames = np.asarray([frame["lh"] + frame["rh"] for frame in raw_frames], dtype=np.float32)
    if frames.shape != (len(raw_frames), 42, 3) or not np.isfinite(frames).all():
        raise ValueError("landmarks de mano incompletos o no finitos")
    # Los respaldos históricos también se llamaban raw_full, pero sus frames
    # ya estaban remuestreados a 24. La nueva captura añade train_frames.
    complete_capture = payload.get("train_frames") is not None or len(raw_frames) != 24
    return Take(label, persona, frames.reshape(len(raw_frames), 126), complete_capture, path)


def load_takes(root: Path, *, limit: int | None = None):
    paths = sorted(root.rglob("*.json"))
    if limit is not None:
        paths = paths[:limit]
    if not paths:
        raise FileNotFoundError(f"No hay tomas JSON en {root}")
    takes = []
    rejected = Counter()
    for i, path in enumerate(paths, 1):
        try:
            takes.append(read_take(path))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            rejected[str(exc)] += 1
        if i % 500 == 0:
            print(f"  Leídas {i}/{len(paths)} tomas...", flush=True)
    return takes, rejected


def coverage_by_label(takes):
    result = defaultdict(lambda: {"total": 0, "complete": 0, "longer_than_24": 0, "people": set()})
    for take in takes:
        row = result[take.label]
        row["total"] += 1
        row["complete"] += int(take.complete_capture)
        row["longer_than_24"] += int(len(take.frames) > 24)
        row["people"].add(take.persona)
    return {
        label: {**row, "people": sorted(row["people"])}
        for label, row in sorted(result.items())
    }


def prefer_complete_takes(takes, *, min_complete_per_label=10):
    """Evita que las tomas comprimidas dominen una clase ya regrabada."""
    complete_counts = Counter(take.label for take in takes if take.complete_capture)
    replaced_labels = {
        label for label, count in complete_counts.items()
        if count >= min_complete_per_label
    }
    selected = [
        take for take in takes
        if take.label not in replaced_labels or take.complete_capture
    ]
    return selected, sorted(replaced_labels)


def split_by_label(takes, *, val_fraction=0.15, seed=42):
    """Separación por toma; NO mide generalización a una persona desconocida."""
    grouped = defaultdict(list)
    for take in takes:
        grouped[take.label].append(take)
    rng = np.random.default_rng(seed)
    train, val, excluded = [], [], {}
    for label, group in sorted(grouped.items()):
        if len(group) < 4:
            excluded[label] = len(group)
            continue
        shuffled = [group[int(i)] for i in rng.permutation(len(group))]
        val_count = max(1, min(len(group) - 2, round(len(group) * val_fraction)))
        val.extend(shuffled[:val_count])
        train.extend(shuffled[val_count:])
    return train, val, excluded


class SequenceDataset(Dataset):
    def __init__(self, takes, labels):
        label_ids = {label: i for i, label in enumerate(labels)}
        self.items = [
            (
                torch.from_numpy(sequence_compact_to_gnn(
                    take.frames, normalize=True, preprocess=TRAJECTORY_PREPROCESS,
                )),
                label_ids[take.label],
            )
            for take in takes
        ]

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        return self.items[index]


def collate_sequences(batch):
    lengths = torch.tensor([len(frames) for frames, _ in batch], dtype=torch.long)
    padded = torch.zeros(len(batch), int(lengths.max()), 42, 4, dtype=torch.float32)
    for i, (frames, _) in enumerate(batch):
        padded[i, :len(frames)] = frames
    labels = torch.tensor([label for _, label in batch], dtype=torch.long)
    return padded, lengths, labels

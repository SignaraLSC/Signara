"""Audita grabaciones de letras móviles por persona sin modificar el modelo."""

import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from core.gnn_model import GCN_LSTM, SEQ_LEN
from core.preprocess import sequence_compact_to_gnn


ROOT = Path(__file__).resolve().parent
TARGETS = ("G", "H", "J", "S", "Z", "Ñ", "N")
PEOPLE = ("alanis", "juan")


def compact(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return np.asarray([
        np.asarray(frame["lh"] + frame["rh"], dtype=np.float32).reshape(126)
        for frame in data["frames"]
    ])


def resample(frames):
    if len(frames) == SEQ_LEN:
        return frames
    positions = np.linspace(0, len(frames) - 1, SEQ_LEN)
    lo = np.floor(positions).astype(int)
    hi = np.minimum(lo + 1, len(frames) - 1)
    alpha = (positions - lo)[:, None]
    return frames[lo] * (1 - alpha) + frames[hi] * alpha


def stroke(frames):
    # Se mide el recorrido de la muñeca que el preprocesado legacy elimina.
    hand = frames[:, :63].reshape(-1, 21, 3)
    if not np.any(np.linalg.norm(hand[:, 0, :2], axis=1) > 0.01):
        hand = frames[:, 63:].reshape(-1, 21, 3)
    wrist = hand[:, 0, :2]
    valid = np.linalg.norm(wrist, axis=1) > 0.01
    if valid.sum() < 3:
        return 0.0, 0.0, 0.0
    path = wrist[valid]
    span = np.linalg.norm(hand[valid, :, :2] - path[:, None, :], axis=2).max(axis=1)
    scale = max(float(np.median(span)), 0.05)
    travel = float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum() / scale)
    extent = float(np.linalg.norm(np.ptp(path, axis=0)) / scale)
    # El trazado puede venir del dedo aunque la muñeca casi no se mueva.
    tip_paths = hand[valid][:, [4, 8, 12, 16, 20], :2]
    tip_extent = max(float(np.linalg.norm(np.ptp(tip_paths[:, i], axis=0)) / scale)
                     for i in range(tip_paths.shape[1]))
    return travel, extent, tip_extent


def main():
    labels = json.loads((ROOT / "models/labels_gnn.json").read_text(encoding="utf-8"))
    model = GCN_LSTM(n_classes=len(labels))
    model.load_state_dict(torch.load(ROOT / "models/signara_gnn.pt", map_location="cpu", weights_only=True))
    model.eval()
    letter_indices = [i for i, label in enumerate(labels) if len(label) == 1]
    rows = []
    batches = []

    for person in PEOPLE:
        for label in TARGETS:
            for path in sorted((ROOT / "data/raw_full" / person).glob(f"{label}_*.json")):
                frames = compact(path)
                travel, extent, tip_extent = stroke(frames)
                rows.append((person, label, path.name, travel, extent, tip_extent))
                batches.append(sequence_compact_to_gnn(resample(frames), normalize=True))

    # Maria llegó por CSV sin respaldo raw_full; leer solo las letras relevantes.
    maria_csv = ROOT / "data/maria_raw.csv"
    if maria_csv.exists():
        parts = []
        for chunk in pd.read_csv(
            maria_csv,
            usecols=["label", "persona", "muestra", "frame", "id", "mano", "x", "y", "z"],
            chunksize=200_000,
            low_memory=False,
        ):
            part = chunk.loc[chunk["label"].isin(TARGETS) & (chunk["persona"] == "maria")]
            if not part.empty:
                parts.append(part)
        if parts:
            selected = pd.concat(parts, ignore_index=True)
            for (label, sample_id), group in selected.groupby(["label", "muestra"]):
                frames = np.zeros((24, 126), dtype=np.float32)
                frame = group["frame"].to_numpy(dtype=np.int32)
                index = group["mano"].to_numpy(dtype=np.int32) * 63 + group["id"].to_numpy(dtype=np.int32) * 3
                good = (frame >= 0) & (frame < 24) & (index >= 0) & (index < 126)
                for channel, column in enumerate(("x", "y", "z")):
                    frames[frame[good], index[good] + channel] = group[column].to_numpy(dtype=np.float32)[good]
                travel, extent, tip_extent = stroke(frames)
                rows.append(("maria", label, f"{sample_id}", travel, extent, tip_extent))
                batches.append(sequence_compact_to_gnn(frames, normalize=True))

    if not rows:
        print("No hay muestras raw_full.")
        return

    x = torch.from_numpy(np.stack(batches))
    with torch.no_grad():
        probs = torch.cat([
            torch.softmax(model(chunk), dim=1) for chunk in x.split(64)
        ]).numpy()

    grouped = defaultdict(list)
    for row, p in zip(rows, probs):
        person, label, name, travel, extent, tip_extent = row
        winner = labels[int(p.argmax())]
        letters = p[letter_indices]
        letter_mass = float(letters.sum())
        letter_winner = labels[letter_indices[int(letters.argmax())]] if letter_mass >= 0.15 else "IDLE"
        grouped[person, label].append((name, travel, extent, winner, letter_winner, letter_mass, tip_extent))

    for (person, label), entries in grouped.items():
        full = Counter(e[3] for e in entries)
        letters = Counter(e[4] for e in entries)
        travel = np.asarray([e[1] for e in entries])
        extent = np.asarray([e[2] for e in entries])
        tip_extent = np.asarray([e[6] for e in entries])
        print(f"{person:7} {label:2} n={len(entries):3} "
              f"full={full.most_common(4)} letters={letters.most_common(4)} "
              f"path/hand p10/med/p90={np.percentile(travel, [10,50,90]).round(2)} "
              f"extent/hand med={np.median(extent):.2f} "
              f"tip_extent/hand med={np.median(tip_extent):.2f}")


if __name__ == "__main__":
    main()

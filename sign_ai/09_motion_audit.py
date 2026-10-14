"""Diagnóstico offline: movimiento grabado y predicción con gesto completo vs cola."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from core.gnn_model import GCN_LSTM, SEQ_LEN
from core.preprocess import sequence_compact_to_gnn


def resample(frames, length=SEQ_LEN):
    if len(frames) == length:
        return frames
    positions = np.linspace(0, len(frames) - 1, length)
    lo = np.floor(positions).astype(int)
    hi = np.minimum(lo + 1, len(frames) - 1)
    weight = (positions - lo)[:, None]
    return frames[lo] * (1 - weight) + frames[hi] * weight


def compact(frames):
    return np.asarray([
        np.concatenate((np.asarray(frame["lh"]).reshape(-1),
                        np.asarray(frame["rh"]).reshape(-1)))
        for frame in frames
    ], dtype=np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("signs", nargs="*", default=["SI", "NO", "POR_FAVOR", "HOLA"])
    args = parser.parse_args()
    labels = json.loads(Path("models/labels_gnn.json").read_text(encoding="utf-8"))
    model = GCN_LSTM(n_classes=len(labels))
    model.load_state_dict(torch.load("models/signara_gnn.pt", map_location="cpu", weights_only=True))
    model.eval()

    for sign in args.signs:
        recorded = json.loads((Path("animations") / f"{sign}.json").read_text(encoding="utf-8"))
        raw = compact(recorded["frames"])
        wrist = raw[:, :2]
        visible = np.linalg.norm(wrist, axis=1) > 0.01
        wrist = wrist[visible]
        spread = np.ptp(wrist, axis=0) if len(wrist) else np.zeros(2)
        print(f"{sign}: {len(raw)} frames; wrist X/Y range {spread.round(3)}")
        windows = [(f"first{n}", raw[:n]) for n in (8, 12, 18, 24) if n < len(raw)]
        windows += [("complete", raw), ("last24", raw[-SEQ_LEN:])]
        for name, window in windows:
            seq = sequence_compact_to_gnn(resample(window), normalize=True)
            with torch.no_grad():
                probs = torch.softmax(model(torch.from_numpy(seq).unsqueeze(0)), dim=1)[0]
            top = torch.topk(probs, 3)
            choices = [(labels[i], round(float(p), 3)) for i, p in zip(top.indices, top.values)]
            print(f"  {name}: {choices}; normalized wrist X/Y range "
                  f"{np.ptp(seq[:, 0, :2], axis=0).round(3)}")


if __name__ == "__main__":
    main()

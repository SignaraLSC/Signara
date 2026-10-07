"""Auditoría reproducible del dataset usado por el GCN.

No modifica datos ni modelos. Recorre los CSV *_raw.csv en streaming y genera
un informe que permite detectar desbalance, muestras incompletas y etiquetas
que solo provienen de una persona.

Uso desde sign_ai/:
    python 08_dataset_audit.py
"""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
REPORT_DIR = ROOT / "reports"
REPORT_PATH = REPORT_DIR / "dataset_audit.json"

MIN_FRAMES = 8
SEQ_LEN = 24


def audit_files() -> dict:
    files = sorted(DATA_DIR.glob("*_raw.csv"))
    if not files:
        raise FileNotFoundError(f"No hay archivos *_raw.csv en {DATA_DIR}")

    labels = Counter()
    personas = Counter()
    label_personas: dict[str, Counter] = defaultdict(Counter)
    sample_rows: dict[tuple[str, str, str], int] = Counter()
    sample_frames: dict[tuple[str, str, str], set[int]] = defaultdict(set)
    sample_files: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    invalid_rows = Counter()

    for path in files:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            required = {"label", "persona", "muestra", "frame", "id", "mano", "x", "y", "z"}
            missing = required - set(reader.fieldnames or [])
            if missing:
                raise ValueError(f"{path.name}: faltan columnas {sorted(missing)}")

            for line_no, row in enumerate(reader, start=2):
                label = str(row.get("label", "")).strip().upper()
                persona = str(row.get("persona", "")).strip().lower()
                muestra = str(row.get("muestra", "")).strip()
                key = (label, persona, muestra)

                if not label or not persona or not muestra:
                    invalid_rows["campos_vacios"] += 1
                    continue

                try:
                    frame = int(row["frame"])
                    int(row["id"])
                    int(row["mano"])
                    float(row["x"])
                    float(row["y"])
                    float(row["z"])
                except (TypeError, ValueError):
                    invalid_rows["valores_invalidos"] += 1
                    continue

                labels[label] += 1
                personas[persona] += 1
                label_personas[label][persona] += 1
                sample_rows[key] += 1
                sample_frames[key].add(frame)
                sample_files[key].add(path.name)

    by_label: dict[str, dict] = {}
    for label in sorted(label_personas):
        keys = [key for key in sample_rows if key[0] == label]
        frame_counts = [len(sample_frames[key]) for key in keys]
        by_label[label] = {
            "samples": len(keys),
            "rows": labels[label],
            "personas": dict(sorted(label_personas[label].items())),
            "min_frames": min(frame_counts) if frame_counts else 0,
            "max_frames": max(frame_counts) if frame_counts else 0,
            "short_samples": sum(frames < MIN_FRAMES for frames in frame_counts),
            "truncated_by_training": sum(frames > SEQ_LEN for frames in frame_counts),
        }

    short_samples = []
    long_samples = []
    duplicate_keys = []
    for key, frames in sample_frames.items():
        record = {
            "label": key[0],
            "persona": key[1],
            "muestra": key[2],
            "frames": len(frames),
            "rows": sample_rows[key],
            "files": sorted(sample_files[key]),
        }
        if len(frames) < MIN_FRAMES:
            short_samples.append(record)
        if len(frames) > SEQ_LEN:
            long_samples.append(record)
        if len(sample_files[key]) > 1:
            duplicate_keys.append(record)

    report = {
        "config": {
            "min_frames": MIN_FRAMES,
            "training_seq_len": SEQ_LEN,
            "source": str(DATA_DIR),
        },
        "files": [path.name for path in files],
        "totals": {
            "labels": len(by_label),
            "personas": len(personas),
            "samples": len(sample_rows),
            "rows": sum(labels.values()),
        },
        "personas": dict(sorted(personas.items())),
        "labels": by_label,
        "short_samples": sorted(short_samples, key=lambda item: (item["frames"], item["label"])),
        "long_samples": sorted(long_samples, key=lambda item: (-item["frames"], item["label"])),
        "duplicate_sample_keys": duplicate_keys,
        "invalid_rows": dict(invalid_rows),
    }
    return report


def print_summary(report: dict) -> None:
    totals = report["totals"]
    print("\n=== Auditoría del dataset GCN ===")
    print(f"Archivos: {', '.join(report['files'])}")
    print(f"Clases: {totals['labels']} | Personas: {totals['personas']} | "
          f"Muestras: {totals['samples']} | Filas: {totals['rows']}")
    print(f"Muestras cortas (<{MIN_FRAMES} frames): {len(report['short_samples'])}")
    print(f"Muestras que el entrenamiento recorta (>{SEQ_LEN} frames): {len(report['long_samples'])}")
    print(f"Claves de muestra duplicadas entre archivos: {len(report['duplicate_sample_keys'])}")
    print(f"Filas inválidas: {sum(report['invalid_rows'].values())}")
    print("\nClase | muestras | personas | frames min-max | cortas")
    print("-" * 68)
    for label, info in report["labels"].items():
        people = ", ".join(f"{name}:{count}" for name, count in info["personas"].items())
        print(f"{label:14} | {info['samples']:8} | {people:20} | "
              f"{info['min_frames']:2}-{info['max_frames']:<2}          | {info['short_samples']:5}")


if __name__ == "__main__":
    result = audit_files()
    REPORT_DIR.mkdir(exist_ok=True)
    REPORT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print_summary(result)
    print(f"\nInforme guardado en: {REPORT_PATH}")

"""Entrena un GCN+LSTM de duración variable a partir de data/raw_full.

NO modifica signara_gnn.pt ni lee los CSV remuestreados a 24 cuadros.

    cd sign_ai
    python 08_train_sequence.py --audit-only
    python 08_train_sequence.py

El entrenamiento exige nuevas tomas largas; --audit-only permite revisar la
cobertura antes de gastar horas de CPU. Los resultados se guardan en archivos
*_sequence.* separados y la API no los activa automáticamente.
"""

import argparse
from collections import Counter
import json
import math
import os
from pathlib import Path
import random
import sys

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from core.preprocess import TRAJECTORY_PREPROCESS
from core.sequence_dataset import (
    SequenceDataset, collate_sequences, coverage_by_label, load_takes,
    prefer_complete_takes,
    split_by_label,
)
from core.variable_gnn_model import VariableGCNLSTM

ROOT = Path(__file__).resolve().parent

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "raw_full")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "models")
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="Solo para auditoría rápida; no permite entrenar")
    parser.add_argument("--min-long-samples", type=int, default=30,
                        help="Mínimo total de tomas con más de 24 cuadros (predeterminado: 30)")
    parser.add_argument("--require-full", nargs="*", default=[], metavar="SEÑA",
                        help="Señas que requieren al menos --min-full-per-label tomas completas")
    parser.add_argument("--min-full-per-label", type=int, default=10)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)
    if args.limit is not None and (not args.audit_only or args.limit < 1):
        parser.error("--limit solo se permite con --audit-only y debe ser positivo")
    if min(args.epochs, args.batch_size, args.patience) < 1 or args.min_long_samples < 0:
        parser.error("épocas, lote y paciencia deben ser positivos")
    return args


def print_coverage(coverage, rejected):
    total = sum(row["total"] for row in coverage.values())
    long_count = sum(row["longer_than_24"] for row in coverage.values())
    complete = sum(row["complete"] for row in coverage.values())
    print(f"Tomas utilizables: {total} | captura completa: {complete} | >24 cuadros: {long_count}")
    print("Seña              total  completas  >24   personas")
    for label, row in coverage.items():
        print(f"{label:18} {row['total']:5}  {row['complete']:9}  "
              f"{row['longer_than_24']:3}   {', '.join(row['people'])}")
    if rejected:
        print("Tomas descartadas:", dict(rejected))
    return long_count


def guard_coverage(coverage, *, min_long_samples, require_full, min_full_per_label):
    long_count = sum(row["longer_than_24"] for row in coverage.values())
    if long_count < min_long_samples:
        raise RuntimeError(
            f"Solo hay {long_count} tomas con >24 cuadros; se requieren "
            f"{min_long_samples}. Graba tomas nuevas con S inicio / S fin; "
            "08_train_sequence.py no puede recuperar cuadros perdidos."
        )
    missing = {
        label: coverage.get(label, {}).get("complete", 0)
        for label in require_full
        if coverage.get(label, {}).get("complete", 0) < min_full_per_label
    }
    if missing:
        raise RuntimeError(
            f"Faltan tomas completas (mínimo {min_full_per_label} por seña): {missing}"
        )


def train(args):
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, min(os.cpu_count() or 1, 4)))

    print(f"Leyendo JSON completos de {args.data_dir} (NUNCA *_raw.csv)...", flush=True)
    takes, rejected = load_takes(args.data_dir, limit=args.limit)
    coverage = coverage_by_label(takes)
    long_count = print_coverage(coverage, rejected)
    if args.audit_only:
        print("Auditoría terminada. No se entrenó ni se escribió ningún checkpoint.")
        return None
    guard_coverage(coverage, min_long_samples=args.min_long_samples,
                   require_full=[s.strip().upper() for s in args.require_full],
                   min_full_per_label=args.min_full_per_label)

    takes, replaced_labels = prefer_complete_takes(
        takes, min_complete_per_label=args.min_full_per_label,
    )
    print(f"Clases regrabadas que ya usan SOLO tomas completas: {replaced_labels}")
    selected_coverage = coverage_by_label(takes)

    train_takes, val_takes, excluded = split_by_label(takes, seed=args.seed)
    if excluded:
        print(f"Etiquetas con menos de 4 tomas excluidas: {excluded}")
    labels = sorted({take.label for take in train_takes})
    if len(labels) < 2:
        raise RuntimeError("Se necesitan al menos dos clases con cuatro tomas cada una")
    expected_path = ROOT / "models" / "labels_gnn.json"
    if expected_path.exists():
        expected = set(json.loads(expected_path.read_text(encoding="utf-8")))
        missing_labels = sorted(expected - set(labels))
        if missing_labels:
            raise RuntimeError(
                f"raw_full no cubre estas clases del modelo actual: {missing_labels}. "
                "No se publicará un modelo que pierda vocabulario."
            )

    print(f"Entrenamiento: {len(train_takes)} | validación: {len(val_takes)} | clases: {len(labels)}")
    print("Validación por toma: puede compartir firmante con entrenamiento; "
          "NO mide rendimiento con personas nuevas ni reemplaza pruebas en cámara.")
    train_ds = SequenceDataset(train_takes, labels)
    val_ds = SequenceDataset(val_takes, labels)
    train_dl = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                          num_workers=0, collate_fn=collate_sequences)
    val_dl = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                        num_workers=0, collate_fn=collate_sequences)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = VariableGCNLSTM(len(labels)).to(device)
    counts = Counter(take.label for take in train_takes)
    weights = torch.tensor([1 / math.sqrt(counts[label]) for label in labels],
                           dtype=torch.float32, device=device)
    weights /= weights.mean()
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=5, min_lr=1e-5,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    partial = args.output_dir / "signara_gnn_sequence.pt.partial"
    best_acc, best_loss, best_epoch, stale = -1.0, float("inf"), 0, 0
    best_per_class = {}
    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_sum = correct = 0
        for frames, lengths, targets in train_dl:
            frames, targets = frames.to(device), targets.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(frames, lengths)
            loss = criterion(logits, targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            loss_sum += loss.item() * len(targets)
            correct += int((logits.argmax(1) == targets).sum())

        model.eval()
        val_loss = val_correct = 0
        per_class = {label: [0, 0] for label in labels}
        with torch.inference_mode():
            for frames, lengths, targets in val_dl:
                frames, targets = frames.to(device), targets.to(device)
                logits = model(frames, lengths)
                val_loss += criterion(logits, targets).item() * len(targets)
                predictions = logits.argmax(1)
                val_correct += int((predictions == targets).sum())
                for target, prediction in zip(targets.tolist(), predictions.tolist()):
                    row = per_class[labels[target]]
                    row[1] += 1
                    row[0] += int(target == prediction)
        avg_loss = val_loss / len(val_ds)
        acc = val_correct / len(val_ds)
        scheduler.step(avg_loss)
        print(f"Época {epoch:03}/{args.epochs}: train={correct/len(train_ds):.1%} "
              f"val={acc:.1%} val_loss={avg_loss:.4f}", flush=True)
        if acc > best_acc or (acc == best_acc and avg_loss < best_loss):
            best_acc, best_loss, best_epoch, stale = acc, avg_loss, epoch, 0
            best_per_class = {label: {"correct": ok, "total": count}
                              for label, (ok, count) in per_class.items()}
            torch.save(model.state_dict(), partial)
        else:
            stale += 1
            if stale >= args.patience:
                print(f"Parada temprana tras {stale} épocas sin mejora.")
                break

    model_path = args.output_dir / "signara_gnn_sequence.pt"
    labels_path = args.output_dir / "labels_gnn_sequence.json"
    meta_path = args.output_dir / "signara_gnn_sequence_meta.json"
    metadata = {
        "architecture": "variable_gcn_lstm_v1",
        "preprocess": TRAJECTORY_PREPROCESS,
        "normalize_inputs": True,
        "classes": labels,
        "best_epoch": best_epoch,
        "best_val_acc": round(best_acc * 100, 2),
        "validation": "random_takes_same_signers_possible_not_live_camera",
        "train_samples": len(train_ds),
        "val_samples": len(val_ds),
        "long_samples": long_count,
        "coverage": coverage,
        "selected_coverage": selected_coverage,
        "complete_only_labels": replaced_labels,
        "per_class_val": best_per_class,
    }
    # Primero etiquetas/metadatos, checkpoint al final. La API solo habilita
    # la ruta nueva si existen los tres archivos y SIGNARA_ENABLE_SEQUENCE=1.
    for path, value in ((labels_path, labels), (meta_path, metadata)):
        temporary = path.with_suffix(path.suffix + ".partial")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    os.replace(partial, model_path)
    print(f"Candidato guardado: {model_path} | validación por toma: {best_acc:.1%}")
    print("No se activó en la API. Antes: prueba en cámara con otros firmantes y "
          "revisa confusiones por clase; después habilita SIGNARA_ENABLE_SEQUENCE=1.")
    return metadata


if __name__ == "__main__":
    train(parse_args())

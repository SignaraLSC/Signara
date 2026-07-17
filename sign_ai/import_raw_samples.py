"""
import_raw_samples.py
Importa muestras sueltas en formato raw_full (una por archivo JSON:
{label, persona, muestra, frames:[{face, pose, lh, rh}]} — el mismo que
genera save_raw_full() en 00_capture.py) hacia data/<persona>_raw.csv,
re-numerando las muestras para no chocar con las que ya existan.

Útil cuando alguien manda su carpeta data/raw_full/<persona>/*.json suelta
(por ejemplo, grabó con 00_capture.py en otra máquina) en vez del CSV
acumulado, o cuando manda ambos y hay que evitar contar dos veces.

Uso:
    cd sign_ai
    python import_raw_samples.py <persona> <archivo1.json> [archivo2.json ...]
    python import_raw_samples.py juan "C:\\ruta\\a\\los\\jsons\\*.json"

Filtra automáticamente archivos que no calcen con lo esperado:
  - Demasiado grandes (probablemente un dump completo guardado por error con
    extensión .json en vez de .csv, no una muestra individual).
  - JSON inválido, sin 'label'/'frames', o con una cantidad de frames distinta
    a SEQ_LEN (core/config.py) — mezclar tamaños de secuencia distintos
    corrompería el entrenamiento.
"""

import csv
import glob
import json
import os
import sys

from core.config import SEQ_LEN

DATA_DIR = "data"
RAW_FULL_DIR = os.path.join(DATA_DIR, "raw_full")
RAW_HEADER = ["label", "persona", "muestra", "frame", "id", "mano", "x", "y", "z"]

MAX_REASONABLE_SIZE = 5 * 1024 * 1024  # una muestra real ronda ~1-1.5 MB


def existing_muestra_counters(csv_path):
    """Lee el *_raw.csv de destino (si ya existe) y arma {label: siguiente_muestra}."""
    counters = {}
    if not os.path.exists(csv_path):
        return counters
    with open(csv_path, "r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            label = row.get("label")
            try:
                m = int(row["muestra"])
            except (ValueError, KeyError, TypeError):
                continue
            counters[label] = max(counters.get(label, 0), m)
    return {label: m + 1 for label, m in counters.items()}


def main():
    if len(sys.argv) < 3:
        print("Uso: python import_raw_samples.py <persona> <archivo1.json> [archivo2.json ...]")
        sys.exit(1)

    persona = sys.argv[1].strip().lower()
    paths = []
    for arg in sys.argv[2:]:
        matches = sorted(glob.glob(arg))
        paths.extend(matches if matches else [arg])

    os.makedirs(DATA_DIR, exist_ok=True)
    csv_path = os.path.join(DATA_DIR, f"{persona}_raw.csv")
    write_header = not os.path.exists(csv_path)
    muestra_counters = existing_muestra_counters(csv_path)

    out_dir = os.path.join(RAW_FULL_DIR, persona)
    os.makedirs(out_dir, exist_ok=True)

    imported, skipped = 0, []

    with open(csv_path, "a", newline="", encoding="utf-8") as fdst:
        writer = csv.writer(fdst)
        if write_header:
            writer.writerow(RAW_HEADER)

        for path in paths:
            if not os.path.isfile(path):
                skipped.append((path, "no es un archivo"))
                continue

            size = os.path.getsize(path)
            if size > MAX_REASONABLE_SIZE:
                skipped.append((path, f"{size / 1024 / 1024:.1f} MB — parece un dump completo, no una muestra"))
                continue

            try:
                with open(path, "r", encoding="utf-8") as f:
                    d = json.load(f)
            except json.JSONDecodeError as e:
                skipped.append((path, f"JSON inválido: {e}"))
                continue

            label = str(d.get("label", "")).strip().upper()
            frames = d.get("frames", [])
            if not label or not frames:
                skipped.append((path, "sin 'label' o sin 'frames'"))
                continue
            if len(frames) != SEQ_LEN:
                skipped.append((path, f"{len(frames)} frames, se esperaban {SEQ_LEN} (SEQ_LEN)"))
                continue

            muestra = muestra_counters.get(label, 1)
            muestra_counters[label] = muestra + 1

            for fi, frame in enumerate(frames):
                lh = frame.get("lh") or [[0.0, 0.0, 0.0]] * 21
                rh = frame.get("rh") or [[0.0, 0.0, 0.0]] * 21
                for lid, (x, y, z) in enumerate(lh):
                    writer.writerow([label, persona, muestra, fi, lid, 0, x, y, z])
                for lid, (x, y, z) in enumerate(rh):
                    writer.writerow([label, persona, muestra, fi, lid, 1, x, y, z])

            with open(os.path.join(out_dir, f"{label}_{muestra}.json"), "w", encoding="utf-8") as f:
                json.dump(
                    {"label": label, "persona": persona, "muestra": muestra, "frames": frames},
                    f, separators=(",", ":"),
                )
            imported += 1

    print(f"\nOK: {imported} muestras importadas -> {csv_path}")
    print(f"   Respaldo full-body -> {out_dir}\\")
    if skipped:
        print(f"\n{len(skipped)} archivo(s) omitido(s):")
        for path, reason in skipped:
            print(f"   {os.path.basename(path)}: {reason}")


if __name__ == "__main__":
    main()

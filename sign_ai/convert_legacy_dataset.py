"""
convert_legacy_dataset.py
Convierte un CSV del formato legado de 01_collect.py (una fila por muestra:
label + SEQ_LEN frames de 1659 features aplanadas — cara(478)+pose(33)+
manos(21+21), SIN cabecera) al formato data/<persona>_raw.csv (long format,
solo manos) que consume 06_gnn_train.py.

De paso reconstruye el respaldo full-body en data/raw_full/<persona>/ (igual
que si se hubiera grabado con 00_capture.py), para poder escalar a torso/cara
más adelante sin volver a grabar.

Uso:
    cd sign_ai
    python convert_legacy_dataset.py <archivo.csv> <persona>

Ejemplo:
    python convert_legacy_dataset.py C:\\Users\\USER\\Downloads\\dataset_mariagabriela.csv mariagabriela
"""

import csv
import json
import os
import sys

FACE_N, POSE_N, HAND_N = 478, 33, 21
FACE_LEN, POSE_LEN, HAND_LEN = FACE_N * 3, POSE_N * 3, HAND_N * 3
FRAME_LEN = FACE_LEN + POSE_LEN + HAND_LEN + HAND_LEN  # 1659 (cara+pose+lh+rh)

DATA_DIR = "data"
RAW_FULL_DIR = os.path.join(DATA_DIR, "raw_full")
RAW_HEADER = ["label", "persona", "muestra", "frame", "id", "mano", "x", "y", "z"]


def chunks3(vals):
    return [vals[i:i + 3] for i in range(0, len(vals), 3)]


def parse_frame(vals):
    """vals = 1659 floats de un frame, orden face+pose+lh+rh (igual que el
    extraer_puntos() legado)."""
    face = chunks3(vals[0:FACE_LEN])
    pose = chunks3(vals[FACE_LEN:FACE_LEN + POSE_LEN])
    lh = chunks3(vals[FACE_LEN + POSE_LEN: FACE_LEN + POSE_LEN + HAND_LEN])
    rh = chunks3(vals[FACE_LEN + POSE_LEN + HAND_LEN: FACE_LEN + POSE_LEN + 2 * HAND_LEN])
    return {"face": face, "pose": pose, "lh": lh, "rh": rh}


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
        print("Uso: python convert_legacy_dataset.py <archivo.csv> <persona>")
        sys.exit(1)

    src_path, persona = sys.argv[1], sys.argv[2].strip().lower()
    os.makedirs(DATA_DIR, exist_ok=True)
    csv_path = os.path.join(DATA_DIR, f"{persona}_raw.csv")

    write_header = not os.path.exists(csv_path)
    muestra_counters = existing_muestra_counters(csv_path)

    total_samples = 0
    skipped = 0
    labels_seen = set()

    with open(src_path, "r", newline="", encoding="utf-8") as fsrc, \
         open(csv_path, "a", newline="", encoding="utf-8") as fdst:

        reader = csv.reader(fsrc)
        writer = csv.writer(fdst)
        if write_header:
            writer.writerow(RAW_HEADER)

        for row_num, row in enumerate(reader, start=1):
            if not row:
                continue
            label = row[0].strip().upper()

            try:
                vals = [float(v) for v in row[1:]]
            except ValueError:
                print(f"  fila {row_num}: valores no numéricos, se omite")
                skipped += 1
                continue

            if len(vals) % FRAME_LEN != 0 or len(vals) == 0:
                print(f"  fila {row_num} ({label}): {len(vals)} valores no es múltiplo de {FRAME_LEN}, se omite")
                skipped += 1
                continue

            n_frames = len(vals) // FRAME_LEN
            muestra = muestra_counters.get(label, 1)
            muestra_counters[label] = muestra + 1
            labels_seen.add(label)

            full_frames = []
            for fi in range(n_frames):
                frame_vals = vals[fi * FRAME_LEN: (fi + 1) * FRAME_LEN]
                frame = parse_frame(frame_vals)
                full_frames.append(frame)
                for lid, (x, y, z) in enumerate(frame["lh"]):
                    writer.writerow([label, persona, muestra, fi, lid, 0, x, y, z])
                for lid, (x, y, z) in enumerate(frame["rh"]):
                    writer.writerow([label, persona, muestra, fi, lid, 1, x, y, z])

            out_dir = os.path.join(RAW_FULL_DIR, persona)
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, f"{label}_{muestra}.json"), "w", encoding="utf-8") as f:
                json.dump(
                    {"label": label, "persona": persona, "muestra": muestra, "frames": full_frames},
                    f, separators=(",", ":"),
                )
            total_samples += 1

    print(f"\nOK: {total_samples} muestras convertidas -> {csv_path}")
    if skipped:
        print(f"   {skipped} filas omitidas (revisa los avisos de arriba)")
    print(f"   Respaldo full-body -> {RAW_FULL_DIR}\\{persona}\\")
    print(f"   Clases: {sorted(labels_seen)}")


if __name__ == "__main__":
    main()

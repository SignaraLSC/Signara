"""
00_capture.py — Captura ÚNICA para Signara.

Una sola grabación frente a la cámara produce, al mismo tiempo, TODO lo que el
proyecto necesita:

  1. Entrenamiento del GNN   → data/<persona>_raw.csv   (formato largo que
                               consumen 05_build_graphs.py y 06_gnn_train.py)
  2. Animación del avatar 3D → animations/<SEÑA>.json    (formato de
                               04_record_animations.py, cuerpo completo)
  3. Respaldo escalable      → data/raw_full/<persona>/<SEÑA>_<muestra>.json
                               (cara+pose+manos crudos de CADA muestra, para
                               poder re-entrenar con torso/cara SIN re-grabar)

Idea clave (respuesta a "¿un mismo dataset sirve para reconocer y para animar?"):
  - Reconocer  → necesita MUCHAS muestras variadas  → todas van al *_raw.csv
  - Animar     → necesita UNA toma limpia y canónica → se "promueve" con la tecla A

Uso:
    cd sign_ai
    conda activate signara          (o venv de Python 3.11)
    python 00_capture.py
    > Persona (quién graba): alanis
    > Nombre de la seña:      HOLA
    Controles:
      S = grabar una muestra (30 frames)
      A = marcar la ÚLTIMA muestra como animación canónica del avatar
      ESC = salir

Formato de data/<persona>_raw.csv (una fila por landmark de mano y frame):
    label, persona, muestra, frame, id, mano, x, y, z
      mano: 0 = izquierda (lh), 1 = derecha (rh)
      id:   0..20 (landmarks de MediaPipe por mano)
"""

import csv
import json
import os
import re
import unicodedata

import cv2
import mediapipe as mp
import numpy as np

from core.config import SEQ_LEN
from core.confusion import canonical_label

# ─── Config ───────────────────────────────────────────────────────────────────

DATA_DIR     = "data"
RAW_FULL_DIR = os.path.join(DATA_DIR, "raw_full")
ANIM_DIR     = "animations"
FPS_TARGET   = 30

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ANIM_DIR, exist_ok=True)

RAW_HEADER = ["label", "persona", "muestra", "frame", "id", "mano", "x", "y", "z"]

# ─── MediaPipe ────────────────────────────────────────────────────────────────

mp_holistic = mp.solutions.holistic
mp_draw     = mp.solutions.drawing_utils

holistic = mp_holistic.Holistic(
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6,
    refine_face_landmarks=True,   # 478 puntos de cara (para expresiones futuras del avatar)
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def lm_to_list(landmarks, n):
    """Lista [[x,y,z]] por landmark; ceros si no se detecta."""
    if landmarks:
        return [[lm.x, lm.y, lm.z] for lm in landmarks.landmark]
    return [[0.0, 0.0, 0.0]] * n


def extract_full(results):
    """Cuerpo completo crudo de un frame (para avatar y respaldo escalable)."""
    return {
        "face": lm_to_list(results.face_landmarks, 478),
        "lh":   lm_to_list(results.left_hand_landmarks, 21),
        "rh":   lm_to_list(results.right_hand_landmarks, 21),
        "pose": lm_to_list(results.pose_landmarks, 33),
    }


# ─── Cara recortada (mismos 124 puntos de contorno que dibuja AvatarSigner3D) ──
# Orden EXACTO: óvalo, ojo der, ojo izq, ceja der, ceja izq, labios ext, labios int, nariz.
FACE_OVAL   = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
FACE_R_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246]
FACE_L_EYE  = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466]
FACE_R_BROW = [107,66,105,63,70]
FACE_L_BROW = [336,296,334,293,300]
FACE_LIPS_O = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185]
FACE_LIPS_I = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191]
FACE_NOSE   = [168,6,197,195,5,4]
FACE_KEEP   = (FACE_OVAL + FACE_R_EYE + FACE_L_EYE + FACE_R_BROW + FACE_L_BROW
               + FACE_LIPS_O + FACE_LIPS_I + FACE_NOSE)   # 124 puntos


def slim_face(face):
    """Recorta los 478 puntos de cara a los 124 de contorno (para el avatar)."""
    return [face[i] if i < len(face) else [0.0, 0.0, 0.0] for i in FACE_KEEP]


def normalize_label(raw):
    """Nombre de seña sin acentos, MAYÚSCULAS y con espacios→'_'
    (así 'por favor' → 'POR_FAVOR', que es como lo empareja el frontend).

    Variantes: si una palabra se puede hacer de varias formas GENUINAMENTE
    distintas (no solo estilo/velocidad de quien graba), usa un sufijo
    '_V<N>' al grabar: 'hola v1' -> HOLA_V1, 'hola v2' -> HOLA_V2. El modelo
    las entrena como clases separadas, pero core/confusion.py fusiona sus
    probabilidades a la hora de predecir, así que el resultado final para el
    usuario siempre es la palabra canónica (HOLA), nunca la variante.
    Si la variación es solo de estilo, NO uses sufijo: graba todas las tomas
    bajo el mismo label (así el modelo aprende esa variedad de forma natural)."""
    s = unicodedata.normalize("NFD", raw).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9]+", "_", s.strip())
    return s.upper().strip("_")


def next_muestra_id(csv_path, label):
    """Continúa la numeración de muestras si el CSV ya existe."""
    if not os.path.exists(csv_path):
        return 1
    max_id = 0
    with open(csv_path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("label") == label:
                try:
                    max_id = max(max_id, int(row["muestra"]))
                except (ValueError, KeyError):
                    pass
    return max_id + 1


def append_raw_csv(csv_path, label, persona, muestra, full_frames):
    """
    Escribe las MANOS de la muestra en formato largo (una fila por landmark/frame).
    Escalable: para incluir pose/cara en el entrenamiento en el futuro, basta con
    añadir aquí esos landmarks con su propio rango de `mano`/`id`.
    """
    write_header = not os.path.exists(csv_path)
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(RAW_HEADER)

        for frame_idx, frame in enumerate(full_frames):
            for mano_val, key in ((0, "lh"), (1, "rh")):
                for lid, (x, y, z) in enumerate(frame[key]):
                    writer.writerow([label, persona, muestra, frame_idx, lid, mano_val, x, y, z])


def save_raw_full(persona, label, muestra, full_frames):
    """Respaldo crudo de cuerpo completo por muestra (para escalar sin re-grabar)."""
    out_dir = os.path.join(RAW_FULL_DIR, persona)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{label}_{muestra}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"label": label, "persona": persona, "muestra": muestra, "frames": full_frames},
            f, separators=(",", ":"),
        )


def save_animation(label, full_frames):
    """Animación del avatar. Se guarda SIEMPRE bajo el nombre canónico (sin
    sufijo de variante _V<N>), porque el avatar solo necesita una toma por
    palabra — sin importar cuál variante grabaste, promuévela con 'A' y
    quedará disponible como esa palabra para el frontend.
    Guarda la cara RECORTADA (124 puntos de contorno) que dibuja
    AvatarSigner3D; la cara completa queda en raw_full."""
    token = canonical_label(label)
    frames = [
        {"lh": f["lh"], "rh": f["rh"], "pose": f["pose"], "face": slim_face(f["face"])}
        for f in full_frames
    ]
    path = os.path.join(ANIM_DIR, f"{token}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"token": token, "fps": FPS_TARGET, "frames": frames},
                  f, separators=(",", ":"))
    print(f"⭐ Animación canónica guardada: {path}  ({len(frames)} frames)")


def draw_overlay(frame, results):
    if results.face_landmarks:
        mp_draw.draw_landmarks(
            frame, results.face_landmarks, mp_holistic.FACEMESH_CONTOURS,
            mp_draw.DrawingSpec(color=(200, 200, 200), thickness=1, circle_radius=1),
            mp_draw.DrawingSpec(color=(150, 150, 150), thickness=1),
        )
    if results.pose_landmarks:
        mp_draw.draw_landmarks(frame, results.pose_landmarks, mp_holistic.POSE_CONNECTIONS)
    if results.left_hand_landmarks:
        mp_draw.draw_landmarks(frame, results.left_hand_landmarks, mp_holistic.HAND_CONNECTIONS)
    if results.right_hand_landmarks:
        mp_draw.draw_landmarks(frame, results.right_hand_landmarks, mp_holistic.HAND_CONNECTIONS)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    persona = input("Persona (quién graba, ej: alanis): ").strip().lower() or "anon"
    label   = normalize_label(input("Nombre de la seña (ej: HOLA, POR FAVOR, IDLE): "))

    csv_path = os.path.join(DATA_DIR, f"{persona}_raw.csv")
    muestra  = next_muestra_id(csv_path, label)

    print(f"\n🎥 Captura única — persona: {persona} | seña: {label}")
    print(f"   Muestras se guardan en: {csv_path} (empezando en #{muestra})")
    print("   S   → grabar una muestra (30 frames)")
    print("   A   → marcar la ÚLTIMA muestra como animación del avatar")
    print("   ESC → salir\n")

    cam = cv2.VideoCapture(0)

    grabando = False
    buffer_frames: list[dict] = []   # muestra en curso (cuerpo completo)
    last_sample: list[dict] | None = None  # última muestra completada (para promover a avatar)
    total_guardadas = 0

    while cam.isOpened():
        ret, frame = cam.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = holistic.process(rgb)
        draw_overlay(frame, results)

        if grabando:
            buffer_frames.append(extract_full(results))
            cv2.putText(frame, f"CAPTURANDO {len(buffer_frames)}/{SEQ_LEN}", (20, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

            if len(buffer_frames) >= SEQ_LEN:
                append_raw_csv(csv_path, label, persona, muestra, buffer_frames)
                save_raw_full(persona, label, muestra, buffer_frames)
                last_sample = buffer_frames
                total_guardadas += 1
                print(f"✅ Muestra #{muestra} guardada ({SEQ_LEN} frames) — total sesión: {total_guardadas}")
                muestra += 1
                grabando = False
                buffer_frames = []
        else:
            msg = (f"LISTO [{total_guardadas} muestra(s)] | S=grabar A=avatar"
                   if total_guardadas else "LISTO | S=grabar")
            cv2.putText(frame, msg, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 0), 2)

        cv2.imshow(f"Signara Captura — {label}", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("s"):
            if not grabando:
                grabando = True
                buffer_frames = []
                print("🔴 Grabando muestra...")

        elif key == ord("a"):
            if last_sample:
                save_animation(label, last_sample)
            else:
                print("⚠  Aún no hay ninguna muestra grabada para promover a avatar.")

        elif key == 27:  # ESC
            break

    cam.release()
    cv2.destroyAllWindows()
    holistic.close()

    print(f"\n🎉 Sesión terminada — {total_guardadas} muestra(s) de '{label}' añadidas a {csv_path}")
    print("   Siguiente: python 06_gnn_train.py  (re-entrena el modelo con las nuevas muestras)")


if __name__ == "__main__":
    main()

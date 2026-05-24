"""
01_pipeline.py
Pipeline completo de recolección de datos para Signara.

Guarda dos formatos:
  1. TABLA RAW  → data/{persona}_raw.csv
     columnas: label, persona, muestra, frame, tipo, id, x, y, z
     (una fila por landmark por frame — listo para grafo)

  2. FLAT LSTM  → data/{persona}_dataset.csv
     columnas: label, f0, f1, ..., f49676  (= SEQ_LEN × MAX_FEATURES)
     (compatible con 02_train.py sin cambios)

Uso:
    cd sign_ai
    conda activate signara
    python 01_pipeline.py
"""

import cv2
import csv
import os
import numpy as np
import mediapipe as mp

from core.config import SEQ_LEN, MAX_FEATURES

# ─── MediaPipe ────────────────────────────────────────────────────────────────

mp_holistic  = mp.solutions.holistic
mp_draw      = mp.solutions.drawing_utils

holistic = mp_holistic.Holistic(
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
    refine_face_landmarks=True,
)

# ─── Extractor tabla ─────────────────────────────────────────────────────────

def extraer_tabla(resultados):
    """
    Devuelve lista de tuplas (tipo, id, x, y, z) — una por landmark de MANO.
    Solo lh (21) + rh (21) = 42 filas por frame.
    tipo = 'lh' | 'rh'
    id   = 0..20  (WRIST=0, THUMB_CMC=1 ... PINKY_TIP=20)
    """
    filas = []

    def add(landmarks, tipo, mano):
        # mano: 0 = izquierda, 1 = derecha
        if landmarks:
            for i, lm in enumerate(landmarks.landmark):
                filas.append((tipo, i, mano, lm.x, lm.y, lm.z))
        else:
            for i in range(21):
                filas.append((tipo, i, mano, 0.0, 0.0, 0.0))

    add(resultados.left_hand_landmarks,  'lh', 0)
    add(resultados.right_hand_landmarks, 'rh', 1)

    return filas


def extraer_flat(resultados):
    """
    Devuelve array 1D de MAX_FEATURES para LSTM.
    """
    def get(landmarks, count):
        if landmarks:
            return np.array([[lm.x, lm.y, lm.z] for lm in landmarks.landmark]).flatten()
        return np.zeros(count * 3)

    return np.concatenate([
        get(resultados.face_landmarks,       478),
        get(resultados.pose_landmarks,        33),
        get(resultados.left_hand_landmarks,   21),
        get(resultados.right_hand_landmarks,  21),
    ])

# ─── Setup ───────────────────────────────────────────────────────────────────

os.makedirs("data", exist_ok=True)

print("=" * 50)
print("  SIGNARA — Pipeline de Recolección")
print("=" * 50)

persona = input("\nTu nombre (ej: alanis, carlos): ").lower().strip().replace(" ", "_")

print("\nSeñas a recolectar (separadas por coma).")
print("Ejemplo: HOLA, GRACIAS, POR_FAVOR, NECESITO_AYUDA")
senas_input = input("Señas: ").upper().strip()
senas = [s.strip() for s in senas_input.split(",") if s.strip()]

muestras_objetivo = input(f"\nMuestras por seña [60]: ").strip()
muestras_objetivo = int(muestras_objetivo) if muestras_objetivo.isdigit() else 60

RAW_PATH  = f"data/{persona}_raw.csv"
FLAT_PATH = f"data/{persona}_dataset.csv"

# ─── Cabeceras raw (solo si el archivo no existe) ─────────────────────────────

if not os.path.exists(RAW_PATH):
    with open(RAW_PATH, "w", newline="") as f:
        csv.writer(f).writerow(["label", "persona", "muestra", "frame", "tipo", "id", "mano", "x", "y", "z"])

# ─── Cámara ──────────────────────────────────────────────────────────────────

cam = cv2.VideoCapture(0)

print("\n" + "=" * 50)
print(f"  Persona : {persona}")
print(f"  Señas   : {senas}")
print(f"  Muestras: {muestras_objetivo} por seña")
print("=" * 50)
print("\nControles:")
print("  S   → grabar muestra")
print("  N   → siguiente seña")
print("  ESC → salir\n")

# ─── Loop por señas ──────────────────────────────────────────────────────────

for sena_idx, sena in enumerate(senas):

    # Contar muestras ya guardadas (solo para saber el id siguiente)
    total_existentes = 0
    if os.path.exists(FLAT_PATH):
        with open(FLAT_PATH, "r") as f:
            for row in csv.reader(f):
                if row and row[0] == sena:
                    total_existentes += 1

    print(f"\n{'─'*50}")
    print(f"  SEÑA {sena_idx+1}/{len(senas)}: {sena}")
    print(f"  Ya grabadas: {total_existentes} | Grabando {muestras_objetivo} nuevas")
    print(f"{'─'*50}")

    secuencia_tabla  = []
    secuencia_flat   = []
    grabando         = False
    muestras_nuevas  = 0                          # contador de esta sesión
    muestra_num      = total_existentes + 1       # id incremental

    while True:

        ret, frame = cam.read()
        if not ret:
            break

        frame    = cv2.flip(frame, 1)
        rgb      = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results  = holistic.process(rgb)

        # ── Dibujar ──────────────────────────────────────────────────────────
        if results.face_landmarks:
            mp_draw.draw_landmarks(
                frame, results.face_landmarks, mp_holistic.FACEMESH_TESSELATION,
                mp_draw.DrawingSpec(color=(80, 110, 10), thickness=1, circle_radius=1),
                mp_draw.DrawingSpec(color=(80, 256, 121), thickness=1, circle_radius=1),
            )
        if results.pose_landmarks:
            mp_draw.draw_landmarks(frame, results.pose_landmarks, mp_holistic.POSE_CONNECTIONS)
        if results.left_hand_landmarks:
            mp_draw.draw_landmarks(frame, results.left_hand_landmarks, mp_holistic.HAND_CONNECTIONS)
        if results.right_hand_landmarks:
            mp_draw.draw_landmarks(frame, results.right_hand_landmarks, mp_holistic.HAND_CONNECTIONS)

        # ── HUD ──────────────────────────────────────────────────────────────
        progreso = muestras_nuevas + (muestra_num - muestras_nuevas - 1)
        cv2.rectangle(frame, (0, 0), (640, 60), (0, 0, 0), -1)

        if grabando:
            frame_actual = len(secuencia_flat)
            cv2.putText(frame, f"REC  {sena}  [{frame_actual}/{SEQ_LEN}]",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
        else:
            cv2.putText(frame,
                        f"{sena}  {muestras_nuevas}/{muestras_objetivo}  |  S=grabar  N=siguiente",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 0), 2)

        cv2.imshow(f"Signara Pipeline — {persona}", frame)

        key = cv2.waitKey(1) & 0xFF

        # ── Grabar ───────────────────────────────────────────────────────────
        if key == ord('s') and not grabando:
            grabando       = True
            secuencia_tabla = []
            secuencia_flat  = []
            print(f"🔴 Grabando muestra {muestra_num}...")

        if grabando:
            flat = extraer_flat(results)
            tabla_frame = extraer_tabla(results)

            secuencia_flat.append(flat)
            secuencia_tabla.extend(tabla_frame)  # cada landmark es una fila

            if len(secuencia_flat) == SEQ_LEN:
                grabando = False

                # ── Guardar FLAT (LSTM) ───────────────────────────────────────
                with open(FLAT_PATH, "a", newline="") as f:
                    csv.writer(f).writerow(
                        [sena] + np.array(secuencia_flat).flatten().tolist()
                    )

                # ── Guardar TABLA (grafo) ─────────────────────────────────────
                # secuencia_tabla: lista plana de (tipo, id, x, y, z) por frame
                # Cada frame tiene (478 face + 33 pose + 21 lh + 21 rh) = 553 landmarks
                LANDMARKS_POR_FRAME = 21 + 21  # solo lh + rh
                with open(RAW_PATH, "a", newline="") as f:
                    writer = csv.writer(f)
                    for frame_i in range(SEQ_LEN):
                        inicio = frame_i * LANDMARKS_POR_FRAME
                        chunk  = secuencia_tabla[inicio: inicio + LANDMARKS_POR_FRAME]
                        for (tipo, lid, mano, x, y, z) in chunk:
                            writer.writerow([
                                sena, persona, muestra_num, frame_i,
                                tipo, lid, mano,
                                round(x, 6), round(y, 6), round(z, 6)
                            ])

                muestras_nuevas += 1
                muestra_num        += 1
                print(f"✅ Muestra {muestras_nuevas}/{muestras_objetivo} guardada")

                if muestras_nuevas >= muestras_objetivo:
                    print(f"🎉 ¡{sena} completada!")
                    break

        # ── Siguiente seña ────────────────────────────────────────────────────
        elif key == ord('n'):
            print(f"⏭  Saltando a siguiente seña (tienes {muestras_nuevas}/{muestras_objetivo})")
            break

        # ── Salir ─────────────────────────────────────────────────────────────
        elif key == 27:
            print("\n👋 Saliendo...")
            cam.release()
            cv2.destroyAllWindows()
            holistic.close()
            print(f"\n📁 Raw  → {RAW_PATH}")
            print(f"📁 Flat → {FLAT_PATH}")
            exit(0)

# ─── Fin ─────────────────────────────────────────────────────────────────────

cam.release()
cv2.destroyAllWindows()
holistic.close()

print("\n" + "=" * 50)
print("  ✅ RECOLECCIÓN COMPLETADA")
print("=" * 50)
print(f"\n📁 Tabla (grafo) → {RAW_PATH}")
print(f"📁 Flat  (LSTM)  → {FLAT_PATH}")
print(f"\n👉 Cuando todos terminen, ejecuta:")
print("     python merge_datasets.py")
print("     python 02_train.py")

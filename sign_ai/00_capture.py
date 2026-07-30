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
  - Reconocer  → necesita MUCHAS muestras variadas  → todas van al *_raw.csv,
                 remuestreadas a SEQ_LEN frames (lo que espera el GNN)
  - Animar     → necesita UNA toma limpia y canónica → se "promueve" con la
                 tecla A, y se guarda COMPLETA (sin remuestrear) con su fps
                 real medido, para no perder detalle temporal en señas largas
                 o de 2 manos (el IK del avatar es más estable con más frames)

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
import time
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

# Captura de duración natural: se graba hasta que pulsas S de nuevo y luego se
# remuestrea a SEQ_LEN. Estos límites solo son barreras de seguridad.
MIN_CAPTURE_FRAMES = 6     # menos que esto = seña demasiado corta, se descarta
MAX_CAPTURE_FRAMES = 150   # ~5 s: cierra sola para no crecer sin fin

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
    """Cuerpo completo crudo de un frame (para avatar y respaldo escalable).

    `pose` son landmarks de IMAGEN (x,y normalizados a la cámara; z de
    profundidad poco fiable) — sirven para reconocer.
    `pose_world` son landmarks 3D MÉTRICOS (metros, origen en la cadera, con
    profundidad REAL) — necesarios para mover el avatar 3D correctamente: sin
    esto, una seña hacia la cámara se ve como que "sube" y las dos manos no se
    juntan. Ambos vienen del mismo `holistic.process()`.
    """
    return {
        "face": lm_to_list(results.face_landmarks, 478),
        "lh":   lm_to_list(results.left_hand_landmarks, 21),
        "rh":   lm_to_list(results.right_hand_landmarks, 21),
        "pose": lm_to_list(results.pose_landmarks, 33),
        "pose_world": lm_to_list(results.pose_world_landmarks, 33),
    }


# ─── Calidad de la toma (avisos, no bloquean el guardado) ─────────────────────
# Mismos umbrales que solver.js (handActive/hasWorld) del lab del avatar, para
# que el aviso en captura prediga exactamente lo que le va a pasar al bakeSolver.

def _hand_ok(frame):
    """¿Al menos una mano tiene landmarks reales en este frame?"""
    def active(h):
        return isinstance(h, list) and any(
            (abs(p[0]) + abs(p[1]) + abs(p[2] if len(p) > 2 else 0.0)) > 1e-3 for p in h
        )
    return active(frame.get("lh")) or active(frame.get("rh"))


def _world_ok(frame):
    """¿Trae landmarks 3D métricos (pose_world) usables? Sin esto, el IK del
    avatar cae a 2D (menos preciso, sobre todo la profundidad al cruzar manos)."""
    w = frame.get("pose_world")
    return isinstance(w, list) and any(
        (abs(p[0]) + abs(p[1]) + abs(p[2] if len(p) > 2 else 0.0)) > 1e-4 for p in w
    )


def report_quality(frames):
    """Imprime un aviso si la toma tiene demasiados frames con mala detección.
    No descarta nada — solo avisa para que decidas si conviene regrabar."""
    n = len(frames)
    if n == 0:
        return
    no_hands = sum(1 for f in frames if not _hand_ok(f))
    no_world = sum(1 for f in frames if not _world_ok(f))
    if no_hands / n > 0.3:
        print(f"   ⚠  {no_hands}/{n} frames sin manos detectadas — revisa luz/encuadre; "
              f"considera regrabar esta toma.")
    if no_world / n > 0.3:
        print(f"   ⚠  {no_world}/{n} frames sin profundidad 3D (pose_world) — acércate "
              f"a la cámara o gírate un poco (evita quedar de frente puro); afecta "
              f"sobre todo señas donde las manos se cruzan/juntan.")


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

    La Ñ se conserva como letra propia (no se aplana a N): 'ñ' / 'Ñ' → 'Ñ'.

    Números: '1' / 'num 1' → 'NUM_1' (no dejar solo dígitos: pandas/train
    los mezclan con str y se descartaban como basura).

    Variantes: si una palabra se puede hacer de varias formas GENUINAMENTE
    distintas (no solo estilo/velocidad de quien graba), usa un sufijo
    '_V<N>' al grabar: 'hola v1' -> HOLA_V1, 'hola v2' -> HOLA_V2. El modelo
    las entrena como clases separadas, pero core/confusion.py fusiona sus
    probabilidades a la hora de predecir, así que el resultado final para el
    usuario siempre es la palabra canónica (HOLA), nunca la variante.
    Si la variación es solo de estilo, NO uses sufijo: graba todas las tomas
    bajo el mismo label (así el modelo aprende esa variedad de forma natural)."""
    s = unicodedata.normalize("NFD", raw)
    # Conservar ñ/Ñ antes de tirar marcas diacríticas (NFD: n + combining tilde).
    s = s.replace("\u0303", "\u0001")  # tilde de ñ
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("\u0001", "Ñ").replace("ñ", "Ñ").replace("nÑ", "Ñ").replace("NÑ", "Ñ")
    s = re.sub(r"[^A-Za-z0-9Ññ]+", "_", s.strip())
    s = s.upper().strip("_")
    # Dígitos solos o "NUM_7" ya ok; "1" / "01" → NUM_1.
    if re.fullmatch(r"\d+", s):
        s = f"NUM_{int(s)}"
    elif re.fullmatch(r"NUM_0*\d+", s):
        s = f"NUM_{int(s.split('_', 1)[1])}"
    return s


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


def _lerp_lm(a, b, f):
    """Interpola dos listas de landmarks [[x,y,z],...] del mismo largo."""
    return [[a[j][0] + (b[j][0] - a[j][0]) * f,
             a[j][1] + (b[j][1] - a[j][1]) * f,
             a[j][2] + (b[j][2] - a[j][2]) * f] for j in range(len(a))]


def _lerp_frame(A, B, f):
    return {k: _lerp_lm(A[k], B[k], f) for k in A}


def resample_frames(frames, n):
    """Remuestrea (interpola linealmente) una lista de frames a EXACTAMENTE n.
    Igual que padBuffer() en InterpretScreen.jsx y resample_frames en
    06_gnn_train.py: una seña corta se estira y una larga se comprime a n,
    conservando su forma real, sin relleno de quietud ni cortes. Así la
    muestra de entrenamiento coincide con lo que ve el modelo en vivo."""
    m = len(frames)
    if m == 0 or m == n:
        return frames
    if m == 1:
        return [frames[0] for _ in range(n)]
    out = []
    for i in range(n):
        t = i * (m - 1) / (n - 1)
        lo = int(t)
        hi = min(lo + 1, m - 1)
        out.append(_lerp_frame(frames[lo], frames[hi], t - lo))
    return out


def save_animation(label, full_frames, fps=FPS_TARGET):
    """Animación del avatar. Se guarda SIEMPRE bajo el nombre canónico (sin
    sufijo de variante _V<N>), porque el avatar solo necesita una toma por
    palabra — sin importar cuál variante grabaste, promuévela con 'A' y
    quedará disponible como esa palabra para el frontend.
    Guarda la cara RECORTADA (124 puntos de contorno) que dibuja
    AvatarSigner3D; la cara completa queda en raw_full.

    IMPORTANTE: `full_frames` debe ser la toma COMPLETA tal cual se grabó (sin
    remuestrear a SEQ_LEN) — el bakeSolver del avatar (public/vrm-lab) necesita
    la máxima resolución temporal posible para que el IK no tenga que "saltar"
    entre poses muy distintas de un frame al siguiente, sobre todo en señas de
    2 manos donde se cruzan/juntan. `fps` debe ser la tasa REAL medida durante
    la grabación (no un valor fijo), para que la duración reproducida en el
    avatar coincida con el ritmo real de la seña."""
    token = canonical_label(label)
    frames = [
        {"lh": f["lh"], "rh": f["rh"], "pose": f["pose"],
         "pose_world": f.get("pose_world", [[0.0, 0.0, 0.0]] * 33),
         "face": slim_face(f["face"])}
        for f in full_frames
    ]
    path = os.path.join(ANIM_DIR, f"{token}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"token": token, "fps": round(fps, 2), "frames": frames},
                  f, separators=(",", ":"))
    print(f"⭐ Animación canónica guardada: {path}  ({len(frames)} frames @ {fps:.1f} fps)")


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
    label   = normalize_label(input("Nombre de la seña (ej: HOLA, 1→NUM_1, IDLE): "))
    if not label:
        print("⚠  Nombre vacío."); return
    print(f"   → etiqueta guardada: {label}")

    csv_path = os.path.join(DATA_DIR, f"{persona}_raw.csv")
    muestra  = next_muestra_id(csv_path, label)

    print(f"\n🎥 Captura única — persona: {persona} | seña: {label}")
    print(f"   Muestras se guardan en: {csv_path} (empezando en #{muestra})")
    print("   S   → EMPEZAR a grabar / S otra vez → TERMINAR (duración natural)")
    print(f"        para entrenar se remuestrea a {SEQ_LEN} frames; para el avatar se")
    print("        guarda la toma COMPLETA (más frames = codo/muñeca más estables)")
    print("   A   → marcar la ÚLTIMA muestra como animación del avatar")
    print("   ESC → salir\n")

    cam = cv2.VideoCapture(0)

    grabando = False
    buffer_frames: list[dict] = []   # muestra en curso (cuerpo completo)
    rec_start_t = 0.0                # reloj de pared al pulsar S (para fps real)
    last_sample: list[dict] | None = None    # última muestra COMPLETA (para promover a avatar)
    last_sample_fps = FPS_TARGET             # fps real medido de esa muestra
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
            cv2.putText(frame, f"GRABANDO {len(buffer_frames)}f  (S=terminar)", (20, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            # Aviso EN VIVO (no solo al terminar): si en este instante no se
            # detecta ninguna mano, es la señal más temprana posible de que
            # conviene repetir la toma (mala luz, mano fuera de encuadre...).
            if not results.left_hand_landmarks and not results.right_hand_landmarks:
                cv2.putText(frame, "SIN MANOS DETECTADAS", (20, 85),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        else:
            msg = (f"LISTO [{total_guardadas} muestra(s)] | S=grabar A=avatar"
                   if total_guardadas else "LISTO | S=grabar")
            cv2.putText(frame, msg, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 0), 2)

        cv2.imshow(f"Signara Captura — {label}", frame)
        key = cv2.waitKey(1) & 0xFF

        # Tope de seguridad: si la grabación se pasa de largo, ciérrala sola
        # (mismo camino que pulsar S para terminar).
        if grabando and len(buffer_frames) >= MAX_CAPTURE_FRAMES:
            print(f"⚠  Tope de {MAX_CAPTURE_FRAMES} frames alcanzado; cerrando la muestra.")
            key = ord("s")

        if key == ord("s"):
            if not grabando:
                grabando = True
                buffer_frames = []
                rec_start_t = time.time()
                print("🔴 Grabando… (S de nuevo para terminar)")
            else:
                # TERMINAR.
                grabando = False
                real = len(buffer_frames)
                if real < MIN_CAPTURE_FRAMES:
                    print(f"⚠  Muy corta ({real} frames < {MIN_CAPTURE_FRAMES}); descartada.")
                    buffer_frames = []
                    continue

                # fps REAL de esta toma (para reproducir el avatar al ritmo real,
                # no a un valor fijo). Se acota a un rango sano por si el reloj
                # o la cámara dan un valor absurdo (frame_rate 0, cuelgue, etc.).
                elapsed = max(time.time() - rec_start_t, 1e-6)
                real_fps = real / elapsed
                if not (8.0 <= real_fps <= 60.0):
                    real_fps = FPS_TARGET

                report_quality(buffer_frames)

                # El CSV de entrenamiento (y su respaldo raw_full) SIEMPRE va
                # remuestreado a SEQ_LEN — así lo espera 06_gnn_train.py e
                # import_raw_samples.py (que rechaza tamaños distintos).
                sample = resample_frames(buffer_frames, SEQ_LEN)
                append_raw_csv(csv_path, label, persona, muestra, sample)
                save_raw_full(persona, label, muestra, sample)

                # El AVATAR, en cambio, usa la toma COMPLETA sin comprimir a
                # SEQ_LEN (24 frames aplanaría el detalle temporal de señas
                # largas/de 2 manos, que es justo donde más ayuda tener más
                # muestras para que el IK no salte entre poses muy distintas).
                last_sample = list(buffer_frames)
                last_sample_fps = real_fps

                total_guardadas += 1
                print(f"✅ Muestra #{muestra} guardada — {real} frames reales (~{real_fps:.1f} fps) "
                      f"→ {SEQ_LEN} (para entrenar) — total sesión: {total_guardadas}")
                muestra += 1
                buffer_frames = []

        elif key == ord("a"):
            if last_sample:
                save_animation(label, last_sample, fps=last_sample_fps)
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

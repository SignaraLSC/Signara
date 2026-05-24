"""
07_gnn_predict.py
Predicción en tiempo real — solo acumula frames con movimiento real.
Sin estado "settling" — predice continuamente mientras haces la seña.
"""

import cv2
import json
import subprocess
import collections
import numpy as np
import torch
import mediapipe as mp

from core.gnn_model import GCN_LSTM, N_NODES, N_FEATURES, SEQ_LEN

# ─── Config ───────────────────────────────────────────────────────────────────

MODEL_PATH     = "models/signara_gnn.pt"
LABEL_PATH     = "models/labels_gnn.json"
DEVICE         = "cuda" if torch.cuda.is_available() else "cpu"
UMBRAL         = 0.75        # más estricto para evitar confusiones
STABILITY_NEED = 3           # predicciones iguales para confirmar
NO_HAND_RESET  = 20          # frames sin manos para resetear
SAME_SIGN_WAIT = 30          # frames antes de repetir misma seña
MOVEMENT_MIN   = 0.003       # movimiento mínimo para acumular frame
MIN_FRAMES     = 10          # frames mínimos antes de predecir

# ─── Voz nativa Windows ───────────────────────────────────────────────────────

def hablar(texto):
    cmd = (
        f'Add-Type -AssemblyName System.Speech; '
        f'$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; '
        f'$s.Rate = 1; $s.Speak("{texto}")'
    )
    subprocess.Popen(
        ["powershell", "-WindowStyle", "Hidden", "-Command", cmd],
        creationflags=subprocess.CREATE_NO_WINDOW
    )

# ─── Modelo ───────────────────────────────────────────────────────────────────

with open(LABEL_PATH, encoding="utf-8") as f:
    clases = json.load(f)

model = GCN_LSTM(n_classes=len(clases)).to(DEVICE)
model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
model.eval()
print(f"✅ Modelo listo | clases: {clases}")

# ─── MediaPipe ────────────────────────────────────────────────────────────────

mp_holistic = mp.solutions.holistic
mp_draw     = mp.solutions.drawing_utils

holistic = mp_holistic.Holistic(
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
    refine_face_landmarks=True,
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def frame_to_nodes(results):
    nodes = np.zeros((N_NODES, N_FEATURES), dtype=np.float32)
    if results.left_hand_landmarks:
        for i, lm in enumerate(results.left_hand_landmarks.landmark):
            nodes[i] = [lm.x, lm.y, lm.z, 0.0]
    if results.right_hand_landmarks:
        for i, lm in enumerate(results.right_hand_landmarks.landmark):
            nodes[i + 21] = [lm.x, lm.y, lm.z, 1.0]
    return nodes

def hay_manos(results):
    return (results.left_hand_landmarks is not None
            or results.right_hand_landmarks is not None)

def mov_entre(a, b):
    return np.abs(a[:, :2] - b[:, :2]).mean()

def predecir_buffer(buffer):
    seq = list(buffer)
    # Pad al inicio si hay menos de SEQ_LEN frames
    while len(seq) < SEQ_LEN:
        seq.insert(0, seq[0])
    x = torch.FloatTensor(np.array(seq[-SEQ_LEN:])).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        probs     = torch.softmax(model(x), dim=1)[0]
        conf, idx = probs.max(0)
        return clases[idx.item()], conf.item()

# ─── Estado ───────────────────────────────────────────────────────────────────

cam           = cv2.VideoCapture(0)
# Buffer solo contiene frames con movimiento real
buffer        = collections.deque(maxlen=SEQ_LEN)
pred_hist     = collections.deque(maxlen=STABILITY_NEED)
prev_nodes    = None
no_hand_count = 0
cooldown      = 0
last_sign     = ""
display_txt   = ""
display_conf  = 0.0

print("🎥 Listo — haz una seña — ESC para salir\n")

while cam.isOpened():
    ret, frame = cam.read()
    if not ret:
        break

    frame  = cv2.flip(frame, 1)
    rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = holistic.process(rgb)

    if result.left_hand_landmarks:
        mp_draw.draw_landmarks(frame, result.left_hand_landmarks,
                               mp_holistic.HAND_CONNECTIONS)
    if result.right_hand_landmarks:
        mp_draw.draw_landmarks(frame, result.right_hand_landmarks,
                               mp_holistic.HAND_CONNECTIONS)

    if cooldown > 0:
        cooldown -= 1

    # ── Sin manos ─────────────────────────────────────────────────────────────
    if not hay_manos(result):
        no_hand_count += 1
        if no_hand_count >= NO_HAND_RESET:
            buffer.clear()
            pred_hist.clear()
            prev_nodes  = None
            last_sign   = ""
            display_txt = ""
        prev_nodes = None

    # ── Con manos ─────────────────────────────────────────────────────────────
    else:
        no_hand_count  = 0
        curr_nodes     = frame_to_nodes(result)

        mov = mov_entre(prev_nodes, curr_nodes) if prev_nodes is not None else 0.0
        prev_nodes = curr_nodes

        # Solo acumular frames con movimiento real
        if mov >= MOVEMENT_MIN:
            buffer.append(curr_nodes)
        # (si está quieta la mano no suma al buffer — evita falsos positivos)

        # Predecir cuando hay suficientes frames de movimiento
        if len(buffer) >= MIN_FRAMES and cooldown == 0:
            pred, conf = predecir_buffer(buffer)
            pred_hist.append(pred)

            if (len(pred_hist) == STABILITY_NEED
                    and len(set(pred_hist)) == 1
                    and conf >= UMBRAL
                    and pred != last_sign):

                last_sign    = pred
                display_txt  = pred
                display_conf = conf
                cooldown     = SAME_SIGN_WAIT
                pred_hist.clear()
                buffer.clear()

                texto_voz = pred.replace("_", " ")
                print(f"🤟 {pred}  ({conf*100:.1f}%)")
                hablar(texto_voz)

    # ── HUD ──────────────────────────────────────────────────────────────────
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, 0), (w, 70), (0, 0, 0), -1)

    n = len(buffer)

    # Siempre mostrar el último resultado si existe
    if display_txt:
        cv2.putText(frame, f"{display_txt.replace('_', ' ')}  {display_conf*100:.0f}%",
                    (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 2)
    elif n >= MIN_FRAMES and cooldown == 0:
        cv2.putText(frame, "Detectando...",
                    (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (80, 200, 80), 2)
    elif n > 0:
        cv2.putText(frame, f"Moviendo... {n}/{MIN_FRAMES}",
                    (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (160, 160, 80), 2)
    elif hay_manos(result):
        cv2.putText(frame, "Haz la sena",
                    (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (120, 120, 120), 2)
    else:
        cv2.putText(frame, "Muestra una mano",
                    (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (100, 100, 100), 2)

    # Debug: mostrar confianza actual en tiempo real
    if len(pred_hist) > 0 and n >= MIN_FRAMES:
        cv2.putText(frame, f"hist: {list(pred_hist)}",
                    (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (150, 150, 150), 1)

    cv2.imshow("Signara GNN", frame)
    if cv2.waitKey(1) & 0xFF == 27:
        break

cam.release()
cv2.destroyAllWindows()
holistic.close()

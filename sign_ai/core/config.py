import os

# =========================
# RUTAS
# =========================
DATA_PATH = "data/dataset.csv"
MODEL_PATH = "models/signara_lstm.keras"
LABEL_PATH = "models/labels.json"

os.makedirs("data", exist_ok=True)
os.makedirs("models", exist_ok=True)

# =========================
# IA (DIMENSIONES)
# =========================
# Cara refinada (478) + Pose (33) + Manos (21*2)
# Total = 553 puntos
# 553 * 3 coordenadas (x,y,z) = 1659 features
MAX_FEATURES = 1659

# Frames por seña (usado por 00_capture.py — más frames = más tiempo real de
# captura a FPS_TARGET fijo). Debe coincidir con core/gnn_model.SEQ_LEN y con
# SEQ_LEN en src/components/InterpretScreen.jsx.
SEQ_LEN = 40

# Realtime
UMBRAL_CONFIANZA = 0.70
FRAMES_ESTABILIDAD = 3
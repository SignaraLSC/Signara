import os

# =========================
# CARPETAS DE SALIDA
# =========================
os.makedirs("data", exist_ok=True)
os.makedirs("models", exist_ok=True)

# =========================
# IA (DIMENSIONES)
# =========================
# Cuerpo completo capturado: cara refinada (478) + pose (33) + manos (21*2)
# 553 puntos * 3 coordenadas (x,y,z) = 1659 features.
# El GNN actual solo usa las manos (42 nodos); el resto se guarda para escalar.
MAX_FEATURES = 1659

# Frames por seña (longitud de secuencia). Usado por 00_capture.py.
# DEBE coincidir con core/gnn_model.SEQ_LEN y con SEQ_LEN en
# src/components/InterpretScreen.jsx — si no, /predict rechaza el shape (422).
#
# Bajado de 40 a 24 (2026-07): validado con ablación sobre datos reales
# (juan + mariagabriela, 304 muestras) — val acc se mantuvo en 97.8% con
# 24 frames igual que con 40. Recorta ~40% el tiempo de espera antes de que
# Interpretar reconozca en vivo, sin perder precisión medible en los datos
# actuales. Si el vocabulario crece mucho, vale la pena re-validar.
SEQ_LEN = 24

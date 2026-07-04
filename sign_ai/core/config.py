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

# Frames por seña (longitud de secuencia)
SEQ_LEN = 30

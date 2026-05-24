"""
Signara ML API — GNN + LSTM
El endpoint /predict acepta el mismo formato de siempre (30 × 1659 features).
Internamente extrae lh/rh y los convierte al formato GNN (30 × 42 × 4).

Uso:
    cd sign_ai
    uvicorn api:app --port 8000 --reload
"""

import json
import os
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core.gnn_model import GCN_LSTM, N_NODES, N_FEATURES, SEQ_LEN

# ─── Rutas ────────────────────────────────────────────────────────────────────

GNN_MODEL_PATH = "models/signara_gnn.pt"
GNN_LABEL_PATH = "models/labels_gnn.json"
ANIM_DIR       = Path(__file__).parent / "animations"

UMBRAL_CONFIANZA = 0.70

# ─── Índices del array flat (orden de extractor.py / InterpretScreen.jsx) ────
# face(478×3=1434) + pose(33×3=99) + lh(21×3=63) + rh(21×3=63) = 1659
_LH_START = 1434 + 99         # 1533
_RH_START = _LH_START + 63   # 1596

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Signara ML API — GNN", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

_model: GCN_LSTM | None = None
_labels: list[str] = []


@app.on_event("startup")
async def load_model():
    global _model, _labels

    if not os.path.exists(GNN_MODEL_PATH):
        print(f"⚠  Modelo GNN no encontrado: {GNN_MODEL_PATH}")
        print("   Ejecuta primero: python 06_gnn_train.py")
        return

    if not os.path.exists(GNN_LABEL_PATH):
        print(f"⚠  Labels no encontrados: {GNN_LABEL_PATH}")
        return

    with open(GNN_LABEL_PATH, "r", encoding="utf-8") as f:
        _labels = json.load(f)

    _model = GCN_LSTM(n_classes=len(_labels))
    _model.load_state_dict(torch.load(GNN_MODEL_PATH, map_location="cpu"))
    _model.eval()

    print(f"✅ Modelo GNN cargado — clases: {_labels}")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def compact_to_gnn(frame_compact: np.ndarray) -> np.ndarray:
    """
    Convierte 1 frame compacto de 126 valores (lh 63 + rh 63) al formato GNN (42, 4).
    Nodos 0-20 = lh (mano=0), nodos 21-41 = rh (mano=1).
    Features por nodo: [x, y, z, mano]
    """
    lh = frame_compact[:63].reshape(21, 3)   # (21, 3)
    rh = frame_compact[63:].reshape(21, 3)   # (21, 3)

    nodes = np.zeros((N_NODES, N_FEATURES), dtype=np.float32)
    nodes[:21, :3] = lh
    nodes[:21,  3] = 0.0
    nodes[21:, :3] = rh
    nodes[21:,  3] = 1.0

    return nodes


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    # Formato optimizado: 30 frames × 126 valores (lh 63 + rh 63)
    # Mucho más liviano que los 1659 features originales
    frames: list[list[float]]


class PredictResponse(BaseModel):
    prediction: str
    confidence: float
    is_idle: bool


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": _model is not None,
        "model_type": "GNN+LSTM",
        "labels": _labels,
        "seq_len": SEQ_LEN,
        "umbral_confianza": UMBRAL_CONFIANZA,
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    if _model is None or not _labels:
        raise HTTPException(
            status_code=503,
            detail="Modelo no disponible. Ejecuta 06_gnn_train.py primero.",
        )

    try:
        data = np.array(req.frames, dtype=np.float32)  # (30, 126)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Frames inválidos: {exc}")

    if data.shape[0] != SEQ_LEN or data.shape[1] != 126:
        raise HTTPException(
            status_code=422,
            detail=f"Shape esperado ({SEQ_LEN}, 126), recibido {data.shape}.",
        )

    # Convertir compacto → GNN: (30, 126) → (30, 42, 4)
    gnn_seq = np.stack([compact_to_gnn(data[i]) for i in range(SEQ_LEN)])  # (30, 42, 4)

    x = torch.FloatTensor(gnn_seq).unsqueeze(0)  # (1, 30, 42, 4)

    with torch.no_grad():
        logits = _model(x)                          # (1, n_classes)
        probs  = torch.softmax(logits, dim=1)[0]
        conf, idx = probs.max(0)
        confidence = conf.item()
        prediction = _labels[idx.item()]

    if confidence < UMBRAL_CONFIANZA:
        return PredictResponse(prediction="", confidence=confidence, is_idle=True)

    return PredictResponse(
        prediction=prediction,
        confidence=confidence,
        is_idle=False,
    )


@app.get("/animations")
def list_animations():
    if not ANIM_DIR.exists():
        return {"tokens": []}
    tokens = [p.stem for p in ANIM_DIR.glob("*.json")]
    return {"tokens": sorted(tokens)}


@app.get("/sign/{token}")
def get_sign_animation(token: str):
    token = token.upper()
    path = ANIM_DIR / f"{token}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Animación no encontrada: {token}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

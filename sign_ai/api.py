"""
Signara ML API — GNN + LSTM
El endpoint /predict acepta 30 frames × 126 valores (lh 63 + rh 63).
Internamente convierte al formato GNN (30 × 42 × 4) y predice.

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

from core.gnn_model import GCN_LSTM, SEQ_LEN
from core.confusion import evaluate_prediction
from core.preprocess import sequence_compact_to_gnn

# ─── Rutas ────────────────────────────────────────────────────────────────────

GNN_MODEL_PATH = "models/signara_gnn.pt"
GNN_LABEL_PATH = "models/labels_gnn.json"
GNN_META_PATH  = "models/signara_gnn_meta.json"
ANIM_DIR       = Path(__file__).parent / "animations"

UMBRAL_CONFIANZA = float(os.getenv("SIGNARA_UMBRAL", "0.75"))
MARGEN_TOP2      = float(os.getenv("SIGNARA_MARGEN_TOP2", "0.16"))

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
_normalize_inputs = False


def _load_meta() -> dict:
    if not os.path.exists(GNN_META_PATH):
        return {}
    with open(GNN_META_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.on_event("startup")
async def load_model():
    global _model, _labels, _normalize_inputs

    if not os.path.exists(GNN_MODEL_PATH):
        print(f"⚠  Modelo GNN no encontrado: {GNN_MODEL_PATH}")
        return

    if not os.path.exists(GNN_LABEL_PATH):
        print(f"⚠  Labels no encontrados: {GNN_LABEL_PATH}")
        return

    with open(GNN_LABEL_PATH, "r", encoding="utf-8") as f:
        _labels = json.load(f)

    meta = _load_meta()
    _normalize_inputs = bool(meta.get("normalize_inputs", False))

    _model = GCN_LSTM(n_classes=len(_labels))
    _model.load_state_dict(torch.load(GNN_MODEL_PATH, map_location="cpu"))
    _model.eval()

    print(f"✅ Modelo GNN cargado — clases: {_labels}")
    print(f"   Normalización: {_normalize_inputs} | umbral: {UMBRAL_CONFIANZA} | margen top2: {MARGEN_TOP2}")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    # 30 frames × 126 valores (lh 63 + rh 63)
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
        "margen_top2": MARGEN_TOP2,
        "normalize_inputs": _normalize_inputs,
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    if _model is None or not _labels:
        raise HTTPException(
            status_code=503,
            detail="Modelo no disponible.",
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

    gnn_seq = sequence_compact_to_gnn(data, normalize=_normalize_inputs)

    x = torch.as_tensor(gnn_seq, dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        logits = _model(x)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()

    prediction, confidence, margin = evaluate_prediction(
        _labels,
        probs,
        min_conf=UMBRAL_CONFIANZA,
    )

    if prediction is None:
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

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
import sys
from pathlib import Path

# La consola de Windows usa cp1252 por defecto y los print() con emojis (✅, ⚠)
# lanzan UnicodeEncodeError, lo que TUMBA el arranque de la API (el evento
# startup falla y uvicorn sale). Forzar UTF-8 en la salida lo evita sin
# depender de la variable de entorno PYTHONIOENCODING.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core.gnn_model import GCN_LSTM, SEQ_LEN
from core.confusion import evaluate_prediction
from core.direction_reader import classify_direction
from core.directional_verbs import DIRECTIONAL_VERBS, conjugate
from core.handshape_hints import looks_like_ily
from core.preprocess import sequence_compact_to_gnn

# ─── Rutas ────────────────────────────────────────────────────────────────────

GNN_MODEL_PATH = "models/signara_gnn.pt"
GNN_LABEL_PATH = "models/labels_gnn.json"
GNN_META_PATH  = "models/signara_gnn_meta.json"
ANIM_DIR       = Path(__file__).parent / "animations"

# Umbral más alto por defecto: evita “adivinar” con confianza media.
UMBRAL_CONFIANZA = float(os.getenv("SIGNARA_UMBRAL", "0.80"))
MARGEN_TOP2      = float(os.getenv("SIGNARA_MARGEN_TOP2", "0.18"))

# Conjugación geométrica AYUDA→AYUDAME/… OFF por defecto: sin pose/hombros
# la heurística suele invertir AYUDA ↔ AYUDAME. Activar solo con
# SIGNARA_CONJUGATE=1 cuando haya tomas calibradas.
ENABLE_CONJUGATE = os.getenv("SIGNARA_CONJUGATE", "0").strip().lower() in (
    "1", "true", "yes", "on",
)

# Override manual para probar normalización sin reentrenar. 06_gnn_train.py
# siempre entrena con normalize_inputs=True y escribe signara_gnn_meta.json,
# pero ese archivo nunca se comitió a git — así que sin esta variable, la API
# cae al default False y puede quedar desalineada con cómo se entrenó el
# modelo. Ponla en Render (SIGNARA_NORMALIZE_INPUTS=true) para probar.
_NORMALIZE_OVERRIDE = os.getenv("SIGNARA_NORMALIZE_INPUTS")

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
_normalize_source = "default"


def _load_meta() -> dict:
    if not os.path.exists(GNN_META_PATH):
        return {}
    with open(GNN_META_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _resolve_normalize_inputs(meta: dict) -> tuple[bool, str]:
    """Devuelve (valor, origen) — origen es 'env' o 'meta.json (o default)'.

    Default = True porque 06_gnn_train.py SIEMPRE entrena con normalize_inputs=True.
    Como signara_gnn_meta.json no se versiona, si cayéramos a False la API
    normalizaría distinto al entrenamiento y degradaría las predicciones.
    Override con SIGNARA_NORMALIZE_INPUTS o commiteando un meta.json real.
    """
    if _NORMALIZE_OVERRIDE is not None:
        return _NORMALIZE_OVERRIDE.strip().lower() in ("1", "true", "yes", "on"), "env"
    return bool(meta.get("normalize_inputs", True)), "meta.json (o default)"


@app.on_event("startup")
async def load_model():
    global _model, _labels, _normalize_inputs, _normalize_source

    if not os.path.exists(GNN_MODEL_PATH):
        print(f"⚠  Modelo GNN no encontrado: {GNN_MODEL_PATH}")
        return

    if not os.path.exists(GNN_LABEL_PATH):
        print(f"⚠  Labels no encontrados: {GNN_LABEL_PATH}")
        return

    with open(GNN_LABEL_PATH, "r", encoding="utf-8") as f:
        _labels = json.load(f)

    meta = _load_meta()
    _normalize_inputs, _normalize_source = _resolve_normalize_inputs(meta)

    _model = GCN_LSTM(n_classes=len(_labels))
    _model.load_state_dict(torch.load(GNN_MODEL_PATH, map_location="cpu"))
    _model.eval()

    print(f"✅ Modelo GNN cargado — clases: {_labels}")
    print(f"   Normalización: {_normalize_inputs} (fuente: {_normalize_source}) | "
          f"umbral: {UMBRAL_CONFIANZA} | margen top2: {MARGEN_TOP2} | "
          f"conjugación: {'ON' if ENABLE_CONJUGATE else 'OFF'}")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    # 30 frames × 126 valores (lh 63 + rh 63)
    frames: list[list[float]]


class PredictResponse(BaseModel):
    prediction: str
    confidence: float
    is_idle: bool
    direction: str | None = None  # Fase 2B: solo presente si `prediction` es un verbo direccional


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
        "normalize_source": _normalize_source,
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
        min_margin=MARGEN_TOP2,
    )

    # TE_AMO (forma ILY) el GNN lo confunde mucho con NO/SI en cámara real.
    ily = looks_like_ily(data)
    if ily.get("ily") and "TE_AMO" in _labels:
        te_p = float(probs[_labels.index("TE_AMO")])
        if prediction in ("NO", "SI", None, "IDLE"):
            prediction = "TE_AMO"
            confidence = max(te_p, float(ily.get("score") or 0), UMBRAL_CONFIANZA)

    # "IDLE" es una clase real de entrenamiento (mano en reposo), no lo mismo
    # que is_idle=True (que evaluate_prediction devuelve cuando no hay
    # confianza suficiente en NINGUNA clase). Sin este chequeo, una mano
    # quieta se reconoce y se muestra/dice como si fuera una seña más.
    if prediction is None or prediction == "IDLE":
        return PredictResponse(prediction="", confidence=confidence, is_idle=True)

    # Fase 2B (opcional): conjugación geométrica. Por defecto OFF —
    # sin calibrar invertía AYUDA ↔ AYUDAME en uso real.
    direction = None
    if ENABLE_CONJUGATE and prediction in DIRECTIONAL_VERBS:
        direction = classify_direction(data)["direction"]
        prediction = conjugate(prediction, direction)

    return PredictResponse(
        prediction=prediction,
        confidence=confidence,
        is_idle=False,
        direction=direction,
    )


@app.get("/animations")
def list_animations():
    if not ANIM_DIR.exists():
        return {"tokens": []}
    tokens = [
        p.stem
        for p in ANIM_DIR.glob("*.json")
        if p.stem.upper() != "IDLE" and ".prev" not in p.stem.lower()
    ]
    return {"tokens": sorted(tokens)}


@app.get("/sign/{token}")
def get_sign_animation(token: str):
    token = token.upper()
    path = ANIM_DIR / f"{token}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Animación no encontrada: {token}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

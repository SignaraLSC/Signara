"""
Signara ML API — GNN + LSTM.
/predict mantiene el checkpoint de 24 cuadros. /predict/sequence recibe el
recorrido completo (6..180 cuadros) cuando existe un checkpoint compatible.

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
from core.handshape_hints import looks_like_ily, resolve_como_familia
from core.preprocess import LEGACY_PREPROCESS, MOTION_PREPROCESS, TRAJECTORY_PREPROCESS, sequence_compact_to_gnn
from core.variable_gnn_model import VariableGCNLSTM
from core.hybrid_recognizer import recognize_hybrid

# ─── Rutas ────────────────────────────────────────────────────────────────────

MODEL_VARIANT = os.getenv("SIGNARA_MODEL_VARIANT", "legacy").strip().lower()
if MODEL_VARIANT not in ("legacy", "motion"):
    raise ValueError("SIGNARA_MODEL_VARIANT debe ser legacy o motion")
_model_suffix = "_motion" if MODEL_VARIANT == "motion" else ""
GNN_MODEL_PATH = f"models/signara_gnn{_model_suffix}.pt"
GNN_LABEL_PATH = f"models/labels_gnn{_model_suffix}.json"
GNN_META_PATH  = f"models/signara_gnn{_model_suffix}_meta.json"
ANIM_DIR       = Path(__file__).parent / "animations"

# Umbral más alto por defecto: evita “adivinar” con confianza media.
UMBRAL_CONFIANZA = float(os.getenv("SIGNARA_UMBRAL", "0.80"))
MARGEN_TOP2      = float(os.getenv("SIGNARA_MARGEN_TOP2", "0.18"))

# Fase 2B — conjugación geométrica (AYUDA→AYUDAME/…). ON por defecto
# tras calibración 2026-07 (adelante=AYUDA, pecho=AYUDAME, barrido=AYUDANOS).
# Desactivar: SIGNARA_CONJUGATE=0
ENABLE_CONJUGATE = os.getenv("SIGNARA_CONJUGATE", "1").strip().lower() in (
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
_preprocess_mode = LEGACY_PREPROCESS
_sequence_model: VariableGCNLSTM | None = None
_sequence_labels: list[str] = []
SEQUENCE_MODEL_PATH = "models/signara_gnn_sequence.pt"
SEQUENCE_LABEL_PATH = "models/labels_gnn_sequence.json"
SEQUENCE_META_PATH = "models/signara_gnn_sequence_meta.json"
SEQUENCE_ENABLED = os.getenv("SIGNARA_ENABLE_SEQUENCE", "0").strip().lower() in ("1", "true", "yes", "on")
HYBRID_ENABLED = os.getenv("SIGNARA_ENABLE_HYBRID", "1").strip().lower() in ("1", "true", "yes", "on")
MIN_SEQUENCE_FRAMES = 6
MAX_SEQUENCE_FRAMES = 180


def _is_letter_label(label: str | None) -> bool:
    return bool(label and len(label) == 1 and label in "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ")


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
    global _model, _labels, _normalize_inputs, _normalize_source, _preprocess_mode
    global _sequence_model, _sequence_labels

    _sequence_model = None
    _sequence_labels = []
    # Acotar threads evita que clips pequeños gasten más tiempo coordinando
    # núcleos que ejecutando la GCN, especialmente al consultar dos ramas.
    torch.set_num_threads(max(1, min(os.cpu_count() or 1, 4)))

    if not os.path.exists(GNN_MODEL_PATH):
        print(f"⚠  Modelo GNN no encontrado: {GNN_MODEL_PATH}")
        return

    if not os.path.exists(GNN_LABEL_PATH):
        print(f"⚠  Labels no encontrados: {GNN_LABEL_PATH}")
        return

    with open(GNN_LABEL_PATH, "r", encoding="utf-8") as f:
        _labels = json.load(f)

    meta = _load_meta()
    _preprocess_mode = meta.get("preprocess", LEGACY_PREPROCESS)
    if MODEL_VARIANT == "motion" and _preprocess_mode != MOTION_PREPROCESS:
        raise RuntimeError("El modelo motion requiere metadatos wrist_motion_v1")
    _normalize_inputs, _normalize_source = _resolve_normalize_inputs(meta)

    _model = GCN_LSTM(n_classes=len(_labels))
    _model.load_state_dict(torch.load(GNN_MODEL_PATH, map_location="cpu"))
    _model.eval()

    print(f"✅ Modelo GNN cargado — clases: {_labels}")
    print(f"   Normalización: {_normalize_inputs} ({_preprocess_mode}; fuente: {_normalize_source}) | "
          f"umbral: {UMBRAL_CONFIANZA} | margen top2: {MARGEN_TOP2} | "
          f"conjugación: {'ON' if ENABLE_CONJUGATE else 'OFF'}")

    if not SEQUENCE_ENABLED:
        return
    if not all(os.path.isfile(p) for p in (SEQUENCE_MODEL_PATH, SEQUENCE_LABEL_PATH, SEQUENCE_META_PATH)):
        print("⚠  Modelo de secuencia no disponible; /predict conserva los 24 cuadros.")
        return
    with open(SEQUENCE_META_PATH, encoding="utf-8") as f:
        sequence_meta = json.load(f)
    if (sequence_meta.get("architecture") != "variable_gcn_lstm_v1"
            or sequence_meta.get("preprocess") != TRAJECTORY_PREPROCESS
            or sequence_meta.get("normalize_inputs") is not True):
        raise RuntimeError("Metadatos incompatibles con el modelo de secuencia")
    with open(SEQUENCE_LABEL_PATH, encoding="utf-8") as f:
        labels = json.load(f)
    candidate = VariableGCNLSTM(n_classes=len(labels))
    candidate.load_state_dict(torch.load(SEQUENCE_MODEL_PATH, map_location="cpu"))
    candidate.eval()
    _sequence_labels = labels
    _sequence_model = candidate
    print(f"✅ Modelo de secuencia cargado — {len(labels)} clases; recorrido completo habilitado")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    # /predict: 24 cuadros; /predict/sequence: 6..180 cuadros reales.
    frames: list[list[float]]
    letters_only: bool = False


class PredictResponse(BaseModel):
    prediction: str
    confidence: float
    is_idle: bool
    direction: str | None = None  # Fase 2B: solo presente si `prediction` es un verbo direccional
    recognition_source: str | None = None
    motion_detected: bool | None = None
    evaluated_frames: int | None = None
    preparation_frames: int | None = None
    pose_evidence: dict | None = None


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
        "model_variant": MODEL_VARIANT,
        "preprocess": _preprocess_mode,
        "sequence_model_loaded": _sequence_model is not None,
        "sequence_min_frames": MIN_SEQUENCE_FRAMES,
        "sequence_max_frames": MAX_SEQUENCE_FRAMES,
        "hybrid_model_loaded": HYBRID_ENABLED and MODEL_VARIANT == "legacy" and _model is not None and _sequence_model is not None,
        "recognition_pipeline": "hybrid_shape_motion" if HYBRID_ENABLED and MODEL_VARIANT == "legacy" and _sequence_model is not None and _model is not None else MODEL_VARIANT,
        "fingerspelling_revision": "downward-pair-coherent-pendulum-v11" if HYBRID_ENABLED else None,
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    return await _predict_impl(req, use_sequence=False)


async def _predict_impl(req: PredictRequest, *, use_sequence: bool):
    model = _sequence_model if use_sequence else _model
    labels = _sequence_labels if use_sequence else _labels
    if model is None or not labels:
        raise HTTPException(
            status_code=503,
            detail="Modelo no disponible.",
        )

    try:
        data = np.array(req.frames, dtype=np.float32)  # (30, 126)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Frames inválidos: {exc}")

    valid_length = (
        MIN_SEQUENCE_FRAMES <= len(data) <= MAX_SEQUENCE_FRAMES
        if use_sequence else len(data) == SEQ_LEN
    )
    if data.ndim != 2 or data.shape[1] != 126 or not valid_length:
        raise HTTPException(
            status_code=422,
            detail=(f"Shape esperado ({MIN_SEQUENCE_FRAMES}..{MAX_SEQUENCE_FRAMES}, 126)"
                    if use_sequence else f"Shape esperado ({SEQ_LEN}, 126)") + f", recibido {data.shape}.",
        )
    if not np.isfinite(data).all():
        raise HTTPException(status_code=422, detail="Los landmarks deben ser finitos")

    diagnostics = {}
    if use_sequence and HYBRID_ENABLED and MODEL_VARIANT == "legacy" and _model is not None and _labels:
        hybrid = recognize_hybrid(data, _model, _labels, _sequence_model, _sequence_labels,
                                  normalize=_normalize_inputs, preprocess=_preprocess_mode,
                                  letters_only=req.letters_only)
        diagnostics = {"recognition_source": hybrid.source, "motion_detected": hybrid.motion,
                       "evaluated_frames": hybrid.evaluated_frames,
                       "preparation_frames": hybrid.preparation_frames,
                       "pose_evidence": hybrid.pose_evidence}
        if hybrid.blocked:
            return PredictResponse(prediction="", confidence=0.0, is_idle=True, **diagnostics)
        labels, probs = hybrid.labels, hybrid.probabilities
    else:
        gnn_seq = sequence_compact_to_gnn(
            data, normalize=True if use_sequence else _normalize_inputs,
            preprocess=TRAJECTORY_PREPROCESS if use_sequence else _preprocess_mode,
        )
        x = torch.as_tensor(gnn_seq, dtype=torch.float32).unsqueeze(0)
        with torch.inference_mode():
            logits = model(x, torch.tensor([len(data)])) if use_sequence else model(x)
            probs = torch.softmax(logits, dim=1)[0].cpu().numpy()

    letters_only = bool(req.letters_only)
    min_conf = 0.70 if letters_only else UMBRAL_CONFIANZA
    min_margin = 0.12 if letters_only else MARGEN_TOP2
    raw_top_is_letter = _is_letter_label(labels[int(np.argmax(probs))])
    # Detección automática desde la primera letra, compitiendo contra palabras
    # con probabilidades originales. No renormalizar el alfabeto en este modo.
    if use_sequence and not letters_only and raw_top_is_letter:
        min_conf = 0.70
        min_margin = 0.12

    if letters_only:
        masked = np.zeros_like(probs)
        for i, lab in enumerate(labels):
            if (len(lab) == 1 and lab.replace("Ñ", "N").isalpha()) or lab == "IDLE":
                masked[i] = probs[i]
        total = float(masked.sum())
        # El modo letras no debe convertir un residuo de una clase léxica en
        # una letra "segura": 0.20 de masa alfabética podía acabar como Z
        # al 100 % tras renormalizar, aun cuando el modelo prefería otra seña.
        # Si menos de la mitad de la masa original es alfabética, abstenerse.
        if total < 0.50:
            return PredictResponse(prediction="", confidence=0.0, is_idle=True, **diagnostics)
        probs = masked / total
        n_index = labels.index('N') if 'N' in labels else -1
        if n_index >= 0 and int(np.argmax(probs)) == n_index:
            n_confidence = float(probs[n_index])
            runner_up = float(np.partition(probs, -2)[-2])
            if n_confidence >= 0.66 and n_confidence - runner_up >= 0.25:
                min_conf = 0.66

    prediction, confidence, margin = evaluate_prediction(
        labels,
        probs,
        min_conf=min_conf,
        min_margin=min_margin,
    )

    # TE_AMO (forma ILY): el GNN lo confunde con NO/SI/IDLE (y a veces otras).
    # Si la geometría dice ILY, forzar TE_AMO — la forma es lo bastante distintiva.
    if not letters_only and not raw_top_is_letter:
        ily = looks_like_ily(data)
        if ily.get("ily") and "TE_AMO" in labels and prediction != "TE_AMO":
            te_idx = labels.index("TE_AMO")
            te_p = float(probs[te_idx])
            ily_score = float(ily.get("score") or 0)
            prediction = "TE_AMO"
            confidence = max(te_p, ily_score, UMBRAL_CONFIANZA * 0.95)

    # COMO_ESTAS ↔ FAMILIA: geo solo si el GNN ya apunta a ese par (o es top-2).
    # No forzar con prediction=None genérico + prob residual (inventaba FAMILIA/COMO).
    if not letters_only and "COMO_ESTAS" in labels and "FAMILIA" in labels:
        como_i = labels.index("COMO_ESTAS")
        fam_i = labels.index("FAMILIA")
        como_p = float(probs[como_i])
        fam_p = float(probs[fam_i])
        order = np.argsort(probs)[::-1]
        top2 = (
            {labels[int(order[0])], labels[int(order[1])]}
            if len(order) > 1
            else {labels[int(order[0])]}
        )
        pair = {"COMO_ESTAS", "FAMILIA"}
        competing = (
            prediction in ("COMO_ESTAS", "FAMILIA")
            or (
                prediction is None
                and bool(top2 & pair)
                and max(como_p, fam_p) >= 0.12
            )
        )
        if competing:
            geo = resolve_como_familia(data)
            pref = geo.get("preferred")
            if pref in ("COMO_ESTAS", "FAMILIA"):
                # GNN dijo FAMILIA → respetar salvo geo COMO muy clara.
                if prediction == "FAMILIA" and pref == "COMO_ESTAS":
                    if float(geo.get("f_shape") or 0) >= 0.35 or float(geo.get("wrist_dist") or 1) <= 0.34:
                        pref = "FAMILIA"
                # GNN dijo COMO → corregir a FAMILIA si hay forma F / manos juntas.
                if prediction == "COMO_ESTAS" and (
                    float(geo.get("f_shape") or 0) >= 0.40
                    or float(geo.get("wrist_dist") or 1) <= 0.30
                ):
                    pref = "FAMILIA"
                # Si el GNN ya eligió con margen claro y la geo no contradice fuerte, respetarlo.
                gnn_top = "COMO_ESTAS" if como_p >= fam_p else "FAMILIA"
                gnn_margin = abs(como_p - fam_p)
                geo_contra = (
                    (gnn_top == "COMO_ESTAS" and float(geo.get("familia") or 0) >= float(geo.get("como") or 0) + 0.18)
                    or (gnn_top == "FAMILIA" and float(geo.get("como") or 0) >= float(geo.get("familia") or 0) + 0.25
                        and float(geo.get("f_shape") or 0) < 0.35)
                )
                if prediction in ("COMO_ESTAS", "FAMILIA") and gnn_margin >= 0.22 and not geo_contra:
                    pref = prediction
                prediction = pref
                confidence = max(
                    float(probs[labels.index(pref)]),
                    float(geo.get("familia" if pref == "FAMILIA" else "como") or 0),
                    UMBRAL_CONFIANZA,
                )

    # "IDLE" es una clase real de entrenamiento (mano en reposo), no lo mismo
    # que is_idle=True (que evaluate_prediction devuelve cuando no hay
    # confianza suficiente en NINGUNA clase). Sin este chequeo, una mano
    # quieta se reconoce y se muestra/dice como si fuera una seña más.
    if prediction is None or prediction == "IDLE":
        return PredictResponse(prediction="", confidence=confidence, is_idle=True, **diagnostics)

    # Fase 2B: conjugación geométrica (AYUDA→AYUDAME/…, TE_AMO→ME_AMAS/…).
    # TE_AMO usa umbrales propios (ILY estático → cita, no inventar ME_AMAS).
    direction = None
    if ENABLE_CONJUGATE and prediction in DIRECTIONAL_VERBS:
        direction = classify_direction(data, verb=prediction)["direction"]
        prediction = conjugate(prediction, direction)

    return PredictResponse(
        prediction=prediction,
        confidence=confidence,
        is_idle=False,
        direction=direction,
        **diagnostics,
    )


@app.post("/predict/sequence", response_model=PredictResponse)
async def predict_sequence(req: PredictRequest):
    """Predicción con recorrido completo; 503 hasta cargar un modelo compatible."""
    return await _predict_impl(req, use_sequence=True)


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

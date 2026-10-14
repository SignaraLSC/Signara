"""No codificar 30 s de padding para una ventana corta de voz real."""
import os
import numpy as np


def compact_features(features, minimum=800, margin=100):
    # faster-whisper añade columnas CERO después de extraer el espectrograma.
    # La voz/silencio REAL tiene valores log-mel: no se recorta por energía,
    # no se suprimen palabras, y se deja margen de contexto adicional.
    active = np.flatnonzero(np.any(features != 0, axis=tuple(range(features.ndim - 1))))
    content = int(active[-1]) + 1 if len(active) else 0
    frames = min(features.shape[-1], max(minimum, ((content + margin + 99) // 100) * 100))
    return np.ascontiguousarray(features[..., :frames])


def enable_short_windows(model):
    if os.environ.get('SIGNARA_SPEECH_FULL_WINDOW') == '1':
        return model
    original = model.encode

    def encode(features):
        return original(compact_features(features))

    model.encode = encode
    return model

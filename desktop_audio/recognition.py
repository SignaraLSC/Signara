"""Configuración compartida de ASR; vocabulario acústico, no sustitución de texto."""

# BASE confunde esta palabra corta y poco frecuente con SE/SER, especialmente
# en voz rápida. Hotwords orienta la búsqueda del decoder sobre el audio real:
# no fuerza una frase, no cambia texto después de transcribir y no es historial.
SPEECH_VOCABULARY = 'sed'


def transcribe_snapshot(model, snapshot, *, vocabulary=True):
    segments, _ = model.transcribe(snapshot.audio, language='es', beam_size=3,
        temperature=0, condition_on_previous_text=False, vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 500},
        hallucination_silence_threshold=1.0, word_timestamps=True,
        hotwords=SPEECH_VOCABULARY if vocabulary else None)
    return segments

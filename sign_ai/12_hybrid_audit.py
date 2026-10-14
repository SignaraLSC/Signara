"""Auditoría de replay del híbrido: no entrena ni modifica pesos/grabaciones.

Estas tomas pueden haber participado en entrenamiento. El resultado NO es una
estimación de precisión en cámara ni con nuevos firmantes.
"""

import argparse
import asyncio
from collections import Counter
import json
from pathlib import Path
import random
import time

import numpy as np

import api
from core.hybrid_recognizer import ALPHABET, MOTION_LETTERS
from core.sequence_dataset import read_take


async def audit(args):
    api.SEQUENCE_ENABLED = True
    api.HYBRID_ENABLED = True
    await api.load_model()
    if not api.health()['hybrid_model_loaded']:
        raise RuntimeError('Se necesitan los checkpoints legacy y sequence compatibles')
    print('REPLAY LOCAL: puede incluir entrenamiento; no equivale a precisión en cámara.', flush=True)
    elapsed = []

    async def predict(frames, *, letters_only=False):
        started = time.perf_counter()
        response = await api.predict_sequence(api.PredictRequest(frames=frames.tolist(), letters_only=letters_only))
        elapsed.append((time.perf_counter() - started) * 1000)
        return response.prediction or 'ABSTENCION'

    rng = random.Random(42)
    for label in sorted(MOTION_LETTERS):
        paths = sorted(args.data_dir.rglob(f'{label}_*.json'))
        rng.shuffle(paths)
        selected = []
        for path in paths:
            take = read_take(path)
            if take.complete_capture:
                selected.append(take)
                if len(selected) >= args.takes_per_letter:
                    break
        if not selected:
            raise RuntimeError(f'No hay captura completa de {label}')
        counts = {key: Counter() for key in ('first_full', 'spelling_full', 'first_double', 'spelling_double')}
        for take in selected:
            for cadence, frames in (('full', take.frames), ('double', np.repeat(take.frames, 2, axis=0))):
                if len(frames) > api.MAX_SEQUENCE_FRAMES:
                    continue
                for mode, alphabet in (('first', False), ('spelling', True)):
                    counts[f'{mode}_{cadence}'][await predict(frames, letters_only=alphabet)] += 1
        print(json.dumps({'letter': label, 'takes': len(selected), 'predictions': counts}, ensure_ascii=False), flush=True)

    for label in ('HOLA', 'COMO_ESTAS', 'SI', 'NO', 'POR_FAVOR', 'GRACIAS', 'BIEN', 'MAL', 'TENGO_SED'):
        payload = json.loads((api.ANIM_DIR / f'{label}.json').read_text(encoding='utf-8'))
        frames = np.asarray([frame['lh'] + frame['rh'] for frame in payload['frames']], dtype=np.float32).reshape(-1, 126)
        print(f'Palabra {label}: {await predict(frames)}', flush=True)

    matches, total, mismatches = 0, 0, []
    for label in sorted(ALPHABET - MOTION_LETTERS):
        paths = sorted(args.data_dir.rglob(f'{label}_*.json'))
        for path in paths[:2]:
            take = read_take(path)
            held = np.repeat(take.frames[-1:], 24, axis=0)
            legacy = await api.predict(api.PredictRequest(frames=held.tolist(), letters_only=True))
            for length in (6, 12, 48):
                hybrid = await predict(np.repeat(take.frames[-1:], length, axis=0), letters_only=True)
                expected = legacy.prediction or 'ABSTENCION'
                total += 1
                matches += hybrid == expected
                if hybrid != expected:
                    mismatches.append((label, length, expected, hybrid))
    print(f'Respuestas estáticas idénticas a legacy: {matches}/{total}; diferencias: {mismatches}', flush=True)
    print(f'Inferencia local mediana={np.median(elapsed):.1f} ms; p95={np.percentile(elapsed, 95):.1f} ms. '
          'No incluye cámara, red ni confirmación de la web.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).parent / 'data' / 'raw_full')
    parser.add_argument('--takes-per-letter', type=int, default=10)
    args = parser.parse_args()
    if args.takes_per_letter < 1:
        parser.error('--takes-per-letter debe ser positivo')
    asyncio.run(audit(args))

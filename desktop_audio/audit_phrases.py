"""Regresión ASR real con voz sintética en archivos; nunca captura ni reproduce."""
import argparse
import json
from pathlib import Path
import unicodedata
import numpy as np
from faster_whisper.audio import decode_audio
from audit_streaming import feed_file
from model_store import load_speech_model
from recognition import transcribe_snapshot
from streaming import SAMPLE_RATE, StableTranscript


def words(text):
    return ''.join(c if c.isalnum() else ' ' for c in
        unicodedata.normalize('NFC', text.casefold())).split()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    model = load_speech_model()
    root = Path(__file__).parent / 'cache/phrase-regression'
    cases = ('sed-normal', 'sed-rapido', 'sed-frase', 'sed-continua',
             'ser', 'sueno', 'seis', 'celos', 'hambre', 'nombre')
    for name in cases:
        path = root / (name + '.wav')
        if not path.is_file():
            raise RuntimeError('Genera las voces de prueba con make_phrase_fixtures.ps1.')
        ledger = StableTranscript()
        emitted = []
        audio = decode_audio(str(path), sampling_rate=SAMPLE_RATE)
        for snapshot in feed_file(audio):
            text = ledger.update(snapshot,
                transcribe_snapshot(model, snapshot, vocabulary=not args.baseline))
            if text: emitted.append(text)
        transcript = ' '.join(emitted)
        tokens = words(transcript)
        print(json.dumps({'case': name, 'baseline': args.baseline,
                          'confirmed': transcript}), flush=True)
        if not args.baseline:
            if name.startswith('sed-'):
                assert tokens.count('sed') == 1, (name, transcript)
                assert 'tengo sed' in ' '.join(tokens), (name, transcript)
                assert 'ser' not in tokens and 'se' not in tokens, (name, transcript)
            else:
                assert 'sed' not in tokens, (name, transcript)
    # Sin voz, el VAD no genera consultas ASR ni transcripciones.
    assert not list(feed_file(np.zeros(SAMPLE_RATE * 3, dtype=np.float32)))
    print('OK: frases auditadas sin captura; no se sustituyo texto.', flush=True)


if __name__ == '__main__': main()

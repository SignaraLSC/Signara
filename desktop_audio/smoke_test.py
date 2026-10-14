"""Prueba opt-in con una frase sintética conocida, sin guardar captura."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unicodedata
import winsound


def main():
    root = Path(__file__).parent
    fixture = root / 'cache' / 'smoke.wav'
    if not fixture.exists():
        raise RuntimeError('Ejecuta make_test_audio.ps1 antes de esta prueba.')
    process = subprocess.Popen([sys.executable, '-u', str(root / 'worker.py'), '--parent-pid', str(os.getpid())],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        creationflags=subprocess.CREATE_NO_WINDOW)
    events = queue.Queue()

    def read():
        for line in process.stdout:
            events.put(json.loads(line))
        events.put({'type': 'exit', 'code': process.wait()})

    threading.Thread(target=read, daemon=True).start()
    try:
        started = False
        transcripts = []
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                event = events.get(timeout=0.5)
            except queue.Empty:
                continue
            if event['type'] in ('error', 'exit'):
                raise RuntimeError(event)
            if event['type'] == 'status':
                print(json.dumps(event, ensure_ascii=True), flush=True)
            if event.get('state') == 'listening' and not started:
                started = True
                print('WASAPI listo; reproduciendo frase sintética de prueba.', flush=True)
                winsound.PlaySound(str(fixture), winsound.SND_FILENAME | winsound.SND_ASYNC)
            if event['type'] == 'transcript':
                transcripts.append(event)
                print(json.dumps(event, ensure_ascii=True), flush=True)
                normalized = ''.join(c for c in unicodedata.normalize('NFD', ' '.join(
                    item['text'].lower() for item in transcripts)) if unicodedata.category(c) != 'Mn')
                if 'hola' in normalized and 'tengo sed' in normalized and 'gracias' in normalized:
                    break
        if not transcripts:
            raise RuntimeError('No llegó ninguna transcripción de la frase conocida.')
        assert 'hola' in normalized and 'tengo sed' in normalized and 'gracias' in normalized, normalized
        silence_deadline = time.monotonic() + 6
        while time.monotonic() < silence_deadline:
            try:
                event = events.get(timeout=0.5)
            except queue.Empty:
                continue
            if event['type'] in ('error', 'transcript', 'exit'):
                raise RuntimeError(f'La pausa generó otro evento: {event}')
        print('OK loopback real -> VAD -> Whisper; pausa sin repeticion.', flush=True)
    finally:
        winsound.PlaySound(None, 0)
        process.stdin.close()
        process.wait(timeout=5)


if __name__ == '__main__':
    main()

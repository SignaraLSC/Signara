"""Medir precarga real, sin START, dispositivos ni conversaciones."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time


def main():
    origin = time.perf_counter()
    process = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('worker.py')),
        '--resident', '--parent-pid', str(os.getpid())], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        creationflags=subprocess.CREATE_NO_WINDOW)
    events = queue.Queue()
    def read():
        for line in process.stdout: events.put(json.loads(line))
        events.put({'type': 'exit'})
    threading.Thread(target=read, daemon=True).start()
    try:
        while True:
            event = events.get(timeout=90)
            if event['type'] in ('error', 'exit'): raise RuntimeError(event)
            assert event['type'] != 'transcript' and event.get('state') != 'listening'
            if event.get('state') == 'prepared':
                print(f'Motor preparado en {time.perf_counter()-origin:.2f}s. Captura NO activada.', flush=True)
                break
        # Con el mismo proceso se acusan pausas; no pedir START ni captar nada.
        assert process.poll() is None
        print('OK: precarga mantiene el proceso listo y no abre entrada de audio.', flush=True)
    finally:
        process.stdin.close()
        process.wait(timeout=5)


if __name__ == '__main__': main()

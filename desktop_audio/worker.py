"""Worker local WASAPI → Silero VAD → Whisper; protocolo JSON por stdout."""
import argparse
import json
import itertools
import math
import os
import queue
import sys
import threading
import time

PROTOCOL = sys.stdout
sys.stdout = sys.stderr  # Ningún print de una dependencia contamina el protocolo.
WRITE_LOCK = threading.Lock()


def emit(kind, **payload):
    with WRITE_LOCK:
        PROTOCOL.write(json.dumps({'type': kind, **payload}, ensure_ascii=True) + '\n')
        PROTOCOL.flush()


def watch_parent(pid):
    """También parar si Windows termina la app antes de ejecutar su cleanup."""
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.PeekNamedPipe.argtypes = (wintypes.HANDLE, wintypes.LPVOID,
        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD))
    kernel.PeekNamedPipe.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        raise RuntimeError('No se pudo verificar la sesión de Signara.')

    pipe = msvcrt.get_osfhandle(sys.stdin.fileno())

    def wait():
        while kernel.WaitForSingleObject(handle, 250) == 0x00000102:  # WAIT_TIMEOUT
            # No leer stdin de forma bloqueante: el redirector de Windows
            # puede retener el lock de E/S e impedir importar librerías nativas.
            if not kernel.PeekNamedPipe(pipe, None, 0, None, None, None):
                break
        kernel.CloseHandle(handle)
        os._exit(0)

    threading.Thread(target=wait, daemon=True).start()


def capture(stop, utterances, publish=emit):
    import numpy as np
    import pyaudiowpatch as pa
    from scipy.signal import resample_poly
    from faster_whisper.vad import get_speech_timestamps
    from streaming import SAMPLE_RATE, StreamingSpeechBuffer

    attempts = 0
    stream_ids = itertools.count(1)
    audio_clock = 0.0
    while not stop.is_set():
        try:
            with pa.PyAudio() as devices:
                device = devices.get_default_wasapi_loopback()
                rate = int(device['defaultSampleRate'])
                channels = int(device['maxInputChannels'])
                frames = round(rate * 0.1)
                pending = queue.Queue(maxsize=40)
                failed = threading.Event()

                def callback(data, _count, _time, status):
                    if stop.is_set():
                        return (None, pa.paComplete)
                    if status:
                        failed.set()
                        return (None, pa.paAbort)
                    try:
                        pending.put_nowait(data)
                    except queue.Full:
                        failed.set()
                        return (None, pa.paAbort)
                    return (None, pa.paContinue)

                buffer = StreamingSpeechBuffer(next_stream=stream_ids.__next__)
                buffer.clock = audio_clock
                history = np.empty(0, dtype=np.float32)
                gcd = math.gcd(rate, SAMPLE_RATE)
                with devices.open(format=pa.paInt16, channels=channels, rate=rate,
                                  input=True, input_device_index=device['index'],
                                  frames_per_buffer=frames, stream_callback=callback):
                    publish('status', state='listening', device=device['name'])
                    opened_at = time.monotonic()
                    next_check = time.monotonic() + 2.0
                    while not stop.is_set():
                        if failed.is_set():
                            raise RuntimeError('La captura perdió cuadros de audio.')
                        # Una instancia nueva vuelve a enumerar salidas, incluidos
                        # audífonos conectados/desconectados durante la llamada.
                        if time.monotonic() >= next_check:
                            with pa.PyAudio() as probe:
                                current = probe.get_default_wasapi_loopback()
                            next_check = time.monotonic() + 2.0
                            if (current['name'], current['defaultSampleRate']) != (device['name'], rate):
                                # No mezclar el final del dispositivo viejo con el nuevo.
                                publish('status', state='device_changed')
                                break
                        try:
                            data = pending.get(timeout=0.15)
                        except queue.Empty:
                            continue
                        if time.monotonic() - opened_at >= 5.0:
                            attempts = 0
                        audio = np.frombuffer(data, dtype=np.int16).reshape(-1, channels)
                        audio = audio.astype(np.float32).mean(axis=1) / 32768.0
                        audio = resample_poly(audio, SAMPLE_RATE // gcd, rate // gcd).astype(np.float32)
                        history = np.concatenate((history, audio))[-round(SAMPLE_RATE * 0.8):]
                        speech = False
                        if np.sqrt(np.mean(audio ** 2)) >= 0.0005:
                            spans = get_speech_timestamps(history, threshold=0.5,
                                min_speech_duration_ms=0, min_silence_duration_ms=100,
                                speech_pad_ms=0)
                            speech = any(span['end'] > len(history) - len(audio) for span in spans)
                        utterance = buffer.feed(audio, speech)
                        audio_clock = buffer.clock
                        if utterance:
                            try:
                                utterances.put_nowait(utterance)
                            except queue.Full:
                                publish('error', message='La transcripción no alcanza el audio. Pausa y vuelve a activar play.')
                                stop.set()
                                return
        except Exception as error:
            attempts += 1
            publish('status', state='reconnecting')
            if attempts >= 3:
                publish('error', message=f'No se pudo capturar la salida de Windows: {error}')
                stop.set()
                return
            stop.wait(1.0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--parent-pid', type=int)
    parser.add_argument('--resident', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise RuntimeError('La captura de audio del PC requiere Windows.')
    emit('status', state='loading')
    if args.parent_pid:
        watch_parent(args.parent_pid)
    from faster_whisper.vad import get_vad_model
    from model_store import load_speech_model
    from streaming import SAMPLE_RATE, SnapshotQueue, StableTranscript
    from recognition import transcribe_snapshot

    resident = None
    if args.resident and not args.prepare:
        from resident import ResidentAudio, read_commands
        resident = ResidentAudio(capture, lambda: SnapshotQueue(maximum=3), StableTranscript, emit)

        def commands():
            try:
                read_commands(resident.request, resident.closed)
            except Exception as error:
                emit('error', message=f'Control del audio: {error}')
            finally:
                resident.close()

        threading.Thread(target=commands, daemon=True).start()

    model = load_speech_model(prepare=args.prepare)
    get_vad_model()
    if args.prepare:
        emit('status', state='prepared')
        return
    # Calentar la primera inferencia ANTES de indicar que play está listo.
    # Audio sintético nulo, ningún texto se publica ni se conserva.
    import numpy as np
    warmup, _ = model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language='es',
        beam_size=3, temperature=0, condition_on_previous_text=False, vad_filter=False)
    list(warmup)
    if resident:
        # Precargar librerías de captura NO abre PyAudio ni ningún dispositivo.
        import pyaudiowpatch  # noqa: F401
        from scipy.signal import resample_poly  # noqa: F401
        resident.mark_prepared()
        try:
            while not resident.closed.is_set():
                session = resident.current()
                if session is None:
                    resident.changed.wait(0.1)
                    resident.changed.clear()
                    continue
                try: utterance = session.pending.get(timeout=0.1)
                except queue.Empty: continue
                if session.stop.is_set(): continue
                segments = transcribe_snapshot(model, utterance)
                text = session.ledger.update(utterance, segments)
                resident.deliver(session, text, utterance)
        finally:
            resident.close()
        return
    stop = threading.Event()
    utterances = SnapshotQueue(maximum=3)
    ledger = StableTranscript()
    recorder = threading.Thread(target=capture, args=(stop, utterances), daemon=True)
    recorder.start()
    identity = 0
    try:
        while not stop.is_set():
            try:
                utterance = utterances.get(timeout=0.2)
            except queue.Empty:
                continue
            segments = transcribe_snapshot(model, utterance)
            text = ledger.update(utterance, segments)
            if text and not stop.is_set():
                identity += 1
                emit('transcript', id=identity, text=text, final=True,
                     start=utterance.start, end=utterance.end, boundary=utterance.boundary)
    finally:
        stop.set()
        recorder.join(timeout=2)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', message=f'Audio del PC: {error}')
        sys.exit(1)

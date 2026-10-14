"""Evaluación offline de un archivo aportado; no captura ni guarda audio."""
import argparse
import itertools
import queue
import threading
import time
import numpy as np
from faster_whisper.audio import decode_audio
from faster_whisper.vad import get_speech_timestamps
from model_store import load_speech_model
from streaming import SAMPLE_RATE, StreamingSpeechBuffer, StableTranscript, SnapshotQueue
from recognition import transcribe_snapshot


def feed_file(audio, realtime=False):
    buffer = StreamingSpeechBuffer(itertools.count(1).__next__)
    origin = time.perf_counter()
    history = np.empty(0, dtype=np.float32)
    for offset in range(0, len(audio) + SAMPLE_RATE, 1600):
        if realtime:
            remaining = origin + (offset + 1600) / SAMPLE_RATE - time.perf_counter()
            if remaining > 0: time.sleep(remaining)
        chunk = audio[offset:offset + 1600]
        if not len(chunk): chunk = np.zeros(1600, dtype=np.float32)
        # Misma decisión VAD online que worker.py, no marcas del futuro.
        history = np.concatenate((history, chunk))[-round(SAMPLE_RATE * 0.8):]
        speech = False
        if np.sqrt(np.mean(chunk ** 2)) >= 0.0005:
            spans = get_speech_timestamps(history, threshold=0.5,
                min_speech_duration_ms=0, min_silence_duration_ms=100, speech_pad_ms=0)
            speech = any(span['end'] > len(history) - len(chunk) for span in spans)
        snapshot = buffer.feed(chunk, speech)
        if snapshot: yield snapshot


def realtime_snapshots(audio):
    pending = SnapshotQueue()
    finished = threading.Event()
    failures = []

    def producer():
        try:
            for snapshot in feed_file(audio, realtime=True): pending.put_nowait(snapshot)
        except Exception as error: failures.append(error)
        finally: finished.set()

    threading.Thread(target=producer, daemon=True).start()
    while True:
        if failures: raise failures[0]
        try:
            yield pending.get(0.1)
        except queue.Empty:
            if finished.is_set(): return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file')
    parser.add_argument('--inspect-words', action='store_true')
    parser.add_argument('--realtime', action='store_true', help='Reproducir el ritmo de captura en memoria, sin sonido ni dispositivos.')
    parser.add_argument('--require-before-end', action='store_true')
    args = parser.parse_args()
    audio = decode_audio(args.file, sampling_rate=SAMPLE_RATE)
    spans = get_speech_timestamps(audio, threshold=0.5, min_speech_duration_ms=0,
                                  min_silence_duration_ms=100, speech_pad_ms=0)
    print(f'Archivo: {len(audio) / SAMPLE_RATE:.2f}s | segmentos de voz: {len(spans)}', flush=True)
    model = load_speech_model()
    warmup, _ = model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language='es',
        beam_size=3, temperature=0, condition_on_previous_text=False, vad_filter=False)
    list(warmup)
    ledger = StableTranscript()
    count = 0
    first_update = None
    final_transcripts = []
    inference_times = []
    voice_end = max((span['end'] for span in spans), default=0) / SAMPLE_RATE
    first_wall = None
    origin = time.perf_counter()
    snapshots = realtime_snapshots(audio) if args.realtime else feed_file(audio)
    for snapshot in snapshots:
        started = time.perf_counter()
        segments = transcribe_snapshot(model, snapshot)
        segments = list(segments)
        if args.inspect_words:
            print(f'snapshot={snapshot.start:.2f}-{snapshot.end:.2f} final={snapshot.final} '
                  + str([(s.text, s.no_speech_prob, s.avg_logprob,
                          [(w.word, round(w.probability, 3), round(w.start, 2), round(w.end, 2))
                           for w in s.words or []]) for s in segments]), flush=True)
        text = ledger.update(snapshot, segments)
        seconds = time.perf_counter() - started
        inference_times.append(seconds)
        if text:
            count += 1
            final_transcripts.append(text)
            if not snapshot.final and first_update is None: first_update = snapshot.end
            wall = time.perf_counter() - origin
            if first_wall is None: first_wall = wall
            print(f'audio_t={snapshot.end:.2f}s boundary={snapshot.boundary} ASR={seconds:.2f}s '
                  + (f'entrega_real={wall:.2f}s ' if args.realtime else '') + f'nuevo={text}', flush=True)
    print(f'Confirmados: {count} | primer envío DURANTE voz: {first_update} | ASR máximo: {max(inference_times, default=0):.2f}s', flush=True)
    print('Texto confirmado: ' + ' '.join(final_transcripts), flush=True)
    if args.realtime:
        print(f'Primera entrega real={first_wall}; fin de voz={voice_end:.2f}s', flush=True)
        if args.require_before_end:
            assert first_wall is not None and first_wall < voice_end, 'No entregó texto antes de terminar la voz'


if __name__ == '__main__': main()

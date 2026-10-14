"""Segmentación acotada; no guarda audio ni comparte estado con el GNN."""
from collections import deque
from dataclasses import dataclass
import queue
import threading
import time
import unicodedata
import numpy as np

SAMPLE_RATE = 16000


@dataclass
class Utterance:
    audio: np.ndarray
    start: float
    end: float
    boundary: str
    stream: int = 0
    final: bool = True


class SpeechBuffer:
    def __init__(self, pause=0.7, maximum=8.0, minimum=0.2, preroll=0.3):
        self.pause = pause
        self.maximum = maximum
        self.minimum = minimum
        self.preroll = preroll
        self.clock = 0.0
        self.reset()

    def reset(self):
        self.before = deque()
        self.before_duration = 0.0
        self.parts = []
        self.duration = self.voiced = self.quiet = 0.0
        self.start = self.clock

    def feed(self, audio, speech):
        duration = len(audio) / SAMPLE_RATE
        self.clock += duration
        if not self.parts and not speech:
            self.before.append(audio)
            self.before_duration += duration
            while self.before and self.before_duration > self.preroll:
                self.before_duration -= len(self.before.popleft()) / SAMPLE_RATE
            return None
        if not self.parts:
            self.parts = list(self.before)
            self.duration = self.before_duration
            self.start = self.clock - duration - self.duration
            self.before.clear()
            self.before_duration = 0.0
        self.parts.append(audio)
        self.duration += duration
        self.voiced += duration if speech else 0.0
        self.quiet = 0.0 if speech else self.quiet + duration
        boundary = 'pause' if self.quiet >= self.pause else 'limit'
        if self.quiet < self.pause and self.duration < self.maximum:
            return None
        # No solapar fragmentos ya enviados: evita reproducir el final dos veces.
        utterance = Utterance(np.concatenate(self.parts), self.start, self.clock, boundary)
        valid = self.voiced >= self.minimum
        self.reset()
        return utterance if valid else None


def reliable_segment(segment):
    return (segment.no_speech_prob < 0.6 and segment.avg_logprob >= -1.0
            and segment.compression_ratio <= 2.4)


def confirmed_text(segments):
    """Descartar salidas sin evidencia acústica, no deduplicar texto legítimo."""
    return ' '.join(
        segment.text.strip() for segment in segments
        if segment.text.strip()
        and reliable_segment(segment)
    ).strip()


class StreamingSpeechBuffer:
    """Snapshots solapados durante voz; una pausa cierra la cola pendiente."""
    def __init__(self, next_stream, interval=0.8, first=1.2, pause=0.7,
                 maximum=12.0, minimum=0.2, preroll=0.3):
        self.next_stream = next_stream
        self.interval, self.first, self.pause = interval, first, pause
        self.maximum, self.minimum, self.preroll = maximum, minimum, preroll
        self.clock = 0.0
        self.reset()

    def reset(self):
        self.parts = deque()
        self.before = deque()
        self.before_duration = self.duration = self.voiced = self.quiet = 0.0
        self.start = self.clock
        self.stream = None
        self.next_update = None

    def feed(self, audio, speech):
        duration = len(audio) / SAMPLE_RATE
        self.clock += duration
        if self.stream is None and not speech:
            self.before.append(audio)
            self.before_duration += duration
            while self.before and self.before_duration > self.preroll:
                self.before_duration -= len(self.before.popleft()) / SAMPLE_RATE
            return None
        if self.stream is None:
            self.stream = self.next_stream()
            self.parts.extend(self.before)
            self.duration = self.before_duration
            self.start = self.clock - duration - self.duration
            self.next_update = self.start + self.first
            self.before.clear()
            self.before_duration = 0.0
        self.parts.append(audio)
        self.duration += duration
        self.voiced += duration if speech else 0.0
        self.quiet = 0.0 if speech else self.quiet + duration
        # Ventana de audio acotada, NO fragmentos inconexos ni cortes de palabra.
        while self.parts and self.duration > self.maximum + 1e-6:
            removed = len(self.parts.popleft()) / SAMPLE_RATE
            self.duration -= removed
            self.start += removed
        final = self.quiet + 1e-6 >= self.pause
        if not final and self.clock + 1e-6 < self.next_update:
            return None
        if self.voiced < self.minimum:
            if final: self.reset()
            return None
        snapshot = Utterance(np.concatenate(self.parts), self.start, self.clock,
                             'pause' if final else 'update', self.stream, final)
        # Usar reloj absoluto: el recorte de la ventana no pospone actualizaciones.
        self.next_update = self.clock + self.interval
        if final: self.reset()
        return snapshot


class SnapshotQueue:
    """Sustituir parciales viejos; nunca descartar el cierre de una frase."""
    def __init__(self, maximum=3):
        self.maximum = maximum
        self.items = deque()
        self.condition = threading.Condition()

    def put_nowait(self, snapshot):
        with self.condition:
            if self.items and self.items[-1].stream == snapshot.stream and not self.items[-1].final:
                self.items[-1] = snapshot
            else:
                if len(self.items) >= self.maximum: raise queue.Full
                self.items.append(snapshot)
            self.condition.notify()

    def get(self, timeout):
        deadline = time.monotonic() + timeout
        with self.condition:
            while not self.items:
                remaining = deadline - time.monotonic()
                if remaining <= 0: raise queue.Empty
                self.condition.wait(remaining)
            return self.items.popleft()


@dataclass
class TimedWord:
    text: str
    start: float
    end: float
    probability: float = 1.0

    @property
    def key(self):
        # Ignorar puntuación/mayúsculas, conservando diacríticos y la ñ.
        return ''.join(c for c in unicodedata.normalize('NFC', self.text.casefold()) if c.isalnum())


class StableTranscript:
    """LocalAgreement-2: emitir un prefijo común, nunca la hipótesis completa."""
    def __init__(self, tail=0.35):
        self.tail = tail
        self.stream = None
        self.previous = []
        self.committed_end = float('-inf')
        self.last_committed = None

    def update(self, snapshot, segments):
        if self.stream != snapshot.stream:
            self.stream = snapshot.stream
            self.previous = []
            self.committed_end = float('-inf')
            self.last_committed = None
        if self.previous and self.previous[0].start < snapshot.start - 0.3:
            raise RuntimeError('La transcripción no alcanza el audio continuo. Pausa y vuelve a activar play.')
        words = []
        for segment in segments:
            if not reliable_segment(segment): continue
            for item in segment.words or []:
                if not item.word.strip(): continue
                word = TimedWord(item.word.strip(), snapshot.start + item.start,
                                 snapshot.start + item.end, item.probability)
                if word.end <= self.committed_end + 0.08 or word.start < self.committed_end - 0.2:
                    continue
                if (self.last_committed and word.key == self.last_committed.key
                    and abs(word.start - self.last_committed.start) < 0.2
                    and abs(word.end - self.last_committed.end) < 0.3):
                    continue
                words.append(word)
        count = 0
        if snapshot.final:
            # Al cerrarse la voz, confirmar solo el sufijo que no se envió aún.
            count = len(words)
        else:
            for before, word in zip(self.previous, words):
                if (word.probability < 0.25 or word.key != before.key or abs(word.start - before.start) > 0.65
                    or abs(word.end - before.end) > 0.65 or word.end > snapshot.end - self.tail):
                    break
                count += 1
        committed = words[:count]
        self.previous = words[count:]
        if committed:
            self.last_committed = committed[-1]
            self.committed_end = committed[-1].end
        return ' '.join(word.text for word in committed).strip()

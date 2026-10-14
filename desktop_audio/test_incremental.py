import itertools
import queue
import unittest
from types import SimpleNamespace
import numpy as np
from streaming import (SAMPLE_RATE, Utterance, StreamingSpeechBuffer,
                       SnapshotQueue, StableTranscript)


def snapshot(end, stream=1, final=False, start=0):
    return Utterance(np.zeros(1), start, end, 'pause' if final else 'update', stream, final)


def segments(*words, noise=0.1):
    return [SimpleNamespace(no_speech_prob=noise, avg_logprob=-0.2, compression_ratio=1,
        words=[SimpleNamespace(word=text, start=start, end=end, probability=0.9)
               for text, start, end in words])]


class IncrementalTests(unittest.TestCase):
    def buffer(self, **options):
        return StreamingSpeechBuffer(itertools.count(1).__next__, **options)

    def test_continuous_speech_produces_updates_before_any_pause(self):
        buffer = self.buffer()
        events = [buffer.feed(np.ones(1600, dtype=np.float32), True) for _ in range(60)]
        updates = [event for event in events if event]
        self.assertGreaterEqual(len(updates), 6)
        self.assertAlmostEqual(updates[0].end, 1.2)
        self.assertTrue(all(not item.final for item in updates))
        self.assertTrue(all(item.stream == 1 for item in updates))

    def test_window_scroll_does_not_delay_next_update(self):
        buffer = self.buffer(maximum=3.0)
        updates = [buffer.feed(np.ones(1600, dtype=np.float32), True) for _ in range(200)]
        updates = [item for item in updates if item]
        self.assertGreater(len(updates), 20)
        self.assertTrue(all(len(item.audio) <= SAMPLE_RATE * 3 for item in updates))
        self.assertAlmostEqual(updates[-1].end - updates[-2].end, 0.8)
        self.assertGreater(updates[-1].start, 15)

    def test_silence_and_final_are_not_replayed(self):
        buffer = self.buffer()
        silence = np.zeros(1600, dtype=np.float32)
        self.assertTrue(all(buffer.feed(silence, False) is None for _ in range(200)))
        for _ in range(16): buffer.feed(silence + 1, True)
        updates = [buffer.feed(silence, False) for _ in range(100)]
        finals = [item for item in updates if item and item.final]
        self.assertEqual(len(finals), 1)
        next_items = [buffer.feed(silence + 1, True) for _ in range(12)]
        self.assertEqual(next(item for item in next_items if item).stream, 2)

    def test_partial_replacement_keeps_final_and_stream_order(self):
        pending = SnapshotQueue(maximum=2)
        pending.put_nowait(snapshot(1))
        pending.put_nowait(snapshot(2))
        pending.put_nowait(snapshot(3, final=True))
        pending.put_nowait(snapshot(4, stream=2))
        with self.assertRaises(queue.Full): pending.put_nowait(snapshot(5, stream=3))
        self.assertEqual(pending.get(0.1).end, 3)
        self.assertEqual(pending.get(0.1).stream, 2)
        with self.assertRaises(queue.Empty): pending.get(0.001)

    def test_local_agreement_emits_only_stable_prefix(self):
        ledger = StableTranscript()
        self.assertEqual(ledger.update(snapshot(1.2), segments(('Hola', 0.1, 0.5), ('se', 0.7, 1.2))), '')
        self.assertEqual(ledger.update(snapshot(2), segments(('Hola,', 0.1, 0.5), ('cómo', 0.7, 1.3))), 'Hola,')
        self.assertEqual(ledger.update(snapshot(2.8), segments(('Hola', 0.1, 0.5), ('cómo', 0.7, 1.3), ('estás', 1.4, 1.8))), 'cómo')
        self.assertEqual(ledger.update(snapshot(3.6), segments(('Hola', 0.1, 0.5), ('cómo', 0.7, 1.3), ('estás', 1.4, 1.8))), 'estás')
        self.assertEqual(ledger.update(snapshot(4, final=True), segments(('Hola', 0.1, 0.5), ('cómo', 0.7, 1.3), ('estás', 1.4, 1.8))), '')

    def test_se_correction_never_commits_provisional_word(self):
        ledger = StableTranscript()
        self.assertEqual(ledger.update(snapshot(1.2), segments(('tengo', 0.1, 0.5), ('se', 0.7, 1.2))), '')
        self.assertEqual(ledger.update(snapshot(2), segments(('tengo', 0.1, 0.5), ('sed', 0.7, 1.3))), 'tengo')
        self.assertEqual(ledger.update(snapshot(2.8), segments(('tengo', 0.1, 0.5), ('sed', 0.7, 1.3))), 'sed')

    def test_tail_is_withheld_even_if_it_repeats(self):
        ledger = StableTranscript()
        words = segments(('bien', 0.7, 1.1))
        self.assertEqual(ledger.update(snapshot(1.2), words), '')
        self.assertEqual(ledger.update(snapshot(1.3), words), '')
        self.assertEqual(ledger.update(snapshot(2.0), words), 'bien')

    def test_genuine_repeated_words_and_new_utterances_are_allowed(self):
        ledger = StableTranscript()
        words = segments(('hola', 0.1, 0.5), ('hola', 0.6, 1.0))
        ledger.update(snapshot(1.2), words)
        self.assertEqual(ledger.update(snapshot(2), words), 'hola hola')
        self.assertEqual(ledger.update(snapshot(2.5, final=True), words), '')
        self.assertEqual(ledger.update(snapshot(4, stream=2, final=True), words), 'hola hola')

    def test_scrolling_overlap_is_not_repeated(self):
        ledger = StableTranscript()
        words = segments(('Hola', 0.1, 0.5), ('bien', 0.7, 1.1))
        ledger.update(snapshot(1.2), words)
        self.assertEqual(ledger.update(snapshot(2), words), 'Hola bien')
        # Nuevo buffer con origen desplazado; mismos tiempos absolutos.
        self.assertEqual(ledger.update(snapshot(2.8, start=0.6), segments(('bien', 0.1, 0.5), ('gracias', 0.6, 1.2))), '')
        self.assertEqual(ledger.update(snapshot(3.6, start=0.6), segments(('bien', 0.1, 0.5), ('gracias', 0.6, 1.2))), 'gracias')

    def test_lost_unconfirmed_audio_fails_instead_of_guessing(self):
        ledger = StableTranscript()
        ledger.update(snapshot(1.2), segments(('hola', 0.1, 0.5)))
        with self.assertRaisesRegex(RuntimeError, 'no alcanza'):
            ledger.update(snapshot(15, start=3), segments(('gracias', 0.1, 0.5)))

    def test_noisy_segments_do_not_commit_words(self):
        ledger = StableTranscript()
        for end in (1.2, 2, 3):
            self.assertEqual(ledger.update(snapshot(end, final=end == 3), segments(('basura', 0.1, 0.5), noise=0.9)), '')

    def test_low_confidence_suffix_is_held_not_deleted_from_a_valid_phrase(self):
        ledger = StableTranscript()
        words = segments(('Tengo', 0.1, 0.5), ('sed', 0.5, 0.8))
        words[0].words[1].probability = 0.13
        self.assertEqual(ledger.update(snapshot(1.2), words), '')
        self.assertEqual(ledger.update(snapshot(2), words), 'Tengo')
        # Mantener la política previa de confianza de segmento al cerrar voz;
        # no convertir TENGO_SED en TENGO por borrar una palabra corta.
        self.assertEqual(ledger.update(snapshot(2.5, final=True), words), 'sed')


if __name__ == '__main__': unittest.main()

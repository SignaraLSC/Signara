import unittest
from types import SimpleNamespace
import numpy as np
from streaming import SpeechBuffer, confirmed_text


class AudioStreamTests(unittest.TestCase):
    def test_silence_never_produces_utterance(self):
        buffer = SpeechBuffer()
        for _ in range(500):
            self.assertIsNone(buffer.feed(np.zeros(1600, dtype=np.float32), False))
        self.assertLessEqual(buffer.before_duration, 0.3)

    def test_pause_commits_once_and_keeps_start(self):
        buffer = SpeechBuffer()
        audio = np.ones(1600, dtype=np.float32)
        for _ in range(10):
            buffer.feed(audio * 0, False)
        for _ in range(8):
            self.assertIsNone(buffer.feed(audio, True))
        results = [buffer.feed(audio * 0, False) for _ in range(20)]
        utterances = [item for item in results if item is not None]
        self.assertEqual(len(utterances), 1)
        self.assertLess(utterances[0].start, 1.0)
        self.assertEqual(utterances[0].boundary, 'pause')

    def test_continuous_speech_is_bounded_and_non_overlapping(self):
        buffer = SpeechBuffer(maximum=2.0)
        results = [buffer.feed(np.ones(1600, dtype=np.float32), True) for _ in range(60)]
        utterances = [item for item in results if item is not None]
        self.assertGreaterEqual(len(utterances), 2)
        for previous, current in zip(utterances, utterances[1:]):
            self.assertAlmostEqual(previous.end, current.start)
        self.assertTrue(all(len(item.audio) <= 33600 for item in utterances))

    def test_reset_discards_incomplete_device_audio(self):
        buffer = SpeechBuffer()
        for _ in range(5):
            buffer.feed(np.ones(1600, dtype=np.float32), True)
        buffer.reset()
        for _ in range(20):
            self.assertIsNone(buffer.feed(np.zeros(1600, dtype=np.float32), False))

    def test_noise_and_hallucination_filters(self):
        def segment(text, noise=0.1, logprob=-0.2, compression=1):
            return SimpleNamespace(text=text, no_speech_prob=noise,
                                   avg_logprob=logprob, compression_ratio=compression)
        self.assertEqual(confirmed_text([segment('tengo sed')]), 'tengo sed')
        self.assertEqual(confirmed_text([segment('hola', noise=0.9)]), '')
        self.assertEqual(confirmed_text([segment('basura', logprob=-2)]), '')
        self.assertEqual(confirmed_text([segment('repetición', compression=4)]), '')
        self.assertEqual(confirmed_text([segment('hola'), segment('hola')]), 'hola hola')


if __name__ == '__main__':
    unittest.main()

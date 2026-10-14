import unittest
from types import SimpleNamespace
from unittest.mock import Mock
import numpy as np
from recognition import transcribe_snapshot
from streaming import StableTranscript, Utterance


class RecognitionTests(unittest.TestCase):
    def test_hint_is_used_on_audio_and_not_as_a_forced_text_prefix(self):
        model = Mock()
        model.transcribe.return_value = (iter([]), None)
        audio = np.zeros(1600, dtype=np.float32)
        snapshot = Utterance(audio, 0, 0.1, 'pause')
        list(transcribe_snapshot(model, snapshot))
        args, options = model.transcribe.call_args
        self.assertIs(args[0], audio)
        self.assertEqual(options['hotwords'], 'sed')
        self.assertNotIn('prefix', options)
        self.assertNotIn('initial_prompt', options)
        self.assertFalse(options['condition_on_previous_text'])
        self.assertTrue(options['vad_filter'])
        self.assertTrue(options['word_timestamps'])

    def test_other_words_are_never_replaced_with_sed(self):
        for text in ('ser', 'se', 'seis', 'sueño', 'celos', 'Alanis'):
            with self.subTest(text=text):
                word = SimpleNamespace(word=text, start=0, end=0.5, probability=0.8)
                segment = SimpleNamespace(words=[word], no_speech_prob=0.1,
                    avg_logprob=-0.2, compression_ratio=1)
                model = Mock()
                model.transcribe.return_value = (iter([segment]), None)
                snapshot = Utterance(np.zeros(1), 0, 1, 'pause')
                self.assertEqual(StableTranscript().update(snapshot,
                    transcribe_snapshot(model, snapshot)), text)

    def test_hint_does_not_bypass_noise_filters(self):
        word = SimpleNamespace(word='sed', start=0, end=0.5, probability=0.8)
        segment = SimpleNamespace(words=[word], no_speech_prob=0.95,
            avg_logprob=-0.2, compression_ratio=1)
        model = Mock()
        model.transcribe.return_value = (iter([segment]), None)
        snapshot = Utterance(np.zeros(1), 0, 1, 'pause')
        self.assertEqual(StableTranscript().update(snapshot,
            transcribe_snapshot(model, snapshot)), '')

    def test_baseline_audit_can_disable_the_hint(self):
        model = Mock()
        model.transcribe.return_value = (iter([]), None)
        snapshot = Utterance(np.zeros(1), 0, 1, 'pause')
        list(transcribe_snapshot(model, snapshot, vocabulary=False))
        self.assertIsNone(model.transcribe.call_args.kwargs['hotwords'])


if __name__ == '__main__': unittest.main()

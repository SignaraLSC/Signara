import os
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import numpy as np
from low_latency import compact_features, enable_short_windows


class EncoderTests(unittest.TestCase):
    def test_only_artificial_trailing_padding_is_removed(self):
        features = np.zeros((80, 3000), dtype=np.float32)
        features[:, :145] = -1.25
        copy = features.copy()
        result = compact_features(features)
        self.assertEqual(result.shape, (80, 800))
        np.testing.assert_array_equal(result, features[:, :800])
        np.testing.assert_array_equal(features, copy)

    def test_real_silence_and_interior_zero_columns_are_preserved(self):
        features = np.zeros((80, 3000), dtype=np.float32)
        features[:, :1200] = -2
        features[:, 50:100] = 0
        result = compact_features(features)
        self.assertEqual(result.shape, (80, 1300))
        np.testing.assert_array_equal(result[:, :1200], features[:, :1200])

    def test_full_window_and_long_audio_are_not_truncated(self):
        features = np.ones((80, 3000), dtype=np.float32)
        self.assertEqual(compact_features(features).shape, features.shape)
        self.assertEqual(compact_features(features[:, :200]).shape, (80, 200))

    def test_encoder_uses_compact_input_and_has_an_explicit_rollback(self):
        shapes = []
        model = SimpleNamespace(encode=lambda features: shapes.append(features.shape))
        with patch.dict(os.environ, {}, clear=True): enable_short_windows(model)
        model.encode(np.zeros((80, 3000), dtype=np.float32))
        self.assertEqual(shapes, [(80, 800)])
        model = SimpleNamespace(encode=lambda features: shapes.append(features.shape))
        with patch.dict(os.environ, {'SIGNARA_SPEECH_FULL_WINDOW': '1'}): enable_short_windows(model)
        model.encode(np.zeros((80, 3000), dtype=np.float32))
        self.assertEqual(shapes[-1], (80, 3000))


if __name__ == '__main__': unittest.main()

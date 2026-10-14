import asyncio
import json
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np
import torch

import api


ROOT = Path(__file__).resolve().parents[1]


def sample_frames(token, path=None):
    source_path = path or (ROOT / 'animations' / f'{token}.json')
    data = json.loads(source_path.read_text(encoding='utf-8'))
    source = np.asarray([
        np.asarray(frame['lh'] + frame['rh'], dtype=np.float32).reshape(126)
        for frame in data['frames']
    ])
    positions = np.linspace(0, len(source) - 1, 24)
    lo = np.floor(positions).astype(int)
    hi = np.minimum(lo + 1, len(source) - 1)
    alpha = (positions - lo)[:, None]
    return (source[lo] * (1 - alpha) + source[hi] * alpha).tolist()


@unittest.skipUnless((ROOT / 'models/signara_gnn.pt').exists(), 'checkpoint local requerido')
class SpellingPredictTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        asyncio.run(api.load_model())

    def predict(self, token, letters_only):
        return asyncio.run(api.predict(api.PredictRequest(
            frames=sample_frames(token), letters_only=letters_only,
        )))

    def test_n_is_available_as_first_letter(self):
        self.assertEqual(self.predict('N', False).prediction, 'N')
        self.assertEqual(self.predict('N', True).prediction, 'N')

    def test_n_sample_below_general_threshold_works_in_spelling_mode(self):
        path = ROOT / 'data/raw_full/alanis/N_100.json'
        if not path.exists():
            self.skipTest('muestra N_100 no disponible')
        frames = sample_frames('N', path)
        normal = asyncio.run(api.predict(api.PredictRequest(frames=frames)))
        spelling = asyncio.run(api.predict(api.PredictRequest(frames=frames, letters_only=True)))
        self.assertTrue(normal.is_idle)
        self.assertEqual(spelling.prediction, 'N')

    def test_letter_mode_does_not_invent_letters_from_words(self):
        for token in ('NO', 'SI', 'POR_FAVOR', 'GRACIAS'):
            with self.subTest(token=token):
                result = self.predict(token, True)
                self.assertTrue(result.is_idle, (token, result))

    def test_letter_mask_does_not_amplify_a_lexical_residue(self):
        # Antes, NO=.8 y Z=.2 podían convertirse en Z con confianza ~100 %.
        probs = np.full(len(api._labels), 1e-8, dtype=np.float32)
        probs[api._labels.index('NO')] = 0.80
        probs[api._labels.index('Z')] = 0.20

        class FixedModel:
            def __call__(self, _input):
                return torch.log(torch.from_numpy(probs)).unsqueeze(0)

        with patch.object(api, '_model', FixedModel()):
            result = self.predict('Z', True)
        self.assertTrue(result.is_idle)

    def test_other_letters_remain_available(self):
        for token in ('P', 'M'):
            with self.subTest(token=token):
                self.assertEqual(self.predict(token, True).prediction, token)

    def test_dynamic_letters_need_the_complete_recording(self):
        for token in ('G', 'H', 'J', 'S', 'Z'):
            with self.subTest(token=token):
                result = self.predict(token, True)
                self.assertEqual(result.prediction, token)
        # El prefijo de J parece I: no se debe confirmar con solo 8 cuadros.
        source = ROOT / 'animations/J.json'
        data = json.loads(source.read_text(encoding='utf-8'))
        prefix = np.asarray([
            np.asarray(frame['lh'] + frame['rh'], dtype=np.float32).reshape(126)
            for frame in data['frames'][:8]
        ])
        positions = np.linspace(0, len(prefix) - 1, 24)
        lo = np.floor(positions).astype(int)
        hi = np.minimum(lo + 1, len(prefix) - 1)
        alpha = (positions - lo)[:, None]
        result = asyncio.run(api.predict(api.PredictRequest(
            frames=(prefix[lo] * (1 - alpha) + prefix[hi] * alpha).tolist(),
            letters_only=True,
        )))
        self.assertEqual(result.prediction, 'I')


if __name__ == '__main__':
    unittest.main()

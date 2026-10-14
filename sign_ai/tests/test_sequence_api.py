import asyncio
import unittest
from unittest.mock import patch

import torch
from fastapi import HTTPException

import api


class FakeSequenceModel:
    def __call__(self, frames, lengths):
        assert frames.shape[1] == int(lengths[0])
        return torch.tensor([[0.0, 8.0]])


class FixedProbabilitiesModel:
    def __init__(self, probabilities):
        self.probabilities = probabilities

    def __call__(self, frames, lengths):
        return torch.log(torch.tensor([self.probabilities]))


class SequenceAPITests(unittest.TestCase):
    def setUp(self):
        # Estos contratos prueban la ruta temporal aislada; la coordinación de
        # ambas ramas se prueba en test_hybrid_recognizer.py.
        isolated = patch.object(api, 'HYBRID_ENABLED', False)
        isolated.start()
        self.addCleanup(isolated.stop)

    def test_untrained_route_does_not_fake_a_prediction(self):
        request = api.PredictRequest(frames=[[0.0] * 126 for _ in range(12)])
        with patch.object(api, '_sequence_model', None):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(api.predict_sequence(request))
        self.assertEqual(error.exception.status_code, 503)

    def test_full_sequence_reaches_the_variable_model(self):
        request = api.PredictRequest(frames=[[0.0] * 126 for _ in range(37)])
        with patch.object(api, '_sequence_model', FakeSequenceModel()), \
             patch.object(api, '_sequence_labels', ['IDLE', 'HOLA']):
            result = asyncio.run(api.predict_sequence(request))
        self.assertEqual(result.prediction, 'HOLA')

    def test_sequence_limits_are_checked(self):
        with patch.object(api, '_sequence_model', FakeSequenceModel()), \
             patch.object(api, '_sequence_labels', ['IDLE', 'HOLA']):
            for count in (5, 181):
                with self.subTest(count=count), self.assertRaises(HTTPException) as error:
                    asyncio.run(api.predict_sequence(
                        api.PredictRequest(frames=[[0.0] * 126 for _ in range(count)])
                    ))
                self.assertEqual(error.exception.status_code, 422)

    def test_health_only_advertises_a_loaded_sequence_model(self):
        with patch.object(api, '_sequence_model', None):
            self.assertFalse(api.health()['sequence_model_loaded'])

    def test_first_letter_competes_with_words_without_forcing_alphabet(self):
        request = api.PredictRequest(frames=[[0.0] * 126 for _ in range(20)])
        with patch.object(api, '_sequence_model', FixedProbabilitiesModel([0.73, 0.27])), \
             patch.object(api, '_sequence_labels', ['G', 'HOLA']):
            result = asyncio.run(api.predict_sequence(request))
        self.assertEqual(result.prediction, 'G')
        self.assertAlmostEqual(result.confidence, 0.73, places=5)
        with patch.object(api, '_sequence_model', FixedProbabilitiesModel([0.27, 0.73])), \
             patch.object(api, '_sequence_labels', ['G', 'HOLA']), \
             patch.object(api, 'looks_like_ily', return_value={'ily': False}):
            result = asyncio.run(api.predict_sequence(request))
        self.assertTrue(result.is_idle, 'el umbral de palabras no se reduce al detectar letras')

    def test_ily_hint_does_not_replace_a_recognized_letter(self):
        request = api.PredictRequest(frames=[[0.0] * 126 for _ in range(20)])
        with patch.object(api, '_sequence_model', FixedProbabilitiesModel([0.99, 0.01])), \
             patch.object(api, '_sequence_labels', ['G', 'TE_AMO']), \
             patch.object(api, 'looks_like_ily', return_value={'ily': True, 'score': 1.0}):
            result = asyncio.run(api.predict_sequence(request))
        self.assertEqual(result.prediction, 'G')

    def test_automatic_alphabet_never_returns_a_word(self):
        request = api.PredictRequest(frames=[[0.0] * 126 for _ in range(20)], letters_only=True)
        for letter in ('G', 'H', 'Ñ'):
            with self.subTest(letter=letter), \
                 patch.object(api, '_sequence_labels', ['BIEN', letter, 'IDLE']), \
                 patch.object(api, '_sequence_model', FixedProbabilitiesModel([0.30, 0.69, 0.01])):
                result = asyncio.run(api.predict_sequence(request))
                self.assertEqual(result.prediction, letter)
            with self.subTest(reject_word=letter), \
                 patch.object(api, '_sequence_labels', ['BIEN', letter, 'IDLE']), \
                 patch.object(api, '_sequence_model', FixedProbabilitiesModel([0.80, 0.19, 0.01])):
                result = asyncio.run(api.predict_sequence(request))
                self.assertTrue(result.is_idle, 'no convertir una palabra en letra por renormalizar')


if __name__ == '__main__':
    unittest.main()

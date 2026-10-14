import unittest

import torch

from core.variable_gnn_model import VariableGCNLSTM
from core.preprocess import normalize_sequence_trajectory


class VariableGCNLSTMTests(unittest.TestCase):
    def test_padding_does_not_change_prediction(self):
        torch.manual_seed(7)
        model = VariableGCNLSTM(n_classes=3).eval()
        first = torch.rand(1, 9, 42, 4)
        longer = torch.cat((first, torch.full((1, 5, 42, 4), 99.0)), dim=1)
        with torch.no_grad():
            a = model(first, torch.tensor([9]))
            b = model(longer, torch.tensor([9]))
        torch.testing.assert_close(a, b, atol=1e-5, rtol=1e-5)

    def test_mixed_lengths(self):
        model = VariableGCNLSTM(n_classes=4).eval()
        with torch.no_grad():
            logits = model(torch.rand(2, 15, 42, 4), torch.tensor([6, 15]))
        self.assertEqual(tuple(logits.shape), (2, 4))

    def test_invalid_lengths_rejected(self):
        model = VariableGCNLSTM(n_classes=2)
        with self.assertRaises(ValueError):
            model(torch.rand(1, 5, 42, 4), torch.tensor([6]))

    def test_translation_survives_preprocessing(self):
        seq = torch.zeros(8, 42, 4).numpy()
        for t in range(8):
            seq[t, :21, :3] = (0.3 + t * 0.02, 0.4, -0.1 + t * 0.01)
            seq[t, 8, :3] += (0.02, -0.04, 0.0)
        normalized = normalize_sequence_trajectory(seq)
        self.assertGreater(float(normalized[-1, 0, 0] - normalized[0, 0, 0]), 1.0)
        self.assertGreater(float(normalized[-1, 0, 2] - normalized[0, 0, 2]), 0.5)
        self.assertEqual(float(normalized[:, 21:, :3].sum()), 0.0)


if __name__ == "__main__":
    unittest.main()

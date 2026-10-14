import unittest

import numpy as np

from core.preprocess import normalize_sequence, normalize_sequence_motion


class MotionPreprocessTest(unittest.TestCase):
    def test_wrist_travel_survives_motion_preprocessing(self):
        # Misma forma de mano en todos los cuadros; solo se desplaza la muñeca.
        seq = np.zeros((24, 42, 4), dtype=np.float32)
        for t in range(24):
            seq[t, :21, 0] = 0.25 + t * 0.008
            seq[t, :21, 1] = 0.4
            seq[t, 1:21, 0] += np.linspace(0.005, 0.09, 20)
            seq[t, 21:, 3] = 1.0

        legacy = normalize_sequence(seq)
        motion = normalize_sequence_motion(seq)
        self.assertTrue(np.allclose(legacy[0, :21, :3], legacy[-1, :21, :3]))
        self.assertGreater(float(np.ptp(motion[:, 0, 0])), 1.0)
        self.assertTrue(np.allclose(motion[:, 21:, :3], 0.0))


if __name__ == '__main__':
    unittest.main()

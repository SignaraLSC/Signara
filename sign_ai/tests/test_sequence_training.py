import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import torch

from core.sequence_dataset import (
    collate_sequences, coverage_by_label, load_takes, prefer_complete_takes,
    read_take, split_by_label,
)
from core.variable_gnn_model import VariableGCNLSTM


SCRIPT = Path(__file__).resolve().parents[1] / '08_train_sequence.py'
spec = importlib.util.spec_from_file_location('sequence_trainer', SCRIPT)
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


def write_take(path, label, count, complete=True):
    frames = []
    for i in range(count):
        x = 0.2 + i * (0.003 if label == 'A' else -0.003)
        hand = [[x + j * 0.002, 0.4 + j * 0.002, -0.1] for j in range(21)]
        frames.append({'lh': hand, 'rh': [[0.0, 0.0, 0.0] for _ in range(21)]})
    value = {'label': label, 'persona': 'test', 'frames': frames}
    if complete:
        value['train_frames'] = frames[:24]
    path.write_text(json.dumps(value), encoding='utf-8')


class SequenceTrainingTests(unittest.TestCase):
    def test_legacy_24_is_not_counted_as_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_take(root / 'old.json', 'A', 24, complete=False)
            write_take(root / 'new.json', 'A', 31)
            takes, rejected = load_takes(root)
            self.assertFalse(rejected)
            coverage = coverage_by_label(takes)
            self.assertEqual(coverage['A']['complete'], 1)
            self.assertEqual(coverage['A']['longer_than_24'], 1)
            with self.assertRaisesRegex(RuntimeError, 'se requieren 2'):
                trainer.guard_coverage(coverage, min_long_samples=2,
                                       require_full=[], min_full_per_label=1)

    def test_variable_batch_preserves_lengths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_take(root / 'a.json', 'A', 30)
            write_take(root / 'b.json', 'B', 42)
            takes = [read_take(root / 'a.json'), read_take(root / 'b.json')]
            from core.sequence_dataset import SequenceDataset
            dataset = SequenceDataset(takes, ['A', 'B'])
            frames, lengths, labels = collate_sequences([dataset[0], dataset[1]])
            self.assertEqual(tuple(frames.shape), (2, 42, 42, 4))
            self.assertEqual(lengths.tolist(), [30, 42])
            self.assertEqual(labels.tolist(), [0, 1])
            self.assertEqual(float(frames[0, 30:].abs().sum()), 0.0)
            with torch.no_grad():
                self.assertEqual(tuple(VariableGCNLSTM(2).eval()(frames, lengths).shape), (2, 2))

    def test_regrabbed_class_does_not_mix_with_old_compressed_takes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i in range(6):
                write_take(root / f'A_old_{i}.json', 'A', 24, complete=False)
            for i in range(4):
                write_take(root / f'A_new_{i}.json', 'A', 31)
            write_take(root / 'B_old.json', 'B', 24, complete=False)
            takes, _ = load_takes(root)
            selected, replaced = prefer_complete_takes(takes, min_complete_per_label=4)
            self.assertEqual(replaced, ['A'])
            self.assertEqual(sum(t.label == 'A' for t in selected), 4)
            self.assertEqual(sum(t.label == 'B' for t in selected), 1)
            self.assertTrue(all(t.complete_capture for t in selected if t.label == 'A'))

    def test_one_epoch_writes_api_compatible_candidate_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / 'data' / 'raw_full' / 'test'
            data.mkdir(parents=True)
            models = root / 'models'
            models.mkdir()
            (models / 'labels_gnn.json').write_text('["A", "B"]', encoding='utf-8')
            for label in ('A', 'B'):
                for i in range(4):
                    write_take(data / f'{label}_{i}.json', label, 26 + i)
            args = trainer.parse_args([
                '--data-dir', str(data.parent), '--output-dir', str(models),
                '--epochs', '1', '--batch-size', '2', '--min-long-samples', '1',
                '--require-full', 'A', 'B', '--min-full-per-label', '4',
            ])
            with patch.object(trainer, 'ROOT', root):
                metadata = trainer.train(args)
            self.assertEqual(metadata['architecture'], 'variable_gcn_lstm_v1')
            self.assertEqual(metadata['preprocess'], 'wrist_trajectory_xyz_v1')
            self.assertTrue((models / 'signara_gnn_sequence.pt').exists())
            restored = VariableGCNLSTM(2)
            restored.load_state_dict(torch.load(models / 'signara_gnn_sequence.pt', map_location='cpu'))
            self.assertFalse((models / 'signara_gnn.pt').exists())
            self.assertTrue((models / 'labels_gnn_sequence.json').exists())
            self.assertTrue((models / 'signara_gnn_sequence_meta.json').exists())
            self.assertEqual(metadata['long_samples'], 8)
            self.assertEqual(metadata['complete_only_labels'], ['A', 'B'])

    def test_split_keeps_each_class_in_both_sets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for label in ('A', 'B'):
                for i in range(5):
                    write_take(root / f'{label}_{i}.json', label, 30)
            takes, _ = load_takes(root)
            train, val, excluded = split_by_label(takes)
            self.assertFalse(excluded)
            self.assertEqual({t.label for t in train}, {'A', 'B'})
            self.assertEqual({t.label for t in val}, {'A', 'B'})


if __name__ == '__main__':
    unittest.main()

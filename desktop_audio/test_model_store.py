import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from model_store import model_directory, model_ready, migrate_legacy_cache, load_speech_model


class ModelStoreTests(unittest.TestCase):
    def test_same_directory_with_different_windows_profiles(self):
        with tempfile.TemporaryDirectory() as root, patch.object(sys, 'prefix', str(Path(root) / 'venv')):
            with patch.dict(os.environ, {'LOCALAPPDATA': str(Path(root) / 'codex')}, clear=True):
                prepared = model_directory('base')
            with patch.dict(os.environ, {'LOCALAPPDATA': str(Path(root) / 'native')}, clear=True):
                native = model_directory('base')
            self.assertEqual(prepared, native)
            self.assertEqual(native, Path(root).resolve() / 'cache' / 'speech-models' / 'base')

    def test_missing_model_is_actionable_and_does_not_download(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.dict(os.environ, {'SIGNARA_SPEECH_MODEL_DIR': root}), patch('faster_whisper.utils.download_model') as download:
                with self.assertRaisesRegex(RuntimeError, 'desktop:audio:setup'):
                    load_speech_model()
                download.assert_not_called()

    def test_legacy_snapshot_does_not_need_hub_ref(self):
        with tempfile.TemporaryDirectory() as root:
            snapshot = Path(root) / 'Signara/speech-models/models--Systran--faster-whisper-base/snapshots/revision'
            snapshot.mkdir(parents=True)
            for name in ('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'):
                (snapshot / name).write_bytes(b'test')
            destination = Path(root) / 'new/base'
            with patch.dict(os.environ, {'LOCALAPPDATA': root}):
                self.assertTrue(migrate_legacy_cache('base', destination))
            self.assertTrue(model_ready(destination))
            self.assertTrue(model_ready(snapshot), 'No borrar la descarga anterior')

    def test_loads_path_offline_without_hub_lookup(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for name in ('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'):
                (directory / name).write_bytes(b'test')
            with patch.dict(os.environ, {'SIGNARA_SPEECH_MODEL_DIR': root}), patch('faster_whisper.WhisperModel') as model, patch('faster_whisper.utils.download_model') as download:
                load_speech_model()
                self.assertEqual(model.call_args.args, (str(directory.resolve()),))
                self.assertTrue(model.call_args.kwargs['local_files_only'])
                download.assert_not_called()

    def test_empty_files_are_not_ready(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for name in ('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'):
                (directory / name).touch()
            self.assertFalse(model_ready(directory))


if __name__ == '__main__':
    unittest.main()

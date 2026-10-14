"""Una ruta compartida por preparación y app, fuera de AppData virtualizado."""
import os
from pathlib import Path
import re
import shutil
import sys


def model_directory(model_name):
    override = os.environ.get('SIGNARA_SPEECH_MODEL_DIR')
    if override:
        return Path(override).expanduser().resolve()
    name = model_name.replace('/', '--')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name in ('.', '..'):
        raise ValueError('Nombre de modelo de voz inválido.')
    # sys.prefix es el mismo venv aunque Tauri y la terminal tengan distintos
    # LOCALAPPDATA, perfiles o cachés de Hugging Face.
    return Path(sys.prefix).resolve().parent / 'cache' / 'speech-models' / name


def model_ready(directory):
    required = ('config.json', 'model.bin', 'tokenizer.json')
    vocabulary = ('vocabulary.txt', 'vocabulary.json')
    def present(name):
        path = directory / name
        return path.is_file() and path.stat().st_size > 0
    return all(present(name) for name in required) and any(present(name) for name in vocabulary)


def migrate_legacy_cache(model_name, directory):
    """Reutilizar una descarga existente sin borrarla ni depender de sus refs."""
    if model_name != 'base':
        return False
    legacy = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Signara' / 'speech-models'
    snapshots = legacy / 'models--Systran--faster-whisper-base' / 'snapshots'
    for snapshot in sorted(snapshots.glob('*')):
        if not model_ready(snapshot):
            continue
        directory.mkdir(parents=True, exist_ok=True)
        for name in ('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt',
                     'vocabulary.json', 'preprocessor_config.json'):
            source = snapshot / name
            if source.is_file():
                shutil.copy2(source, directory / name)
        return model_ready(directory)
    return False


def load_speech_model(prepare=False):
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    name = os.environ.get('SIGNARA_SPEECH_MODEL', 'base')
    directory = model_directory(name)
    if not model_ready(directory):
        if not prepare:
            raise RuntimeError('Falta preparar el modelo de voz local. Ejecuta npm run desktop:audio:setup y vuelve a pulsar play.')
        if not migrate_legacy_cache(name, directory):
            download_model(name, output_dir=str(directory))
        if not model_ready(directory):
            raise RuntimeError('La descarga del modelo de voz quedó incompleta. Vuelve a ejecutar npm run desktop:audio:setup.')
    # Ruta directa, no nombre/revisión de Hub. Incluso con refs de caché
    # inexistentes o sin internet, todos los archivos necesarios están aquí.
    from low_latency import enable_short_windows
    model = WhisperModel(str(directory), device='cpu', compute_type='int8',
                         cpu_threads=4, local_files_only=True)
    return enable_short_windows(model)

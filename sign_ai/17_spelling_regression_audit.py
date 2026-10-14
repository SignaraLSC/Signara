"""Read-only same-input comparison against an assistant-edit checkpoint.

Reconstructs sources in memory; never replaces working files or checkpoints.
Predictions are not human ground truth and replay does not simulate camera UI.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import types

import numpy as np

import api
from core.confusion import evaluate_prediction
from core.hybrid_recognizer import recognize_hybrid


def reconstruct(transcript, before_line, target):
    content = None
    for number, line in enumerate(transcript.open(encoding='utf-8'), 1):
        if number >= before_line:
            break
        payload = json.loads(line).get('payload', {})
        if payload.get('type') not in ('custom_tool_call', 'function_call'):
            continue
        source = payload.get('input') or payload.get('arguments') or ''
        if not isinstance(source, str):
            continue
        position = 0
        while (position := source.find('tools.apply_patch(', position)) >= 0:
            position += len('tools.apply_patch(')
            try:
                patch, _ = json.JSONDecoder().raw_decode(source[position:])
            except ValueError:
                continue
            parts, index = patch.splitlines(), 0
            while index < len(parts):
                header = parts[index]
                index += 1
                if not header.startswith(('*** Add File:', '*** Update File:')):
                    continue
                section = []
                while index < len(parts) and not parts[index].startswith('*** '):
                    section.append(parts[index])
                    index += 1
                if not header.replace('\\', '/').endswith('/' + target):
                    continue
                if header.startswith('*** Add File:'):
                    content = [value[1:] for value in section if value.startswith('+')]
                    continue
                if content is None:
                    raise RuntimeError(f'Missing initial source: {target}')
                cursor = offset = 0
                while offset < len(section):
                    anchor = section[offset]
                    offset += 1
                    if not anchor.startswith('@@'):
                        raise RuntimeError(f'Unsupported patch at line {number}')
                    name = anchor[2:].strip()
                    if name:
                        cursor = next(i + 1 for i in range(cursor, len(content)) if content[i] == name)
                    hunk = []
                    while offset < len(section) and not section[offset].startswith('@@'):
                        hunk.append(section[offset])
                        offset += 1
                    old = [v[1:] for v in hunk if v.startswith((' ', '-'))]
                    new = [v[1:] for v in hunk if v.startswith((' ', '+'))]
                    matches = [i for i in range(cursor, len(content) - len(old) + 1)
                               if content[i:i + len(old)] == old] if old else [cursor]
                    if not matches:
                        raise RuntimeError(f'Cannot reconstruct {target}, edit line {number}')
                    at = matches[0]
                    content[at:at + len(old)] = new
                    cursor = at + len(new)
    if content is None:
        raise RuntimeError(f'No source found: {target}')
    return '\n'.join(content) + '\n'


async def audit(args):
    source = reconstruct(args.transcript, args.before_line, 'sign_ai/core/hybrid_recognizer.py')
    historical = types.ModuleType('historical_spelling_hybrid')
    sys.modules[historical.__name__] = historical
    exec(compile(source, '<reconstructed-hybrid>', 'exec'), historical.__dict__)
    print(f'Reconstructed {len(source.splitlines())} lines in memory; no files replaced.', flush=True)
    api.SEQUENCE_ENABLED = api.HYBRID_ENABLED = True
    await api.load_model()
    if api._sequence_model is None or api._model is None:
        raise RuntimeError('Run from sign_ai with both checkpoints available')
    for path in args.traces:
        trace = json.loads(path.read_text(encoding='utf-8-sig'))
        differences = []
        for index, query in enumerate(trace['predictions']):
            frames = np.asarray(query['frames'], dtype=np.float32)
            def read(function):
                result = function(frames, api._model, api._labels, api._sequence_model,
                                  api._sequence_labels, normalize=api._normalize_inputs,
                                  preprocess=api._preprocess_mode,
                                  letters_only=bool(query.get('lettersOnly')))
                prediction, confidence, _ = evaluate_prediction(
                    result.labels, result.probabilities, min_conf=.70, min_margin=.12)
                return ('' if result.blocked or prediction == 'IDLE' else prediction or '',
                        round(confidence, 3), result.source)
            before, now = read(historical.recognize_hybrid), read(recognize_hybrid)
            if before != now:
                differences.append((index, len(frames), before, now))
        print(path.name, 'same-input changes (not accuracy):', len(differences), flush=True)
        for row in differences:
            print(row, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transcript', type=Path, required=True)
    parser.add_argument('--before-line', type=int, required=True)
    parser.add_argument('traces', type=Path, nargs='+')
    asyncio.run(audit(parser.parse_args()))

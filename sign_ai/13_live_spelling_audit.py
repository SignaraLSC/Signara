"""Read-only audit of saved browser inputs and the two existing checkpoints."""

import argparse
import asyncio
import json
from pathlib import Path

import numpy as np

import api
from core.hybrid_recognizer import _probabilities, resample_shape, wrist_signature
from core.preprocess import TRAJECTORY_PREPROCESS


def describe(frames):
    hands = np.asarray(frames).reshape(-1, 2, 21, 3)
    side = int((np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6).sum(axis=0).argmax())
    hand = hands[:, side]
    hand = hand[np.linalg.norm(hand[:, 0, :2], axis=1) > 1e-6]
    span = max(float(np.median(np.linalg.norm(hand[:, [5, 9, 17], :2] - hand[:, :1, :2], axis=2).max(axis=1))), 0.025)
    wrist = hand[:, 0, :2]
    local = hand - hand[:, :1]
    scale = np.linalg.norm(local[:, 9], axis=1)
    local /= np.maximum(scale[:, None, None], 1e-6)
    lengths = []
    for mcp in (1, 5, 9, 13, 17):
        chain = hand[:, mcp:mcp+4]
        lengths.append(np.linalg.norm(chain[:, -1] - chain[:, 0], axis=1) / np.maximum(np.linalg.norm(np.diff(chain, axis=1), axis=2).sum(axis=1), 1e-6))
    profile = np.array(lengths).T
    return {
        'wrist_extent': round(float(np.linalg.norm(np.ptp(wrist, axis=0))) / span, 3),
        'wrist_tail': round(float(np.linalg.norm(np.ptp(wrist[-8:], axis=0))) / span, 3),
        'profile_tail': round(float(np.max(np.ptp(profile[-8:], axis=0))), 3),
        'extension': np.median(profile[-8:], axis=0).round(2).tolist(),
    }


async def main(paths, held_poses=False):
    api.SEQUENCE_ENABLED = True
    api.HYBRID_ENABLED = True
    await api.load_model()
    def top(model, labels, frames, sequence=False):
        probabilities = _probabilities(model, frames, sequence=sequence,
                                       preprocess=TRAJECTORY_PREPROCESS if sequence else api._preprocess_mode)
        return ' '.join(f'{labels[i]}:{probabilities[i]:.3f}' for i in np.argsort(probabilities)[-3:][::-1])
    for path in paths:
        trace = json.loads(path.read_text(encoding='utf-8-sig'))
        print(path.name, 'expected=', trace['expected'], flush=True)
        if held_poses:
            from collections import Counter
            frames = np.asarray(trace['frames'], dtype=np.float32)
            runs = []
            for end in range(8, len(frames) + 1, 4):
                result = await api.predict_sequence(api.PredictRequest(frames=frames[end-8:end].tolist(), letters_only=True))
                runs.append((end, result.prediction or '—', round(result.confidence, 3), result.recognition_source,
                             wrist_signature(frames[end-8:end])[2].round(3).tolist()))
            print('recent-window probes (not UI confirmations):', runs, flush=True)
            print('counts:', dict(Counter(item[1] for item in runs)), flush=True)
        for index, query in enumerate(trace['predictions']):
            frames = np.asarray(query['frames'], dtype=np.float32)
            current = await api.predict_sequence(api.PredictRequest(
                frames=frames.tolist(), letters_only=bool(query.get('lettersOnly'))))
            print(index, query['prediction'], query['decision'], len(frames),
                  'now=', current.prediction or '—', round(current.confidence, 3),
                  current.recognition_source, 'preparation=', current.preparation_frames,
                  'whole=', top(api._model, api._labels, resample_shape(frames)),
                  'tail=', top(api._model, api._labels, resample_shape(frames[-8:])),
                  'seq=', top(api._sequence_model, api._sequence_labels, frames, True),
                  json.dumps(describe(frames), ensure_ascii=False), flush=True)
            if query['prediction'] == 'H':
                hands = frames.reshape(-1, 2, 21, 3)
                side = int((np.linalg.norm(hands[:, :, 0, :2], axis=2)>1e-6).sum(axis=0).argmax())
                hand = hands[:, side]
                ext = []
                for mcp in (5, 9):
                    chain = hand[:, mcp:mcp+4]
                    ext.append(np.linalg.norm(chain[:, -1]-chain[:, 0], axis=1)/np.maximum(np.linalg.norm(np.diff(chain,axis=1),axis=2).sum(axis=1),1e-6))
                compatible = (np.asarray(ext)>0.80).all(axis=0)
                start = next((i for i in range(len(frames)-2) if compatible[i:i+3].all()), 0)
                print('  compatible-start', start, 'seq=', top(api._sequence_model, api._sequence_labels, frames[start:], True),
                      'legacy=', top(api._model, api._labels, resample_shape(frames[start:])), flush=True)
                captured = np.asarray(trace['frames'], dtype=np.float32)
                matches = np.flatnonzero(np.max(np.abs(captured - frames[-1]), axis=1) < 1e-6)
                if len(matches) == 1 and current.preparation_frames:
                    for added in (3, 6):
                        extra = captured[matches[0]+1:matches[0]+1+added]
                        follow = np.concatenate([frames[start:], extra])
                        reply = await api.predict_sequence(api.PredictRequest(frames=follow.tolist(), letters_only=True))
                        print('  preserve-buffer, additional frames=', len(extra), reply.prediction or '—',
                              round(reply.confidence, 3), reply.recognition_source, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', type=Path, nargs='+')
    parser.add_argument('--held-poses', action='store_true')
    args = parser.parse_args()
    asyncio.run(main(args.paths, args.held_poses))

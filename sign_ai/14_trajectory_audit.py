"""Read-only kinematic comparison of complete takes and live browser inputs."""

import argparse
import json
from pathlib import Path

import numpy as np

from core.sequence_dataset import read_take


def signature(frames):
    hands = np.asarray(frames).reshape(-1, 2, 21, 3)
    side = int((np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6).sum(axis=0).argmax())
    hand = hands[:, side]
    hand = hand[np.linalg.norm(hand[:, 0, :2], axis=1) > 1e-6]
    scale = max(float(np.median(np.linalg.norm(hand[:, [5, 9, 17], :2] - hand[:, :1, :2], axis=2).max(axis=1))), 0.025)
    path = hand[:, 0, :2] / scale
    path = np.array([np.median(path[max(0, i-1):i+2], axis=0) for i in range(len(path))])
    extent = np.ptp(path, axis=0)
    travel = np.linalg.norm(np.diff(path, axis=0), axis=1).sum()
    net = np.linalg.norm(path[-1] - path[0])
    reversal = []
    for axis in (0, 1):
        values = path[:, axis]
        # Total travel minus displacement exposes reversals, independent of fps.
        reversal.append(float((np.abs(np.diff(values)).sum() - abs(values[-1] - values[0])) / 2))
    return np.array([*extent, travel, net, *reversal])


def finger_spread(frames):
    hands = np.asarray(frames).reshape(-1, 2, 21, 3)
    side = int((np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6).sum(axis=0).argmax())
    hand = hands[:, side]
    profiles = []
    for mcp in (1, 5, 9, 13, 17):
        chain = hand[:, mcp:mcp+4]
        profiles.append(np.linalg.norm(chain[:, -1] - chain[:, 0], axis=1) /
                        np.maximum(np.linalg.norm(np.diff(chain, axis=1), axis=2).sum(axis=1), 1e-6))
    return np.ptp(np.percentile(profiles, [10, 90], axis=1), axis=0)


def main(args):
    for path in args.paths:
        trace = json.loads(path.read_text(encoding='utf-8-sig'))
        print(path.name)
        for i, query in enumerate(trace['predictions']):
            if query['prediction'] in {'Ñ', 'H', 'Z'}:
                print(i, query['prediction'], query['decision'], signature(query['frames']).round(3).tolist(),
                      'finger spread', finger_spread(query['frames']).round(3).tolist())
        if 'M' in path.name:
            print('M entering reversal window:', signature(trace['frames'][44:52]).round(3).tolist(),
                  'finger spread', finger_spread(trace['frames'][44:52]).round(3).tolist())
    for label in ('Ñ', 'H', 'Z'):
        signatures, spreads = [], []
        for path in sorted(args.data_dir.rglob(f'{label}_*.json')):
            take = read_take(path)
            if not take.complete_capture:
                continue
            signatures.append(signature(take.frames))
            spreads.append(finger_spread(take.frames))
            if len(signatures) >= args.limit:
                break
        print(label, len(signatures), 'extentXY/travel/net/reversalXY',
              np.percentile(signatures, [0, 10, 50, 90, 100], axis=0).round(3).tolist(), flush=True)
        print('finger spread', np.percentile(spreads, [0, 10, 50, 90, 100], axis=0).round(3).tolist(), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', type=Path, nargs='*')
    parser.add_argument('--data-dir', type=Path, default=Path('data/raw_full'))
    parser.add_argument('--limit', type=int, default=10)
    main(parser.parse_args())

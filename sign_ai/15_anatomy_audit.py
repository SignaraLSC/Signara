"""Read-only anatomy/trajectory audit; landmark estimates are not video labels."""
import argparse
import json
from pathlib import Path

import numpy as np

from core.sequence_dataset import read_take


def describe(frames):
    hands = np.asarray(frames).reshape(-1, 2, 21, 3)
    visible = np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6
    side = int(visible.sum(axis=0).argmax())
    hand = hands[visible[:, side], side]
    if len(hand) < 6:
        return {'visible': len(hand)}
    extension, down = [], []
    for mcp in (5, 9, 13, 17):
        chain = hand[:, mcp:mcp+4]
        bones = np.maximum(np.linalg.norm(np.diff(chain, axis=1), axis=2).sum(axis=1), 1e-6)
        extension.append(np.linalg.norm(chain[:, -1]-chain[:, 0], axis=1)/bones)
        down.append((chain[:, -1, 1]-chain[:, 0, 1])/bones)
    extension, down = np.array(extension).T, np.array(down).T
    scale = max(float(np.median(np.linalg.norm(hand[:, [5, 9, 17], :2]-hand[:, :1, :2], axis=2).max(axis=1))), .025)
    paths = {}
    for name, raw in [('wrist', hand[:, 0, :2]), ('tips', hand[:, [8, 12], :2].mean(axis=1))]:
        path = raw / scale
        path = np.array([np.median(path[max(0,i-1):i+2], axis=0) for i in range(len(path))])
        extent = np.ptp(path, axis=0)
        back = (np.abs(np.diff(path, axis=0)).sum(axis=0)-np.abs(path[-1]-path[0]))/2
        paths[name] = np.array([*extent, *back]).round(3).tolist()
    two = (extension[:, 0]>.85)&(extension[:, 1]>.85)&(extension[:, 2]<.65)&(extension[:, 3]<.80)&(down[:, :2].min(axis=1)>.45)
    three = (extension[:, :3].min(axis=1)>.85)&(extension[:, 3]<.80)&(down[:, :3].min(axis=1)>.45)
    return {'extension': np.median(extension,axis=0).round(2).tolist(),
            'two': round(float(two.mean()),3), 'three': round(float(three.mean()),3), **paths}


def main(args):
    for path in args.paths:
        trace = json.loads(path.read_text(encoding='utf-8-sig'))
        print(path.name)
        for i, query in enumerate(trace['predictions']):
            if query['prediction'] in {'Ñ','M','N'}:
                print(i,query['prediction'],query['decision'],describe(query['frames']),flush=True)
    records = []
    for path in sorted(args.data_dir.rglob('Ñ_*.json')):
        take = read_take(path)
        if take.complete_capture:
            records.append(describe(take.frames))
    for key in ('two','three','wrist','tips'):
        print('complete Ñ',key,np.percentile([r[key] for r in records],[0,10,50,90,100],axis=0).round(3).tolist(),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths',type=Path,nargs='*')
    parser.add_argument('--data-dir',type=Path,default=Path('data/raw_full'))
    main(parser.parse_args())

"""Read-only prefix/hold audit. Corpus replay is not live accuracy."""
import argparse
import asyncio
from pathlib import Path

import numpy as np

import api
from core.sequence_dataset import read_take


async def main(args):
    api.SEQUENCE_ENABLED = api.HYBRID_ENABLED = True
    await api.load_model()
    for label in ('G', 'H', 'Ñ'):
        count = 0
        for path in sorted(Path('data/raw_full').rglob(f'{label}_*.json')):
            take = read_take(path)
            if not take.complete_capture:
                continue
            rows = []
            # Growing real trajectory, then original final-pose hold. No NN
            # search for a favorable slice; each prefix is an online arrival.
            frames = np.concatenate([take.frames, np.repeat(take.frames[-1:], 8, axis=0)])
            for end in range(6, len(frames)+1, 3):
                result = []
                for alphabet in (False, True):
                    response = await api.predict_sequence(api.PredictRequest(frames=frames[:end].tolist(), letters_only=alphabet))
                    result.append(f'{response.prediction or "—"}:{response.confidence:.2f}:{response.recognition_source}')
                rows.append((end, *result))
            print(label, path.name, 'frames=',len(take.frames),rows,flush=True)
            count += 1
            if count >= args.takes:
                break


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--takes',type=int,default=3)
    args = parser.parse_args()
    if args.takes < 1:
        parser.error('--takes debe ser positivo')
    asyncio.run(main(args))

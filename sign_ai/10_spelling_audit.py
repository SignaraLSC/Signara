"""Auditoría offline de letras y palabras vecinas con clips canónicos."""

import json
from pathlib import Path

import numpy as np
import torch

from core.gnn_model import GCN_LSTM, SEQ_LEN
from core.handshape_hints import (
    _finger_extension, _is_index_middle_n_shape, _looks_like_n, _looks_like_p,
    _mean_hand, _pick_active_hand, INDEX_MCP, INDEX_TIP, MIDDLE_MCP, MIDDLE_TIP,
)
from core.preprocess import sequence_compact_to_gnn


def resample(frames):
    positions = np.linspace(0, len(frames) - 1, SEQ_LEN)
    lo = np.floor(positions).astype(int)
    hi = np.minimum(lo + 1, len(frames) - 1)
    weight = (positions - lo)[:, None]
    return frames[lo] * (1 - weight) + frames[hi] * weight


def main():
    labels = json.loads(Path('models/labels_gnn.json').read_text(encoding='utf-8'))
    model = GCN_LSTM(n_classes=len(labels))
    model.load_state_dict(torch.load('models/signara_gnn.pt', map_location='cpu', weights_only=True))
    model.eval()
    for label in ('N', 'NO', 'P', 'M', 'Ñ', 'SI', 'POR_FAVOR', 'GRACIAS'):
        data = json.loads((Path('animations') / f'{label}.json').read_text(encoding='utf-8'))
        frames = np.asarray([
            np.asarray(frame['lh'] + frame['rh'], dtype=np.float32).reshape(126)
            for frame in data['frames']
        ])
        held = resample(frames)
        hand = _pick_active_hand(held)
        avg = _mean_hand(hand[-8:])
        ie = _finger_extension(avg, INDEX_MCP, INDEX_TIP)
        me = _finger_extension(avg, MIDDLE_MCP, MIDDLE_TIP)
        seq = sequence_compact_to_gnn(held, normalize=True)
        with torch.no_grad():
            probs = torch.softmax(model(torch.from_numpy(seq).unsqueeze(0)), 1)[0].numpy()
        order = np.argsort(probs)[::-1][:3]
        letter_mass = sum(float(p) for lab, p in zip(labels, probs) if len(lab) == 1)
        print(label, 'top3', [(labels[i], round(float(probs[i]), 3)) for i in order],
              'letter_mass', round(letter_mass, 3),
              'index/middle', round(ie, 2), round(me, 2),
              'N broad/strict', _is_index_middle_n_shape(avg), _looks_like_n(avg),
              'P strict', _looks_like_p(avg))

    for person in ('alanis', 'juan', 'maria'):
        folder = Path('data/raw_full') / person
        paths = sorted(folder.glob('N_*.json'))[:10]
        outcomes = []
        for path in paths:
            data = json.loads(path.read_text(encoding='utf-8'))
            compact = np.asarray([
                np.asarray(frame['lh'] + frame['rh'], dtype=np.float32).reshape(126)
                for frame in data['frames']
            ])
            seq = sequence_compact_to_gnn(resample(compact), normalize=True)
            with torch.no_grad():
                probs = torch.softmax(model(torch.from_numpy(seq).unsqueeze(0)), 1)[0].numpy()
            winner = int(np.argmax(probs))
            outcomes.append((labels[winner], round(float(probs[winner]), 2)))
            if path.name == 'N_100.json':
                order = np.argsort(probs)[::-1][:4]
                print('N_100 details', [(labels[i], round(float(probs[i]), 3)) for i in order])
        print('N samples', person, outcomes)


if __name__ == '__main__':
    main()

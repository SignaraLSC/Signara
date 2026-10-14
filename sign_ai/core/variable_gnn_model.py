"""GCN + LSTM para gestos de longitud variable, sin remuestreo temporal.

Este modelo es un candidato nuevo: no es compatible con el checkpoint de 24
cuadros. Recibe longitudes reales y descarta el padding antes de la GCN y al
seleccionar el último estado recurrente de cada muestra.
"""

import torch
import torch.nn as nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence

from core.gnn_model import A_HAT, HandGCN, N_FEATURES, N_NODES


class VariableGCNLSTM(nn.Module):
    def __init__(self, n_classes: int):
        super().__init__()
        self.register_buffer("A_hat", A_HAT.clone())
        self.gcn = HandGCN()
        self.lstm = nn.LSTM(64, 128, num_layers=2, batch_first=True, dropout=0.3)
        self.classifier = nn.Sequential(
            nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.3), nn.Linear(64, n_classes)
        )

    def forward(self, frames: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        if frames.ndim != 4 or frames.shape[2:] != (N_NODES, N_FEATURES):
            raise ValueError("frames debe tener forma (batch, tiempo, 42, 4)")
        batch, time = frames.shape[:2]
        lengths = torch.as_tensor(lengths, device=frames.device, dtype=torch.long)
        if lengths.shape != (batch,) or bool((lengths < 1).any()) or bool((lengths > time).any()):
            raise ValueError("longitudes inválidas para el tensor recibido")

        valid = torch.arange(time, device=frames.device)[None, :] < lengths[:, None]
        embeddings = self.gcn(frames[valid], self.A_hat)
        padded = embeddings.new_zeros((batch, time, embeddings.shape[-1]))
        padded[valid] = embeddings
        packed = pack_padded_sequence(padded, lengths.cpu(), batch_first=True, enforce_sorted=False)
        encoded, _ = self.lstm(packed)
        unpacked, _ = pad_packed_sequence(encoded, batch_first=True, total_length=time)
        last = unpacked[torch.arange(batch, device=frames.device), lengths - 1]
        return self.classifier(last)

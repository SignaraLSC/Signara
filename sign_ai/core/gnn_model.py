"""
core/gnn_model.py
GCN + LSTM para reconocimiento de lengua de señas.

Estructura:
  - 42 nodos por frame (lh 0-20, rh 21-41)
  - 4 features por nodo: [x, y, z, mano]
  - HandGCN: extrae embedding espacial por frame
  - GCN_LSTM: procesa la secuencia con LSTM temporal
"""

import torch
import torch.nn as nn
import numpy as np

# ── Constantes ────────────────────────────────────────────────────────────────

N_NODES   = 42
N_FEATURES = 4
# Debe coincidir con core/config.SEQ_LEN (captura) y con SEQ_LEN en
# src/components/InterpretScreen.jsx (navegador) — los tres deben ir
# sincronizados o /predict rechaza el shape (422) o el modelo entrena mal.
# Bajado de 40 a 24 — ver comentario en core/config.py (ablación validada).
SEQ_LEN   = 24

HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),
    (9,13),(13,14),(14,15),(15,16),
    (13,17),(0,17),(17,18),(18,19),(19,20),
]

# ── Adjacency matrix ──────────────────────────────────────────────────────────

def build_adjacency():
    """
    Construye A_hat = D^(-1/2)(A+I)D^(-1/2) para 42 nodos.
    Nodos 0-20 = mano izquierda, nodos 21-41 = mano derecha.
    Sin conexiones cruzadas entre manos.
    """
    A = np.zeros((N_NODES, N_NODES), dtype=np.float32)

    for i, j in HAND_CONNECTIONS:
        # Mano izquierda (nodos 0-20)
        A[i, j] = 1.0
        A[j, i] = 1.0
        # Mano derecha (nodos 21-41, offset +21)
        A[i + 21, j + 21] = 1.0
        A[j + 21, i + 21] = 1.0

    # Auto-loops
    A += np.eye(N_NODES, dtype=np.float32)

    # Normalización simétrica D^(-1/2) A D^(-1/2)
    D = np.diag(A.sum(axis=1))
    D_inv_sqrt = np.diag(1.0 / np.sqrt(np.maximum(A.sum(axis=1), 1e-8)))
    A_hat = D_inv_sqrt @ A @ D_inv_sqrt

    return torch.FloatTensor(A_hat)


A_HAT = build_adjacency()   # (42, 42) — precalculado una vez


# ── GCN Layer ─────────────────────────────────────────────────────────────────

class GCNLayer(nn.Module):
    def __init__(self, in_features: int, out_features: int):
        super().__init__()
        self.linear = nn.Linear(in_features, out_features)
        self.bn     = nn.BatchNorm1d(out_features)
        self.act    = nn.ReLU()

    def forward(self, x, A_hat):
        """
        x:     (batch, nodes, features)
        A_hat: (nodes, nodes)
        """
        out = torch.bmm(A_hat.unsqueeze(0).expand(x.size(0), -1, -1), x)
        out = self.linear(out)                          # (batch, nodes, out_features)
        b, n, f = out.shape
        out = self.bn(out.view(b * n, f)).view(b, n, f) # BN on (B*N, F)
        out = self.act(out)
        return out


# ── Hand GCN ─────────────────────────────────────────────────────────────────

class HandGCN(nn.Module):
    """Extrae embedding espacial (64-dim) de un frame de manos."""

    def __init__(self):
        super().__init__()
        self.gcn1   = GCNLayer(N_FEATURES, 32)
        self.drop   = nn.Dropout(0.3)
        self.gcn2   = GCNLayer(32, 64)

    def forward(self, x, A_hat):
        """
        x:     (batch, nodes, features)
        return (batch, 64)
        """
        x = self.gcn1(x, A_hat)
        x = self.drop(x)
        x = self.gcn2(x, A_hat)
        return x.mean(dim=1)   # Global mean pooling → (batch, 64)


# ── GCN + LSTM ────────────────────────────────────────────────────────────────

class GCN_LSTM(nn.Module):
    """
    Para cada frame aplica HandGCN (compartido en el tiempo),
    luego LSTM analiza la evolución temporal.
    """

    def __init__(self, n_classes: int):
        super().__init__()
        self.register_buffer("A_hat", A_HAT)   # se mueve con el modelo al device

        self.gcn  = HandGCN()
        self.lstm = nn.LSTM(
            input_size=64,
            hidden_size=128,
            num_layers=2,
            batch_first=True,
            dropout=0.3,
        )
        self.classifier = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, n_classes),
        )

    def forward(self, x):
        """
        x: (batch, seq_len, nodes, features)
        """
        batch, seq, nodes, feats = x.shape

        # Procesar cada frame con el mismo GCN
        x_flat = x.view(batch * seq, nodes, feats)
        emb    = self.gcn(x_flat, self.A_hat)           # (batch*seq, 64)
        emb    = emb.view(batch, seq, 64)               # (batch, seq, 64)

        # LSTM temporal
        out, _ = self.lstm(emb)                         # (batch, seq, 128)
        last   = out[:, -1, :]                          # (batch, 128)

        return self.classifier(last)                    # (batch, n_classes)

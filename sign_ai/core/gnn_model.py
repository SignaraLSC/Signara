"""
core/gnn_model.py
Arquitectura GCN + LSTM para reconocimiento de señas.

Flujo:
  Para cada frame (t = 0..29):
    - Grafo G_t: 42 nodos (21 lh + 21 rh), features [x, y, z, mano]
    - GCN(G_t) → embedding espacial e_t ∈ R^64

  Secuencia [e_0, e_1, ..., e_29] → LSTM → clase

Nodos del grafo:
  0..20  = mano izquierda (lh)  landmark id 0..20
  21..41 = mano derecha  (rh)  landmark id 0..20  (offset +21)

Features por nodo: [x, y, z, mano]
  mano = 0 (izquierda) | 1 (derecha)
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ─── Conexiones MediaPipe ─────────────────────────────────────────────────────

HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),
    (9,13),(13,14),(14,15),(15,16),
    (13,17),(0,17),(17,18),(18,19),(19,20),
]

N_NODES    = 42   # 21 lh + 21 rh
N_FEATURES = 4    # x, y, z, mano
SEQ_LEN    = 30

# ─── Matriz de adyacencia normalizada (precomputada, fija) ───────────────────

def build_adjacency():
    """
    Construye A_hat = D^(-1/2) (A + I) D^(-1/2)
    para 42 nodos: lh(0-20) y rh(21-41).
    Sin conexiones inter-manos (son grafos separados dentro del mismo tensor).
    """
    A = np.zeros((N_NODES, N_NODES), dtype=np.float32)

    for a, b in HAND_CONNECTIONS:
        # lh
        A[a, b] = 1.0
        A[b, a] = 1.0
        # rh (offset +21)
        A[a + 21, b + 21] = 1.0
        A[b + 21, a + 21] = 1.0

    # Self-loops
    A += np.eye(N_NODES, dtype=np.float32)

    # Normalización simétrica: D^(-1/2) A D^(-1/2)
    deg = A.sum(axis=1)
    D_inv_sqrt = np.diag(1.0 / np.sqrt(deg + 1e-8))
    A_hat = D_inv_sqrt @ A @ D_inv_sqrt

    return torch.FloatTensor(A_hat)   # (42, 42)


A_HAT = build_adjacency()   # constante compartida


# ─── Capa GCN ─────────────────────────────────────────────────────────────────

class GCNLayer(nn.Module):
    """
    H' = σ( A_hat @ H @ W )
    Entrada : (batch, nodes, in_features)
    Salida  : (batch, nodes, out_features)
    """
    def __init__(self, in_features, out_features):
        super().__init__()
        self.linear = nn.Linear(in_features, out_features, bias=True)
        self.bn     = nn.BatchNorm1d(out_features)

    def forward(self, H, A_hat):
        # A_hat: (nodes, nodes) → expandir para batch
        B, N, _ = H.shape
        A_exp   = A_hat.unsqueeze(0).expand(B, -1, -1)   # (B, N, N)

        # Convolución: A_hat @ H
        AH = torch.bmm(A_exp, H)                          # (B, N, in_features)

        # Proyección lineal
        out = self.linear(AH)                             # (B, N, out_features)

        # BatchNorm sobre features (reshape para BN1d)
        out = self.bn(out.view(B * N, -1)).view(B, N, -1)

        return F.relu(out)


# ─── Bloque GCN (2 capas) ────────────────────────────────────────────────────

class HandGCN(nn.Module):
    """
    Extrae embedding espacial de un frame.
    Entrada : (batch, 42, 4)
    Salida  : (batch, gcn_hidden)  ← global mean pool
    """
    def __init__(self, in_features=N_FEATURES, hidden=32, out=64):
        super().__init__()
        self.gcn1 = GCNLayer(in_features, hidden)
        self.gcn2 = GCNLayer(hidden, out)
        self.drop = nn.Dropout(0.2)

    def forward(self, x, A_hat):
        h = self.gcn1(x, A_hat)           # (B, 42, 32)
        h = self.drop(h)
        h = self.gcn2(h, A_hat)           # (B, 42, 64)
        # Global mean pooling sobre nodos → embedding del grafo
        return h.mean(dim=1)              # (B, 64)


# ─── Modelo completo: GCN × frame → LSTM → clasificador ─────────────────────

class GCN_LSTM(nn.Module):
    """
    Para cada muestra de T frames:
      1. HandGCN procesa cada frame → embedding (B, 64)
      2. Stack de T embeddings     → (B, T, 64)
      3. LSTM                      → (B, lstm_hidden)
      4. Dense + Softmax           → (B, n_classes)

    Parámetros:
      n_classes   : número de señas
      gcn_hidden  : unidades intermedias del GCN (default 32)
      gcn_out     : tamaño del embedding por frame (default 64)
      lstm_hidden : unidades del LSTM (default 128)
      lstm_layers : capas del LSTM (default 2)
      seq_len     : frames por muestra (default 30)
    """
    def __init__(self, n_classes,
                 gcn_hidden=32, gcn_out=64,
                 lstm_hidden=128, lstm_layers=2,
                 seq_len=SEQ_LEN):
        super().__init__()

        self.seq_len = seq_len
        self.gcn     = HandGCN(N_FEATURES, gcn_hidden, gcn_out)

        self.lstm = nn.LSTM(
            input_size=gcn_out,
            hidden_size=lstm_hidden,
            num_layers=lstm_layers,
            batch_first=True,
            dropout=0.3 if lstm_layers > 1 else 0.0,
        )

        self.classifier = nn.Sequential(
            nn.Linear(lstm_hidden, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, n_classes),
        )

        # Registrar A_hat como buffer (se mueve con .to(device))
        self.register_buffer("A_hat", A_HAT)

    def forward(self, x):
        """
        x: (batch, seq_len, 42, 4)
        """
        B, T, N, F = x.shape

        # ── Aplicar GCN a cada frame ─────────────────────────────────────────
        # Reshapear para procesar todos los frames en un solo batch
        x_flat = x.view(B * T, N, F)                    # (B*T, 42, 4)
        emb    = self.gcn(x_flat, self.A_hat)            # (B*T, 64)
        emb    = emb.view(B, T, -1)                      # (B, T, 64)

        # ── LSTM sobre la secuencia temporal ─────────────────────────────────
        lstm_out, _ = self.lstm(emb)                     # (B, T, lstm_hidden)
        last         = lstm_out[:, -1, :]                # (B, lstm_hidden)

        # ── Clasificador ─────────────────────────────────────────────────────
        return self.classifier(last)                     # (B, n_classes)


# ─── Util: resumen rápido ─────────────────────────────────────────────────────

if __name__ == "__main__":
    model = GCN_LSTM(n_classes=4)
    dummy = torch.randn(8, SEQ_LEN, N_NODES, N_FEATURES)   # batch=8
    out   = model(dummy)
    print("✅ Arquitectura OK")
    print(f"   Entrada : {list(dummy.shape)}")
    print(f"   Salida  : {list(out.shape)}")
    print()
    total = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"   Parámetros entrenables: {total:,}")

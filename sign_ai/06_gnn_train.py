"""
06_gnn_train.py
Entrena la red GCN + LSTM con los datos de *_raw.csv.

Uso:
    cd sign_ai
    conda activate signara
    python 06_gnn_train.py
"""

import os
import glob
import json
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from core.gnn_model import GCN_LSTM, N_NODES, N_FEATURES, SEQ_LEN

# ─── Config ───────────────────────────────────────────────────────────────────

EPOCHS      = 120
BATCH_SIZE  = 16
LR          = 1e-3
DEVICE      = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_PATH  = "models/signara_gnn.pt"
LABEL_PATH  = "models/labels_gnn.json"

print(f"⚙  Dispositivo: {DEVICE}")

# ─── Dataset ──────────────────────────────────────────────────────────────────

def load_raw_csvs():
    """Carga y concatena todos los *_raw.csv de data/"""
    archivos = sorted(glob.glob("data/*_raw.csv"))
    if not archivos:
        raise FileNotFoundError("No se encontraron archivos *_raw.csv en data/")
    dfs = []
    for a in archivos:
        df = pd.read_csv(a)
        print(f"  📂 {a}: {len(df)} filas")
        dfs.append(df)
    return pd.concat(dfs, ignore_index=True)


def df_to_tensor(df_sample):
    """
    Convierte un sample (df de una muestra) a tensor (SEQ_LEN, 42, 4).
    Nodos 0-20 = lh (mano=0), nodos 21-41 = rh (mano=1).
    Features por nodo: [x, y, z, mano]
    """
    X = np.zeros((SEQ_LEN, N_NODES, N_FEATURES), dtype=np.float32)

    frames = sorted(df_sample["frame"].unique())

    for fi, frame in enumerate(frames[:SEQ_LEN]):
        df_f = df_sample[df_sample["frame"] == frame]

        # Mano izquierda → nodos 0-20
        df_lh = df_f[df_f["mano"] == 0]
        for _, row in df_lh.iterrows():
            lid = int(row["id"])
            if 0 <= lid < 21:
                X[fi, lid] = [row["x"], row["y"], row["z"], 0.0]

        # Mano derecha → nodos 21-41
        df_rh = df_f[df_f["mano"] == 1]
        for _, row in df_rh.iterrows():
            lid = int(row["id"])
            if 0 <= lid < 21:
                X[fi, lid + 21] = [row["x"], row["y"], row["z"], 1.0]

    return X   # (30, 42, 4)


class SignGraphDataset(Dataset):
    def __init__(self, samples, labels):
        self.samples = samples   # lista de arrays (30, 42, 4)
        self.labels  = labels    # lista de ints

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        x = torch.FloatTensor(self.samples[idx])   # (30, 42, 4)
        y = torch.LongTensor([self.labels[idx]])[0]
        return x, y


# ─── Cargar datos ─────────────────────────────────────────────────────────────

print("\n📂 Cargando datasets raw...")
df = load_raw_csvs()

df["frame"]   = df["frame"].astype(int)
df["muestra"] = df["muestra"].astype(int)
df["id"]      = df["id"].astype(int)
df["mano"]    = df["mano"].astype(int)

print(f"\n🧠 Clases detectadas: {sorted(df['label'].unique())}")
print(f"📊 Total muestras: {df.groupby(['label','muestra']).ngroups}")

le = LabelEncoder()
le.fit(df["label"].unique())
clases = list(le.classes_)

samples_X = []
samples_y = []

grupos = df.groupby(["label", "persona", "muestra"])
total  = len(grupos)

for i, ((label, persona, muestra_id), group) in enumerate(grupos):
    x = df_to_tensor(group)
    y = int(le.transform([label])[0])
    samples_X.append(x)
    samples_y.append(y)
    if (i + 1) % 50 == 0 or (i + 1) == total:
        print(f"  Procesados {i+1}/{total} samples...")

print(f"\n✅ {len(samples_X)} samples listos")

# ─── Split train / test ───────────────────────────────────────────────────────

X_train, X_test, y_train, y_test = train_test_split(
    samples_X, samples_y,
    test_size=0.15,
    stratify=samples_y,
    random_state=42
)

train_ds = SignGraphDataset(X_train, y_train)
test_ds  = SignGraphDataset(X_test,  y_test)

train_dl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,  drop_last=False)
test_dl  = DataLoader(test_ds,  batch_size=BATCH_SIZE, shuffle=False, drop_last=False)

print(f"📦 Train: {len(train_ds)} | Test: {len(test_ds)}")

# ─── Modelo ───────────────────────────────────────────────────────────────────

model = GCN_LSTM(n_classes=len(clases)).to(DEVICE)

total_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"\n🧠 Modelo: GCN + LSTM")
print(f"   Clases        : {clases}")
print(f"   Parámetros    : {total_params:,}")

optimizer = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-4)
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=20, gamma=0.5)
criterion = nn.CrossEntropyLoss()

# ─── Entrenamiento ────────────────────────────────────────────────────────────

print(f"\n🚀 Iniciando entrenamiento ({EPOCHS} épocas)...\n")

best_val_acc = 0.0

for epoch in range(1, EPOCHS + 1):

    # ── Train ──────────────────────────────────────────────────────────────
    model.train()
    train_loss = 0.0
    train_correct = 0

    for xb, yb in train_dl:
        xb, yb = xb.to(DEVICE), yb.to(DEVICE)
        optimizer.zero_grad()
        logits = model(xb)
        loss   = criterion(logits, yb)
        loss.backward()
        optimizer.step()
        train_loss    += loss.item() * len(xb)
        train_correct += (logits.argmax(1) == yb).sum().item()

    scheduler.step()

    # ── Validación ─────────────────────────────────────────────────────────
    model.eval()
    val_loss = 0.0
    val_correct = 0

    with torch.no_grad():
        for xb, yb in test_dl:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            logits  = model(xb)
            val_loss    += criterion(logits, yb).item() * len(xb)
            val_correct += (logits.argmax(1) == yb).sum().item()

    t_acc = train_correct / len(train_ds) * 100
    v_acc = val_correct   / len(test_ds)  * 100

    marker = " ⭐" if v_acc > best_val_acc else ""
    if v_acc > best_val_acc:
        best_val_acc = v_acc
        torch.save(model.state_dict(), MODEL_PATH)

    if epoch % 5 == 0 or epoch == 1:
        print(f"Epoch {epoch:03d}/{EPOCHS} | "
              f"loss {train_loss/len(train_ds):.4f} | "
              f"train {t_acc:.1f}% | val {v_acc:.1f}%{marker}")

# ─── Guardar labels ───────────────────────────────────────────────────────────

os.makedirs("models", exist_ok=True)
with open(LABEL_PATH, "w", encoding="utf-8") as f:
    json.dump(clases, f, ensure_ascii=False, indent=4)

print(f"\n✅ ENTRENAMIENTO COMPLETADO")
print(f"   Mejor val acc : {best_val_acc:.1f}%")
print(f"   Modelo        → {MODEL_PATH}")
print(f"   Labels        → {LABEL_PATH}")

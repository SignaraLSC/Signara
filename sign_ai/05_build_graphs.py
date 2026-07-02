"""
05_build_graphs.py
Lee *_raw.csv, construye grafos de manos por frame y los guarda como imágenes.

Estructura de salida:
  graphs/
    HOLA/
      muestra_1_frames.png   ← grid de 4 frames clave (0, 10, 20, 29)
      muestra_2_frames.png
    GRACIAS/
      ...

Uso:
    cd sign_ai
    conda activate signara
    python 05_build_graphs.py
"""

import os
import glob
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import networkx as nx

# ─── Conexiones MediaPipe (21 landmarks por mano) ─────────────────────────────

HAND_CONNECTIONS = [
    (0, 1),  (1, 2),  (2, 3),  (3, 4),    # pulgar
    (0, 5),  (5, 6),  (6, 7),  (7, 8),    # índice
    (5, 9),  (9, 10), (10, 11),(11, 12),  # medio
    (9, 13), (13, 14),(14, 15),(15, 16),  # anular
    (13,17), (0, 17), (17,18), (18,19),(19,20),  # meñique
]

LANDMARK_NAMES = [
    "WRIST",
    "THUMB_CMC","THUMB_MCP","THUMB_IP","THUMB_TIP",
    "INDEX_MCP","INDEX_PIP","INDEX_DIP","INDEX_TIP",
    "MIDDLE_MCP","MIDDLE_PIP","MIDDLE_DIP","MIDDLE_TIP",
    "RING_MCP","RING_PIP","RING_DIP","RING_TIP",
    "PINKY_MCP","PINKY_PIP","PINKY_DIP","PINKY_TIP",
]

# Colores por dedo (para nodos)
FINGER_COLORS = {
    0:  "#ffffff",  # WRIST — blanco
    1:  "#f97316", 2:  "#f97316", 3:  "#f97316", 4:  "#f97316",  # pulgar — naranja
    5:  "#22c55e", 6:  "#22c55e", 7:  "#22c55e", 8:  "#22c55e",  # índice — verde
    9:  "#3b82f6", 10: "#3b82f6", 11: "#3b82f6", 12: "#3b82f6",  # medio — azul
    13: "#a855f7", 14: "#a855f7", 15: "#a855f7", 16: "#a855f7",  # anular — morado
    17: "#ec4899", 18: "#ec4899", 19: "#ec4899", 20: "#ec4899",  # meñique — rosa
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def build_graph(df_frame, mano_val):
    """
    Construye un networkx.Graph para una mano (0=lh, 1=rh) en un frame.
    Nodos: id 0..20  con atributos x, y, z
    Aristas: HAND_CONNECTIONS
    """
    df_mano = df_frame[df_frame["mano"] == mano_val].set_index("id")

    G = nx.Graph()

    for lid in range(21):
        if lid in df_mano.index:
            row = df_mano.loc[lid]
            G.add_node(lid, x=float(row["x"]), y=float(row["y"]), z=float(row["z"]))
        else:
            G.add_node(lid, x=0.0, y=0.0, z=0.0)

    for a, b in HAND_CONNECTIONS:
        G.add_edge(a, b)

    return G


def draw_hand(ax, G, offset_x=0.0, title="", edge_color="#888888"):
    """
    Dibuja un grafo de mano en el eje `ax`.
    Proyección 2D: (x + offset_x, -y)  → MediaPipe y crece hacia abajo.
    """
    pos = {
        n: (G.nodes[n]["x"] + offset_x, -G.nodes[n]["y"])
        for n in G.nodes
    }

    node_colors = [FINGER_COLORS.get(n, "#ffffff") for n in G.nodes]

    nx.draw_networkx_edges(G, pos, ax=ax,
                           edge_color=edge_color, width=1.8, alpha=0.7)
    nx.draw_networkx_nodes(G, pos, ax=ax,
                           node_color=node_colors, node_size=60, linewidths=0.5,
                           edgecolors="#000000")
    nx.draw_networkx_labels(G, pos, ax=ax,
                            labels={n: str(n) for n in G.nodes},
                            font_size=5, font_color="#000000")
    if title:
        ax.set_title(title, fontsize=7, pad=2)
    ax.axis("off")


def plot_sample(df_sample, label, muestra_id, out_path, frames_to_show=(0, 10, 20, 29)):
    """
    Genera un grid de (len(frames_to_show) × 2) axes:
      columna izq = mano izquierda (lh)
      columna der = mano derecha (rh)
    para cada frame seleccionado.
    """
    n_frames = len(frames_to_show)
    fig, axes = plt.subplots(n_frames, 2,
                             figsize=(6, n_frames * 3),
                             facecolor="#1e1e2e")
    fig.suptitle(f"{label}  — muestra {muestra_id}", fontsize=10,
                 color="white", y=1.01)

    available_frames = sorted(df_sample["frame"].unique())

    for row_i, frame_i in enumerate(frames_to_show):
        # Usar el frame más cercano si el exacto no existe
        actual = min(available_frames, key=lambda f: abs(f - frame_i))
        df_frame = df_sample[df_sample["frame"] == actual]

        G_lh = build_graph(df_frame, mano_val=0)
        G_rh = build_graph(df_frame, mano_val=1)

        ax_lh = axes[row_i][0] if n_frames > 1 else axes[0]
        ax_rh = axes[row_i][1] if n_frames > 1 else axes[1]

        ax_lh.set_facecolor("#1e1e2e")
        ax_rh.set_facecolor("#1e1e2e")

        draw_hand(ax_lh, G_lh, title=f"Izq  (frame {actual})", edge_color="#6366f1")
        draw_hand(ax_rh, G_rh, title=f"Der  (frame {actual})", edge_color="#a855f7")

    # Leyenda de dedos
    legend_items = [
        mpatches.Patch(color="#ffffff", label="Muñeca"),
        mpatches.Patch(color="#f97316", label="Pulgar"),
        mpatches.Patch(color="#22c55e", label="Índice"),
        mpatches.Patch(color="#3b82f6", label="Medio"),
        mpatches.Patch(color="#a855f7", label="Anular"),
        mpatches.Patch(color="#ec4899", label="Meñique"),
    ]
    fig.legend(handles=legend_items, loc="lower center", ncol=6,
               fontsize=6, framealpha=0.3, labelcolor="white",
               facecolor="#1e1e2e")

    plt.tight_layout()
    plt.savefig(out_path, dpi=120, bbox_inches="tight",
                facecolor="#1e1e2e")
    plt.close(fig)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    archivos = sorted(glob.glob("data/*_raw.csv"))

    if not archivos:
        print("❌ No se encontraron archivos *_raw.csv en data/")
        print("👉 Primero ejecuta: python 01_pipeline.py")
        return

    print(f"📂 Archivos encontrados: {len(archivos)}")

    for archivo in archivos:
        persona = os.path.basename(archivo).replace("_raw.csv", "")
        print(f"\n👤 Procesando: {persona}")

        df = pd.read_csv(archivo)

        # Normalizar tipos de columna
        df["frame"]   = df["frame"].astype(int)
        df["muestra"] = df["muestra"].astype(int)
        df["id"]      = df["id"].astype(int)
        df["mano"]    = df["mano"].astype(int)

        labels   = df["label"].unique()
        total    = 0

        for label in sorted(labels):
            df_label = df[df["label"] == label]
            muestras = sorted(df_label["muestra"].unique())

            out_dir = os.path.join("graphs", label)
            os.makedirs(out_dir, exist_ok=True)

            print(f"  🧠 {label}: {len(muestras)} muestras")

            for muestra_id in muestras:
                df_sample = df_label[df_label["muestra"] == muestra_id]

                out_path = os.path.join(out_dir, f"{persona}_muestra_{muestra_id}.png")
                plot_sample(df_sample, label, muestra_id, out_path)
                total += 1

            print(f"     ✅ {len(muestras)} imágenes → graphs/{label}/")

        print(f"\n🎉 Total imágenes generadas: {total}")
        print(f"📁 Carpeta: graphs/")


if __name__ == "__main__":
    main()

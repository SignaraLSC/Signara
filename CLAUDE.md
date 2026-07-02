# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signara is a web application that translates between Spanish (text/voice) and sign language using avatars, and optionally recognizes sign language from camera input using an AI server.

Key features:
- Translate text or voice to LSM 3D animation (sign.mt + pose-viewer)
- Interpret sign language from camera to text (optional AI server on Render)

## Development Setup and Common Commands

### Prerequisites
- Node.js (v18 or higher)
- Python 3.11 (for optional AI server)

### Web Application (React/Vite)

Install dependencies:
```bash
npm install
```

Start development server:
```bash
npm run dev
```
Runs at http://localhost:5173 by default.

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

Run the local static server (optional, serves `dist` + proxy `/api/pose`):
```bash
npm run server
```
Default port 3001.

### AI Server (Optional, for camera recognition)

Navigate to `sign_ai` directory and follow these steps:

1. Create and activate virtual environment:
```bash
cd sign_ai
py -3.11 -m venv venv
venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements_api.txt
```

3. Start the server:
```bash
uvicorn api:app --port 8000
```
The server runs on http://localhost:8000.

### Deploy

- **Frontend:** Netlify (`netlify.toml` + `netlify/functions/pose.js` proxy hacia sign.mt)
- **Interpretar (ML):** Render (`sign_ai/`)

## Architecture and Structure

### Web Application (`src/` and `public/`)

- `src/`: React source code
  - `components/`: UI components (screens, avatar player, input panels, etc.)
  - `hooks/`: Custom React hooks (e.g., voice input)
  - `utils/`: Utility functions (text normalization, translation, sign mapping)
  - `App.jsx`: Main application component
  - `main.jsx`: React entry point
  - `index.css`: Global styles (Tailwind-based)

- `public/`: Static assets
  - Avatar videos (MP4) for different avatars and phrases
  - Logo, branding images
  - README files for video sets

### AI Server (`sign_ai/`)

- `api.py`: FastAPI server. Serves both `/predict` (sign recognition from 30×126
  hand-landmark frames) and `/sign/{token}` + `/animations` (recorded avatar
  animations). Uses `core/preprocess` + `core/confusion`.
- `core/`: Core modules — `config` (dimensions), `extractor` (holistic feature
  extraction), `gnn_model` (GCN+LSTM, 42 hand nodes), `preprocess`, `confusion`.
- `models/`: Pre-trained GNN model (`signara_gnn.pt`) and labels.
- `data/`: Datasets. Training consumes long-format `data/<persona>_raw.csv`
  (columns: `label,persona,muestra,frame,id,mano,x,y,z`).

Pipeline scripts (run from `sign_ai/`, Python 3.11):
- `00_capture.py` — **unified capture**. One recording session produces BOTH the
  training samples (`data/<persona>_raw.csv`) AND the canonical avatar animation
  (`animations/<SEÑA>.json`), plus a full-body backup under `data/raw_full/`.
  Keys: `S`=record a 30-frame sample, `A`=promote last sample to avatar animation.
- `05_build_graphs.py` — renders the hand graphs (nodes+edges) for inspection.
- `06_gnn_train.py` — trains the GCN+LSTM → `models/signara_gnn.pt`.
- `07_gnn_predict.py` — desktop real-time prediction (reference for the browser).
- `01_collect.py` / `04_record_animations.py` — legacy single-purpose capture,
  superseded by `00_capture.py`.

### The dataset serves both modules

The same landmark graph (nodes = MediaPipe landmarks, edges = `HAND_CONNECTIONS`)
feeds recognition **and** avatar animation. Recognition needs many varied samples
(all rows in `*_raw.csv`); the avatar needs one clean canonical take (`A` in
`00_capture.py`). To scale to torso/face later, extend `N_NODES`/`N_FEATURES` and
the adjacency in `core/gnn_model.py` and `MAX_FEATURES` in `core/config.py`, then
retrain — no re-recording needed (full body is already stored in `data/raw_full/`).

### Communication

- The web app communicates with the local translation API (`server.js`) for AI-powered text-to-sign translation when `.env` is configured.
- For camera recognition, the web app (when in "Interpretar" mode) sends video frames to the `sign_ai` API (`api.py`) running on port 8000 to get sign predictions.

### Key Technologies

- Web: React, Vite, Tailwind CSS, Three.js (for avatar animations)
- AI Server: FastAPI, PyTorch (GNN model), MediaPipe (hand landmark extraction)
- Translation: sign.mt API (`spoken_text_to_signed_pose`) vía Netlify Function o proxy local

## Common Development Tasks

### Adding a New Avatar Phrase (3D landmark avatar — primary)
1. Record it with `python 00_capture.py`, press `A` to save `animations/<SEÑA>.json`.
2. Start the ML API (`uvicorn api:app --port 8000`). `TranslationScreen` fetches
   `/animations`; any matched token plays in `AvatarSigner3D` (the primary avatar).
   Phrases without a recorded animation fall back to the sign.mt `PoseViewer`.

### Adding a New Avatar Phrase (MP4 fallback)
1. Place the MP4 in `public/videos/videos_avatar/<avatar_name>/<phrase>.mp4` (and _hombre/_mujer).
2. Reference it in `AvatarPlayer.jsx`.

### Modifying Translation Logic
- Edit `src/utils/translateText.js` for local translation rules.
- For AI translation, modify `server.js` (uses Anthropic and Google APIs).

### Updating Sign Mapping
- Edit `src/utils/signMap.js` which maps words/signs to video filenames.

### Working on AI Server
- Modify `sign_ai/api.py` for endpoint changes.
- Adjust feature extraction in `sign_ai/core/extractor.py`.
- Capture data + avatar takes with `00_capture.py`, then retrain with `06_gnn_train.py`.

## Testing

The project does not currently have a configured test framework. To add tests, consider setting up Vitest or Jest for React components, and pytest for the Python backend.

## Linting and Formatting

- CSS/Tailwind: Relies on Tailwind's default formatting.
- JavaScript/JSX: Consider configuring ESLint and Prettier if needed.
- Python: Use `flake8` or `black` for linting/formatting (not currently configured).

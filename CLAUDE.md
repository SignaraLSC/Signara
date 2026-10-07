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

- **Frontend:** Vercel (`vercel.json` + `api/pose.js`, función serverless que hace de proxy hacia sign.mt)
- **Interpretar (ML):** Render (`render.yaml` en la raíz, `rootDir: sign_ai`)

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

The full pipeline is: `00_capture.py` → `06_gnn_train.py` → `uvicorn api:app`.
(Legacy Keras/LSTM scripts `01_collect`/`02_train`/`03_realtime`/`04_record_animations`
and `merge_datasets.py` were removed — `00_capture.py` replaces all of them.)

### The dataset serves both modules

The same landmark graph (nodes = MediaPipe landmarks, edges = `HAND_CONNECTIONS`)
feeds recognition **and** avatar animation. Recognition needs many varied samples
(all rows in `*_raw.csv`); the avatar needs one clean canonical take (`A` in
`00_capture.py`). To scale to torso/face later, extend `N_NODES`/`N_FEATURES` and
the adjacency in `core/gnn_model.py` and `MAX_FEATURES` in `core/config.py`, then
retrain — no re-recording needed (full body is already stored in `data/raw_full/`).

### Communication

- For text/voice → sign, the web app requests a POSE animation from sign.mt through the `/api/pose` proxy (Vite dev proxy locally, `api/pose.js` serverless on Vercel). Recorded 3D animations served by the ML API (`/animations`, `/sign/{token}`) take priority when a token matches.
- For camera recognition, the web app (when in "Interpretar" mode) sends video frames to the `sign_ai` API (`api.py`) running on port 8000 to get sign predictions.

### Key Technologies

- Web: React, Vite, Tailwind CSS, Three.js (for avatar animations)
- AI Server: FastAPI, PyTorch (GNN model), MediaPipe (hand landmark extraction)
- Translation: sign.mt API (`spoken_text_to_signed_pose`) vía proxy `/api/pose` (Vite en dev, función serverless de Vercel en producción)

## Common Development Tasks

### Adding a New Avatar Phrase (3D landmark avatar — primary)
1. Record it with `python 00_capture.py`, press `A` to save `animations/<SEÑA>.json`.
2. Start the ML API (`uvicorn api:app --port 8000`). `TranslationScreen` fetches
   `/animations`; any matched token plays in `AvatarSigner3D` (the primary avatar).
   Phrases without a recorded animation fall back to the sign.mt `PoseViewer`.

### Modifying Translation Logic
- Edit `src/utils/translateText.js` (text → sign.mt POSE) and `src/utils/poseApi.js` (proxy paths).
- The proxy itself lives in `api/pose.js` (Vercel) and `vite.config.js` (dev).

### Working on AI Server
- Modify `sign_ai/api.py` for endpoint changes.
- Adjust feature extraction in `sign_ai/00_capture.py` (`extract_full`).
- Capture data + avatar takes with `00_capture.py`, then retrain with `06_gnn_train.py`.

### Directional verbs (spatial agreement)

LSC *verbos concordantes / direccionales* (AYUDA, PERDON, TE_AMO, …) change
origin→destination in space. Signara splits this into phases:

| Phase | Role | Key files | Status |
|-------|------|-----------|--------|
| **2 (avatar)** | Conjugated Spanish text → redirect one citation take in 3D | `src/utils/directionalVerbs.js`, `vrmBaker.js` | Done for AYUDA, PERDON, TE_AMO |
| **2B (camera)** | GNN returns citation gloss → geometric trajectory → conjugated word | `sign_ai/core/direction_reader.py`, `directional_verbs.py`, `api.py` | Partial; **OFF by default** |
| **3** | Deixis (point then sign) + real third-person locus / room memory | — | Not started (fixed side today) |

**AYUDA geometry (camera + avatar, 2026-07-25):**
- Forward push → citation `AYUDA` (not `TE_AYUDO`)
- Toward chest → `AYUDAME`
- Circular / lateral sweep → `AYUDANOS`
- `TE_AYUDO` = same motion as `AYUDA` + point at listener first → **Phase 3**

**Phase 2B:** `/predict` only gets hand landmarks `(T, 126)` (no shoulders).
Depth is approximated from projected hand size. Keep conjugation off unless
calibrating: set `SIGNARA_CONJUGATE=1` when starting uvicorn.

```bash
cd sign_ai
set SIGNARA_CONJUGATE=1
uvicorn api:app --port 8000 --reload
```

Smoke checks in Interpretar: forward AYUDA → `AYUDA` (never invent `TE_AYUDO`);
toward chest → `AYUDAME`; clear circular/sweep → `AYUDANOS`; static TE_AMO
(ILY) → `TE_AMO` (do not invent `ME_AMAS` without a clear chestward signal).
Keep direction keys (`self` / `listener` / `third` / `group_self` / …) in sync
between the JS and Python `DIRECTIONAL_VERBS` tables.

### SignPlan v1 (semantic intermediate representation)

Translation no longer has to couple Spanish words directly to avatar file
names. `src/utils/signPlan.js` defines the versioned intermediate contract with
six token types: `sign`, `phrase`, `temporal`, `pronoun`, `direction`, and
`facial`. Its formal JSON Schema is `src/schemas/signPlan.schema.json`; design
and examples live in `docs/sign-plan-v1.md`.

The production avatar still accepts string play tokens. Use
`compileSignPlanToPlayTokens(plan)` at that boundary. `direction` and `facial`
are modifiers and must never be queued as independent clips. Batch translation
already crosses this contract through `legacyPlayTokensToSignPlan`; later
semantic phases should replace that compatibility adapter rather than bypass
the plan. Validate changes with `npm run test:sign-plan`.

`src/data/semanticCatalog.js` is the versioned educational lexicon used before
literal matching. `src/utils/semanticCatalog.js` performs longest-match
segmentation and preserves understood-but-unrecorded meanings as
`availability: missing`; only available clips compile to the avatar queue.
Do not turn pending ambiguity notes into automatic LSC output without community
review. Validate catalog changes with `npm run test:semantic-catalog`.

### Desktop floating avatar (Tauri 2)

`src-tauri/` packages Signara as a Windows desktop app with two windows:
`main` (the normal app) and `overlay` (`/?overlay=1`, transparent, borderless,
resizable and always-on-top). The overlay UI is
`src/components/FloatingAvatarWidget.jsx`; native-safe window helpers live in
`src/utils/desktopWindow.js`. The tray is built in `src-tauri/src/lib.rs` and
must always provide a way to disable click-through again.

Use `npm run desktop:dev` for the native app or open `/?overlay=1` in the
normal Vite server for UI-only testing. Full instructions are in
`docs/desktop-widget.md`. Conversation memory v1 is implemented in
`src/utils/conversationContext.js`; validate it together with the incremental
window using `npm run test:conversation-context` and
`npm run test:context-window`.

### Words with multiple valid signs (variants)
Some words have more than one genuinely different way of signing them (e.g. a
regional LSC variant), as opposed to just stylistic differences between people.
- **Stylistic variation** (different person, speed, hand size): record under
  the **same label** — the GNN's augmentation + multi-person data already
  handles this.
- **Structural variation** (a truly different movement/handshape for the same
  word): record each one as a separate sub-label with a `_V<N>` suffix, e.g.
  `HOLA_V1`, `HOLA_V2` (`00_capture.py`'s `normalize_label` supports typing
  `"hola v1"`). They train as distinct classes (cleaner decision boundaries),
  but `core/confusion.py`'s `evaluate_prediction()` sums their probabilities
  under `canonical_label()` before deciding — so the API always returns the
  plain word (`HOLA`), and disagreement between variants of the *same* word
  is never treated as ambiguity (unlike disagreement between different words).
- The avatar only needs **one** canonical take per word: `save_animation()`
  always writes under the canonical name (strips `_V<N>`), regardless of
  which variant you promote with `A`.

## Testing

The project does not currently have a configured test framework. To add tests, consider setting up Vitest or Jest for React components, and pytest for the Python backend.

## Linting and Formatting

- CSS/Tailwind: Relies on Tailwind's default formatting.
- JavaScript/JSX: Consider configuring ESLint and Prettier if needed.
- Python: Use `flake8` or `black` for linting/formatting (not currently configured).

*Signara*

Conectando dos mundos que hoy no logran comunicarse.

Signara es una web app que traduce texto o voz en español a lengua de señas, reproduciendo las señas con un avatar animado.

Este repo es el MVP de hackathon: frontend completamente funcional, con integración a IA en progreso (Claude + modelo propio con MediaPipe), actualmente en fase de dataset y entrenamiento.

Módulo IA (nuevo)

Este proyecto también incluye un backend de IA para reconocimiento de señas:

Captura de mano con MediaPipe
Entrenamiento de modelo con datasets propios
Predicción en tiempo real de letras/palabras
API lista para conectar con frontend (FastAPI)

Requisitos del sistema
IMPORTANTE

Usar:

Python 3.11 (OBLIGATORIO)

❌ NO usar Python 3.12 o superior (incompatible con MediaPipe en algunos casos)

Descargar aquí:
https://www.python.org/downloads/release/python-3119/


Instalación completa (frontend + IA)
1. Clonar o actualizar repo:
git pull origin main

Si hay cambios locales y quieren limpiar todo:

git reset --hard origin/main
git clean -fd

2. Crear entorno virtual (IA)

py -3.11 -m venv venv

3. Activar entorno

venv\Scripts\activate

4. Instalar dependencias (IA)

pip install -r requirements.txt

5. Instalar frontend

npm install



Ejecución del proyecto
Frontend:

npm run dev

http://localhost:5173

IA (captura de señas: datos + animación del avatar)

python 00_capture.py

IA (entrenar el modelo)
python 06_gnn_train.py

IA (servidor)
uvicorn api:app --port 8000


Estructura 
Signara/
├── public/
│   ├── logo.svg
│   ├── pose-viewer/       # visor de poses (sign.mt)
│   └── videos/
├── src/ (Frontend React)
│
├── sign_ai/ (Backend IA)
│   ├── 00_capture.py      # captura única (datos + avatar)
│   ├── 05_build_graphs.py # visualiza grafos de manos
│   ├── 06_gnn_train.py    # entrenamiento GNN
│   ├── 07_gnn_predict.py  # predicción en vivo (escritorio)
│   ├── core/              # config, gnn_model, preprocess, confusion
│   ├── models/            # signara_gnn.pt + labels
│   ├── api.py             # FastAPI (/predict, /sign, /animations)
│   └── requirements_api.txt
│
├── package.json
└── README.md


Flujo del sistema
Cámara → MediaPipe → Landmarks → Modelo IA → Letra/Seña → Frontend React

Stack
Frontend
React 18 + Vite
Tailwind CSS 3
Web Speech API
IA
Python 3.11
MediaPipe
OpenCV
Scikit-learn / TensorFlow (según modelo)
FastAPI (backend)

Estructura Frontend (original)

(se mantiene igual que tu versión actual)

Signara/
├── public/
│   ├── logo.svg
│   └── videos/
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   ├── components/
│   ├── hooks/
│   └── utils/
 
Conexión futura con IA

Frontend → API Python:

fetch("http://127.0.0.1:8000/predict", {
  method: "POST",
  body: formData
})

Respuesta:

{
  "prediction": "A"
}

Estado actual del proyecto
✔ Frontend completo
✔ Voz a texto funcionando
✔ UI lista para demo
🟡 Dataset en construcción
🟡 Modelo IA en entrenamiento
🔴 Integración full en progreso




📌Reglas del equipo
❌ No usar Python 3.12+
❌ No trabajar sin venv activado
❌ Hacer git pull antes de programar
✔ Mantener dataset organizado
✔ Sincronizar cambios constantemente


Objetivo del MVP
Traducir texto/voz → señas
Reconocer señas con cámara
Mostrar avatar en tiempo real

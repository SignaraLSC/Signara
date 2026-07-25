# Deploy API (Render)

Build Command (Root Directory = `sign_ai`):

```text
pip install -r requirements_api.txt
```

Start Command:

```text
uvicorn api:app --host 0.0.0.0 --port $PORT
```

Env: `PYTHON_VERSION=3.11.0`

No uses `requirements.txt` en Render: incluye deps de captura Windows.

<!--
  Plantilla de Pull Request de Signara.
  Rellena las secciones y marca las casillas. Revisor por defecto: @xxAlizzamxx
-->

## 📝 ¿Qué hace este PR? (una línea)


## 🎯 ¿Por qué? (motivo / problema que resuelve)


## 📦 ¿Qué se tocó? (marca lo que aplique)
- [ ] Frontend / UI (`src/`)
- [ ] Modo Interpretar (cámara → texto/voz)
- [ ] Modo Traducir / Avatar 3D (`AvatarSigner3D`, `TranslationScreen`)
- [ ] Servidor de IA (`sign_ai/api.py`, `core/`)
- [ ] Modelo o dataset (`00_capture.py`, `06_gnn_train.py`, `models/`, `data/`)
- [ ] Configuración / deploy (`vite.config`, `vercel.json`, `render.yaml`)
- [ ] Documentación (`README`, `CLAUDE.md`)

## ✅ Checklist del autor (antes de pedir revisión)
- [ ] Trabajé en **mi propia rama**, NO en `main`
- [ ] Hice `git pull` de `main` antes de empezar (sin conflictos sin resolver)
- [ ] `npm run build` compila **sin errores**
- [ ] `npm run lint` sin errores nuevos
- [ ] Si toqué Python: usé **Python 3.11** y el servidor levanta (`uvicorn api:app --port 8000`)
- [ ] Si toqué el modelo: re-entrené (`06_gnn_train.py`) y probé Interpretar
- [ ] **No subí** `venv/`, `node_modules/`, `dist/`, ni archivos pesados/innecesarios
- [ ] No dejé código muerto, `console.log` de prueba, ni imports rotos
- [ ] Actualicé `README.md` / `CLAUDE.md` si cambié algo importante

## 🔎 Checklist del revisor — @xxAlizzamxx
- [ ] El código hace lo que dice el PR (probado localmente)
- [ ] `npm run build` compila en mi máquina
- [ ] **No rompe** el modo Interpretar ni el modo Traducir
- [ ] Sin credenciales / API keys / rutas personales en el código
- [ ] Sin duplicados ni código muerto; nombres y estilo consistentes
- [ ] Los archivos tocados tienen sentido con lo que dice el PR

## 🧪 ¿Cómo lo pruebo? (pasos para el revisor)
1.
2.

## 📸 Capturas o video (si es visual)


## 📌 Notas / pendientes


---
*Revisor asignado: **@xxAlizzamxx**  ·  No se hace merge sin su aprobación.*

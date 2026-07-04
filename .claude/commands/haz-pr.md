---
description: Crea un Pull Request de la rama actual usando el formato oficial de Signara
argument-hint: "[título opcional del PR]"
---

Crea un Pull Request de la rama actual hacia `main` usando el formato oficial del proyecto. Sigue estos pasos:

1. **Verifica la rama.** Corre `git branch --show-current`. Si estás en `main`, DETENTE y avisa: hay que trabajar en una rama propia (ofrece crear una con `git checkout -b <nombre>`).

2. **Revisa cambios pendientes.** `git status` y `git diff origin/main...HEAD`. Si hay cambios sin commitear, muéstralos y commitéalos con un mensaje claro (terminando con el trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

3. **Verifica que compila** antes de abrir el PR: `npm run build` (y `npm run lint` si existe). Si algo falla, NO abras el PR: reporta el error.

4. **Sube la rama:** `git push -u origin <rama-actual>`.

5. **Rellena el formato** de `.github/pull_request_template.md` con base en el diff real:
   - "¿Qué hace?" y "¿Por qué?" según los cambios.
   - Marca las casillas de "¿Qué se tocó?" según los archivos modificados.
   - Marca el checklist del autor **solo con lo que verificaste de verdad** (build, lint, etc.).
   - Deja el checklist del revisor sin marcar (lo hace @xxAlizzamxx).
   - Añade pasos de "¿Cómo lo pruebo?".

6. **Crea el PR:** `gh pr create --base main --head <rama-actual> --title "<título>" --body-file <cuerpo>`.
   - Si hay un título en los argumentos (`$ARGUMENTS`), úsalo; si no, genera uno claro en una línea.
   - Si el autor NO es `xxAlizzamxx`, añade `--reviewer xxAlizzamxx`. (GitHub no permite auto-asignarse; si el autor es xxAlizzamxx, omítelo.)

7. **Devuelve el enlace** del PR creado y recuerda: no se mergea sin la aprobación de @xxAlizzamxx (o del agente `signara-pr-reviewer` si queda limpio).

// Replay read-only de tomas completas: verifica compatibilidad, no precisión
// con nuevos firmantes. No escribe datos, animaciones ni checkpoints.
import fs from 'node:fs/promises'
import path from 'node:path'
import { findGestureAttemptStart, refineSpellingAttempt, trimHeldGestureFrames } from '../src/utils/interpretTemporal.js'

const root = process.argv[2] || 'sign_ai/data/raw_full'
const limit = Number(process.argv[3] || 10)
if (!Number.isInteger(limit) || limit < 1) throw new Error('Cantidad de tomas inválida')
const base = process.env.SIGNARA_AUDIT_API || 'http://127.0.0.1:8000'
const health = await fetch(`${base}/health`).then(response => response.json())
if (!health.hybrid_model_loaded) throw new Error('Se requiere API híbrida activa')
const files = (await fs.readdir(root, { recursive: true })).sort()
async function read(frames) {
  const response = await fetch(`${base}/predict/sequence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, letters_only: true }), signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
let regressions = 0
console.log('Compatibilidad con tomas que pueden haber participado en entrenamiento; NO precisión en cámara.')
for (const label of ['G', 'H', 'J', 'S', 'Z', 'Ñ']) {
  let takes = 0, unchanged = 0
  const changes = []
  for (const name of files) {
    if (!path.basename(name).startsWith(`${label}_`) || !name.endsWith('.json')) continue
    const take = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'))
    if (take.train_frames == null && take.frames.length === 24) continue
    const frames = take.frames.map(frame => [...frame.lh, ...frame.rh].flat())
    for (const doubled of [false, true]) {
      const input = doubled ? frames.flatMap(frame => [frame, frame]) : frames
      if (input.length > 180) continue
      const before = await read(trimHeldGestureFrames(input))
      const attemptStart = findGestureAttemptStart(input)
      const separated = input.slice(attemptStart)
      const initial = attemptStart ? await read(trimHeldGestureFrames(separated)) : before
      const refined = await refineSpellingAttempt(separated, initial, read)
      if (before.prediction === refined.result.prediction) unchanged++
      else {
        changes.push({ name, doubled, attemptStart, before: before.prediction, after: refined.result.prediction })
        regressions += before.prediction === label && refined.result.prediction !== label ? 1 : 0
      }
    }
    if (++takes >= limit) break
  }
  if (!takes) throw new Error(`Sin tomas completas para ${label}`)
  console.log(JSON.stringify({ label, takes, unchanged, changes }))
}
if (regressions) throw new Error(`${regressions} respuestas correctas empeoraron al separar intentos`)

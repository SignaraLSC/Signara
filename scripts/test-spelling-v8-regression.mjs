// Read-only regression of the attached v8 trace. This checks saved queries,
// not a full camera/latency/unlock simulation or accuracy with new signers.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {
  findGestureAttemptStart, hasHandTrajectory, prefetchSpellingBoundary,
  refineSpellingAttempt, retainMotionVotesAfterBoundary, shouldConfirmLetter,
  trimHeldGestureFrames,
} from '../src/utils/interpretTemporal.js'

const path = process.argv[2]
if (!path) throw Error('Uso: node scripts/test-spelling-v8-regression.mjs ruta/signara-traza-v8.json')
const trace = JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
assert.equal(trace.pipelineRevision, 'spelling-attempts-v8')
const keys = trace.frames.map(frame => frame.join(','))
function captured(query) {
  const end = keys.indexOf(query.frames.at(-1).join(','))
  assert.ok(end >= query.capturedFrames - 1, 'el diagnóstico conserva la consulta completa')
  return trace.frames.slice(end + 1 - query.capturedFrames, end + 1)
}
const base = process.env.SIGNARA_AUDIT_API || 'http://127.0.0.1:8000'
async function read(frames) {
  const response = await fetch(`${base}/predict/sequence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, letters_only: true }), signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw Error(`HTTP ${response.status}`)
  return response.json()
}

const firstFrames = captured(trace.predictions[35])
const secondCapture = captured(trace.predictions[36])
const boundary = findGestureAttemptStart(secondCapture)
assert.equal(boundary, 7, 'reproducir el recorte que borraba el voto de Ñ')
const secondFrames = trimHeldGestureFrames(secondCapture.slice(boundary))
const first = await read(trimHeldGestureFrames(firstFrames))
const second = await read(secondFrames)
assert.equal(first.prediction, 'Ñ')
assert.equal(second.prediction, 'Ñ')
const retained = retainMotionVotesAfterBoundary([{ ...first, frames: firstFrames }], secondCapture.slice(boundary))
assert.equal(retained.length, 1, 'el recorte mantiene suficiente trazo respaldado de la misma Ñ')
assert.equal(shouldConfirmLetter({
  prediction: second.prediction, confidence: second.confidence, sequence: true,
  stable: retained[0].prediction === second.prediction, probe: true, alphabetOnly: true,
  hasMotion: hasHandTrajectory(secondFrames), windowMinConfidence: Math.min(first.confidence, second.confidence),
}), true, 'Ñ pasa consenso sin bajar umbrales ni esperar a retirar la mano')
console.log(`Ñ q35/q36: ${first.confidence.toFixed(3)}/${second.confidence.toFixed(3)}; frontera=7; consenso conservado`)

const gCapture = captured(trace.predictions[68])
assert.equal(gCapture.length, 151)
let calls = 0
const boundaryRead = prefetchSpellingBoundary(gCapture, async frames => { calls++; return read(frames) })
const whole = await read(trimHeldGestureFrames(gCapture))
const refined = await refineSpellingAttempt(gCapture, whole, boundaryRead)
assert.equal(refined.selectedShapeStart, 140)
assert.equal(refined.result.prediction, 'G')
assert.equal(calls, 1, 'la frontera no añade un segundo viaje secuencial')
console.log(`G q68: 151→${refined.frames.length} cuadros; frontera=140; respaldo en paralelo`)
console.log('OK regresión de consultas v8; no equivale a una prueba completa en vivo')

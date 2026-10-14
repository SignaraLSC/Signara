// Replay read-only de consultas guardadas y resolución de salida. No simula
// toda la cámara, nuevas consultas, latencia ni exactitud con otros firmantes.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {
  appendSpellingCandidate, visibleSpellingLetters, recheckStaticSpellingPose,
  isPoseSettled, isDownwardFingerPoseSettled, shouldConfirmLetter,
} from '../src/utils/interpretTemporal.js'

const path = process.argv[2]
if (!path) throw Error('Uso: node scripts/test-spelling-v13-regression.mjs ruta/signara-traza-v13.json')
const trace = JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
assert.equal(trace.pipelineRevision, 'spelling-boundaries-consensus-v9')
assert.equal(trace.predictions.length, 27)
const base = process.env.SIGNARA_AUDIT_API || 'http://127.0.0.1:8000'
const health = await fetch(`${base}/health`).then(response => response.json())
assert.equal(health.hybrid_model_loaded, true)
async function read(frames, endpoint = '/predict/sequence', lettersOnly = true) {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, letters_only: lettersOnly }), signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw Error(`HTTP ${response.status}`)
  return response.json()
}

const extraM = trace.predictions[17]
assert.equal(extraM.poseRecheck.prediction, 'M')
const oldM = await recheckStaticSpellingPose('M', extraM.poseRecheck.frames,
  frames => read(frames, '/predict'))
assert.equal(oldM.result.prediction, 'M', 'reproducir la M errónea en la ruta antigua')
const recentN = await read(extraM.poseRecheck.frames)
assert.equal(recentN.prediction, 'N')
const newM = await recheckStaticSpellingPose('M', extraM.poseRecheck.frames, read, { sequence: true })
assert.equal(newM, null, 'rechazar la M extra, no reetiquetarla a la fuerza')
assert.equal(shouldConfirmLetter({
  prediction: 'M', confidence: extraM.confidence, sequence: true, stable: true,
  probe: extraM.probe, alphabetOnly: true, handStill: false, hasMotion: true,
  shapeChanged: extraM.shapeChanged, poseSettled: false,
  currentPoseValidated: false, staticFingerPoseSettled: false,
  windowMinConfidence: 0.99,
}), false)
console.log(`M extra q17: legado=${oldM.result.prediction}; híbrido reciente=${recentN.prediction}; confirmación M rechazada`)

// Las mismas entradas de las letras que sí funcionan siguen intactas.
for (const [index, expected] of [[2, 'G'], [14, 'M'], [19, 'N'], [25, 'Ñ']]) {
  const query = trace.predictions[index]
  const result = await read(query.frames, '/predict/sequence', query.lettersOnly)
  assert.equal(result.is_idle, false)
  assert.equal(result.prediction, expected)
  console.log(`q${index}: ${expected} conservada (${result.confidence.toFixed(3)})`)
}

const settledN = trace.predictions[19]
const prefixN = trace.predictions[21]
assert.equal(isPoseSettled(settledN.frames), true)
assert.equal(isPoseSettled(prefixN.frames), false)
assert.equal(isDownwardFingerPoseSettled(prefixN.frames, 'N'), true,
  'la forma de dos dedos estable no implica que haya terminado su movimiento')
let output = appendSpellingCandidate(['G', 'M'], null, 'N', !settledN.currentPoseSettled)
output = appendSpellingCandidate(output.letters, output.pendingIndex, 'N', !prefixN.currentPoseSettled)
assert.deepEqual(visibleSpellingLetters(output.letters, output.pendingIndex), ['G', 'M', 'N'])

const keys = trace.frames.map(frame => frame.join(','))
const start = keys.indexOf(prefixN.frames.at(-1).join(',')) + 1
const end = keys.indexOf(trace.predictions[25].frames.at(-1).join(','))
assert.ok(start > 0 && end >= start)
for (let i = start; i <= end; i++) {
  const captured = trace.frames.slice(start, i + 1)
  assert.equal(isPoseSettled(captured) && isDownwardFingerPoseSettled(captured, 'N'), false,
    'el arranque móvil de Ñ no confirma prematuramente una N en los cuadros siguientes')
}
output = appendSpellingCandidate(output.letters, output.pendingIndex, 'Ñ')
assert.deepEqual(visibleSpellingLetters(output.letters, output.pendingIndex), ['G', 'M', 'N', 'Ñ'])
console.log('Salida: G M N Ñ; N quieta conservada, prefijo móvil N reemplazado solo al corroborar Ñ')
console.log('OK v13: consultas guardadas + resolución de salida; falta comprobar la nueva sesión en cámara')

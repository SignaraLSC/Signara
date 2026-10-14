// Diagnóstico read-only: repetir consultas reales sin entrenar, guardar pesos
// ni asumir que la predicción original era la etiqueta correcta del usuario.
import fs from 'node:fs/promises'
import { basename } from 'node:path'
import {
  findGestureAttemptStart, refineSpellingAttempt, recheckStaticSpellingPose, stabilizeSingleHand, trimHeldGestureFrames,
  retainMotionVotesAfterBoundary,
  isStaticFingerPoseSettled, isDownwardFingerPoseSettled, sameFingerConfiguration, shouldConfirmLetter, isPoseSettled, hasHandTrajectory,
} from '../src/utils/interpretTemporal.js'

const paths = process.argv.slice(2)
if (!paths.length) throw new Error('Uso: node scripts/replay-spelling-trace.mjs "ruta a traza.json" ...')
const base = process.env.SIGNARA_AUDIT_API || 'http://127.0.0.1:8000'
async function read(frames, lettersOnly, endpoint = '/predict/sequence') {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, letters_only: lettersOnly }), signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
const health = await fetch(`${base}/health`).then(response => response.json())
if (!health.hybrid_model_loaded) throw new Error('Esta auditoría requiere API con el híbrido activo')
for (const path of paths) {
  const trace = JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  console.log(`\n${basename(path)} — replay de consultas; NO es precisión con etiquetas verificadas`)
  // Reconstituir referencias compartidas de cuadros guardados para comprobar
  // si una frontera conserva evidencia de la consulta anterior. No simula
  // toda la cámara, sus latencias, bloqueos ni consultas posteriores nuevas.
  const frameRefs = new Map()
  const reference = frame => {
    const key = frame.join(',')
    if (!frameRefs.has(key)) frameRefs.set(key, frame)
    return frameRefs.get(key)
  }
  let votes = []
  for (const [index, query] of trace.predictions.entries()) {
    if (!Array.isArray(query.frames)) throw new Error(`Consulta ${index}: faltan cuadros exactos`)
    let previous = null, swaps = 0
    const frames = query.frames.map(frame => {
      const corrected = stabilizeSingleHand(frame, previous)
      if (corrected !== frame) swaps++
      previous = corrected
      return reference(corrected)
    })
    if (index && trace.predictions[index-1].decision === 'accepted') votes = []
    const retainedInput = query.attemptStart || query.preparationFrames || query.selectedShapeStart
    if (retainedInput) votes = retainMotionVotesAfterBoundary(votes, frames)
    let start = findGestureAttemptStart(frames)
    let input = trimHeldGestureFrames(frames.slice(start))
    if (start) votes = retainMotionVotesAfterBoundary(votes, frames.slice(start))
    let result = await read(input, query.lettersOnly)
    let shapeStart = 0
    if (query.lettersOnly) {
      const refined = await refineSpellingAttempt(frames.slice(start), result, input => read(input, true))
      shapeStart = refined.shapeStart
      if (refined.selectedShapeStart) {
        start += refined.selectedShapeStart
        input = trimHeldGestureFrames(refined.frames)
        result = refined.result
        votes = retainMotionVotesAfterBoundary(votes, refined.frames)
      }
    }
    const poseRecheck = await recheckStaticSpellingPose(result.prediction, frames.slice(start),
      input => read(input, true), { sequence: true })
    if (!result.prediction || result.is_idle) votes = []
    else votes = [...votes, { ...result, frames: input }].slice(-2)
    const staticFingerPoseSettled = (result.pose_evidence?.label === result.prediction &&
      isDownwardFingerPoseSettled(frames.slice(start), result.prediction)) ||
      (isStaticFingerPoseSettled(frames.slice(start)) && sameFingerConfiguration(input.at(-1), frames.at(-1)))
    const wouldConfirm = shouldConfirmLetter({
      prediction: result.prediction, confidence: result.confidence,
      stable: votes.length === 2 && votes.every(vote => vote.prediction === result.prediction),
      sequence: true, probe: query.probe, alphabetOnly: query.lettersOnly,
      hasMotion: hasHandTrajectory(input), handStill: query.queryPoseSettled,
      shapeChanged: query.shapeChanged, poseSettled: isPoseSettled(frames),
      windowMinConfidence: votes.length ? Math.min(...votes.map(vote => vote.confidence)) : 0,
      staticFingerPoseSettled,
    })
    console.log(index, `antes=${query.prediction || '—'} (${query.decision})`,
      `ahora=${result.prediction || '—'} ${result.confidence.toFixed(3)}`,
      `cuadros=${query.frames.length}→${input.length}`, `corte=${start}`, `forma=${shapeStart}`, `slots=${swaps}`,
      `pose=${poseRecheck?.result.prediction || '—'}`, `dedosQuietos=${staticFingerPoseSettled}`,
      `confirmable=${wouldConfirm}`, result.recognition_source)
  }
}

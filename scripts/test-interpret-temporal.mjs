import assert from 'node:assert/strict'
import {
  MAX_GESTURE_FRAMES,
  resampleGestureFrames,
  shouldProbeWhileSigning,
  shouldUnlockSpellingStroke,
  shouldConfirmLetter,
  usesAlphabetOnly,
  shouldCloseSpelling,
  hasHandTrajectory,
  shouldConfirmWord,
  trimHeldGestureFrames,
  isPoseSettled,
  preserveShapeChangeStart,
  confirmedPoseSnapshot,
  preserveMotionPreparation,
  shouldUnlockChangedShape,
  stabilizeSingleHand,
  findGestureAttemptStart,
  findSpellingShapeStart,
  refineSpellingAttempt,
  retainMotionVotesAfterBoundary,
  prefetchSpellingBoundary,
  recheckStaticSpellingPose,
  appendSpellingCandidate,
  visibleSpellingLetters,
  isStaticFingerPoseSettled,
  isDownwardFingerPoseSettled,
  hasFingerPendulumTrajectory,
  newFrameCountSinceQuery,
  sameFingerConfiguration,
  hasWristTrajectory,
} from '../src/utils/interpretTemporal.js'
import { looksLikeIly, maybeCorrectTeAmo } from '../src/utils/handshapeHints.js'

const long = Array.from({ length: 48 }, (_, i) => [i, i * 2])
assert.equal(newFrameCountSinceQuery(long, long.at(-1)), 0)
assert.equal(newFrameCountSinceQuery(long, long.at(-4)), 3)
assert.equal(newFrameCountSinceQuery(long, null), 48)
assert.equal(newFrameCountSinceQuery(long.slice(30), long[12]), 18, 'un nuevo intento no hereda el contador de otro')
const preparationQuery = long.slice(0, 24)
assert.deepEqual(preserveMotionPreparation(long, preparationQuery, 6), long.slice(6),
  'la preparación no vuelve a contaminar la siguiente consulta y se conserva lo llegado durante la API')
assert.equal(preserveMotionPreparation(long, preparationQuery, 0), long)
assert.equal(preserveMotionPreparation(long, preparationQuery, 19), long, 'no cortar el trazo por debajo de seis cuadros')
assert.equal(preserveMotionPreparation(long, preparationQuery, 2.5), long)
assert.equal(preserveMotionPreparation(long.slice(30), preparationQuery, 6).length, 18,
  'una respuesta cuyo ancla ya no está en el buffer no corta un gesto posterior')
assert.equal(preparationQuery.length, 24)
const sampled = resampleGestureFrames(long)
assert.equal(sampled.length, 24)
assert.deepEqual(sampled[0], [0, 0])
assert.deepEqual(sampled.at(-1), [47, 94])
assert.ok(sampled[12][0] < 30, 'se conserva el inicio, no solo los últimos 24')
assert.equal(long.length, 48, 'el remuestreo no altera el buffer original')
assert.equal(resampleGestureFrames([[0], [10]], 3)[1][0], 5)
assert.deepEqual(resampleGestureFrames([[7]], 3), [[7], [7], [7]])
assert.ok(MAX_GESTURE_FRAMES > 24)

assert.equal(usesAlphabetOnly([]), false, 'la primera letra compite con todo el vocabulario')
assert.equal(usesAlphabetOnly(['A']), true, 'una sola letra ya activa el alfabeto')
assert.equal(usesAlphabetOnly(['A', 'H', 'Ñ']), true, 'no volver a palabras dentro del nombre')
const closing = { spelling: true, locked: true, inFlight: false, handStill: true, now: 2000, lastActivityAt: 100 }
assert.equal(shouldCloseSpelling(closing), true, 'una pausa cierra sin retirar las manos')
for (const change of [{ locked: false }, { inFlight: true }, { handStill: false }, { now: 1500 }]) {
  assert.equal(shouldCloseSpelling({ ...closing, ...change }), false, 'no cerrar a mitad de letra')
}
const word = { prediction: 'BIEN', stable: true, confidence: 0.99, minConfidence: 0.8, finalized: false, handStill: false, spelling: false }
assert.equal(shouldConfirmWord(word), false, 'BIEN no sustituye la postura intermedia de G')
assert.equal(shouldConfirmWord({ ...word, handStill: true }), true, 'BIEN real permanece disponible')
assert.equal(shouldConfirmWord({ ...word, prediction: 'POR_FAVOR' }), true, 'palabras dinámicas siguen reconociéndose en movimiento')
assert.equal(shouldConfirmWord({ ...word, prediction: 'POR_FAVOR', spelling: true }), false, 'ninguna palabra se emite dentro del deletreo')
assert.equal(shouldConfirmWord({ ...word, prediction: 'SI', stable: true, inputFrames: 6, hasMotion: false }), false,
  'dos peticiones de los mismos seis cuadros quietos no prueban SI')
assert.equal(shouldConfirmWord({ ...word, prediction: 'HOLA', stable: true, inputFrames: 6, hasMotion: true }), true,
  'la toma canónica HOLA de seis cuadros con recorrido no se bloquea')

const slow = Array.from({ length: 10 }, (_, i) => {
  const frame = Array(126).fill(0)
  for (let id = 0; id < 21; id++) {
    frame[63 + id * 3] = 0.4 + (id % 5) * 0.015 + i * 0.006
    frame[64 + id * 3] = 0.4 + Math.floor(id / 5) * 0.025
  }
  return frame
})
assert.equal(hasHandTrajectory(slow), true, 'un trazo lento no necesita saltos grandes por cuadro')
const held = Array.from({ length: 12 }, () => [...slow.at(-1)])
const swapped = [...slow[0].slice(63), ...slow[0].slice(0, 63)]
assert.deepEqual(stabilizeSingleHand(swapped, slow[0]), slow[0], 'un giro no cambia de slot la misma muñeca')
assert.equal(stabilizeSingleHand(swapped, null), swapped, 'no asumir identidad de una mano nueva')
const bothHands = [...slow[0].slice(63), ...slow[0].slice(63)]
assert.equal(stabilizeSingleHand(bothHands, slow[0]), bothHands, 'no intercambiar dos manos reales')
const distant = swapped.map((value, i) => i < 63 && i % 3 === 0 ? value + 0.7 : value)
assert.equal(stabilizeSingleHand(distant, slow[0]), distant, 'no asignar otra muñeca lejana al seguimiento anterior')
const nextStroke = slow.map(frame => frame.map((v, i) => i >= 63 && i % 3 === 0 ? v + 0.06 : v))
const attempts = [...slow, ...held, ...nextStroke]
const boundary = findGestureAttemptStart(attempts)
assert.ok(boundary > slow.length, 'el intento rechazado no contamina el siguiente tras una pausa')
assert.deepEqual(attempts.slice(boundary).at(-1), nextStroke.at(-1), 'preservar el final del nuevo recorrido')
assert.ok(attempts.slice(boundary).includes(nextStroke[0]), 'conservar el principio del nuevo recorrido')
assert.equal(findGestureAttemptStart([...slow, ...held.slice(0, 2), ...nextStroke]), 0,
  'una esquina breve no separa una seña en dos')
assert.equal(findGestureAttemptStart(held), 0, 'sostener una postura no genera intentos')
const motionVoteFrames = slow.slice(0, 9)
const motionVotes = [{ prediction: 'Ñ', confidence: .99, frames: motionVoteFrames }]
assert.equal(retainMotionVotesAfterBoundary(motionVotes, slow.slice(2)).length, 1,
  'quitar preparación del mismo recorrido no borra el primer voto Ñ')
assert.equal(retainMotionVotesAfterBoundary(motionVotes, slow.slice(6)).length, 0,
  'pocos cuadros heredados de otro intento no corroboran una letra nueva')
assert.equal(retainMotionVotesAfterBoundary(motionVotes, slow.map(frame => [...frame])).length, 0,
  'otra secuencia de cámara no hereda votos aunque se parezca')
assert.equal(retainMotionVotesAfterBoundary([{ ...motionVotes[0], prediction: 'N' }], slow).length, 0,
  'no modificar la ruta de consenso de M/N ni otras poses estáticas')
assert.equal(retainMotionVotesAfterBoundary([{ prediction: 'Ñ', confidence: .99, frames: held }], held).length, 0,
  'una cola quieta no demuestra un recorrido compartido')
assert.equal(retainMotionVotesAfterBoundary([{ prediction: 'Ñ', confidence: .99 }], slow).length, 0)
const shapeFrame = (folded, step = 0) => {
  const frame = Array(126).fill(0)
  frame[63] = 0.4 + step * 0.004; frame[64] = 0.4
  for (const mcp of [1, 5, 9, 13, 17]) {
    const chain = folded ? [[0, 0], [0.03, 0], [0.03, 0.03], [0, 0.03]] :
      [[0, 0], [0.03, 0], [0.06, 0], [0.09, 0]]
    for (let i = 0; i < 4; i++) {
      const at = 63 + (mcp + i) * 3
      frame[at] = 0.4 + step * 0.004 + chain[i][0]
      frame[at + 1] = 0.4 + mcp * 0.005 + chain[i][1]
    }
  }
  return frame
}
const openStroke = Array.from({ length: 12 }, (_, i) => shapeFrame(false, i))
const foldedStroke = Array.from({ length: 12 }, (_, i) => shapeFrame(true, i + 12))
assert.equal(isStaticFingerPoseSettled(Array.from({ length: 8 }, () => shapeFrame(false))), true)
assert.equal(isStaticFingerPoseSettled(openStroke.slice(-8)), false, 'una trayectoria real no se valida como N sostenida')
assert.equal(isStaticFingerPoseSettled([...openStroke.slice(0, 4), ...foldedStroke.slice(0, 4)]), false,
  'dedos cambiando no confirman una N')
assert.equal(isStaticFingerPoseSettled(Array.from({ length: 8 }, () => Array(126).fill(0))), false)
assert.equal(sameFingerConfiguration(shapeFrame(false), shapeFrame(true)), false)
assert.equal(sameFingerConfiguration(shapeFrame(false), shapeFrame(false, 20)), true,
  'un traslado no cambia la configuración de dedos')
const noisyHold = Array.from({ length: 12 }, (_, i) => {
  const frame = shapeFrame(false)
  const shift = i % 2 ? 0.003 : -0.003
  for (let at = 63; at < 126; at += 3) frame[at] += shift
  frame[65] = i * 0.00001
  return frame
})
const noisyAttempts = [...openStroke, ...noisyHold, ...openStroke.map(frame => frame.map((value, at) =>
  at >= 63 && at % 3 === 0 ? value + 0.1 : value))]
const noisyStart = findGestureAttemptStart(noisyAttempts)
assert.ok(noisyStart >= openStroke.length, 'ruido ligero no mantiene unido un intento rechazado al siguiente')
assert.equal(noisyAttempts.slice(noisyStart).at(-1), noisyAttempts.at(-1))
assert.equal(findGestureAttemptStart(openStroke.flatMap(frame => [frame, frame])), 0,
  'duplicar cuadros de una trayectoria no crea una pausa')
const downFrames = (fingers = 2) => Array.from({ length: 8 }, () => {
  const frame = shapeFrame(false)
  for (const [finger, mcp] of [5, 9, 13, 17].entries()) {
    const chain = finger < fingers ? [[0, 0], [0, 0.03], [0, 0.06], [0, 0.09]] :
      [[0, 0], [0.02, 0.02], [0.01, 0.04], [0, 0.01]]
    chain.forEach(([x, y], i) => {
      frame[63 + (mcp + i) * 3] = 0.43 + finger * 0.03 + x
      frame[64 + (mcp + i) * 3] = 0.39 + y
    })
  }
  return frame
})
assert.equal(isDownwardFingerPoseSettled(downFrames(), 'N'), true)
assert.equal(isDownwardFingerPoseSettled(downFrames(3), 'M'), true)
assert.equal(isDownwardFingerPoseSettled(downFrames(3), 'N'), false)
assert.equal(isDownwardFingerPoseSettled(downFrames(), 'M'), false)
assert.equal(isDownwardFingerPoseSettled(downFrames().slice(0, 6), 'N'), false,
  'la postura auxiliar exige ocho cuadros antes de confirmar')
assert.equal(isDownwardFingerPoseSettled(openStroke, 'N'), false)
assert.equal(isDownwardFingerPoseSettled(Array.from({ length: 8 }, () => Array(126).fill(0)), 'N'), false)
const movingDown = downFrames().map((frame, i) => frame.map((value, at) =>
  at >= 63 && at % 3 === 0 ? value + i * 0.007 : value))
assert.equal(isDownwardFingerPoseSettled(movingDown, 'N'), false, 'no emitir N durante un péndulo')
const liveDifferent = [...downFrames().slice(0, 3), ...downFrames(3).slice(0, 5)]
assert.equal(isDownwardFingerPoseSettled(liveDifferent, 'N'), false, 'una respuesta N antigua no valida la M actual')
assert.equal(findSpellingShapeStart([...openStroke, ...foldedStroke]), 10,
  'cambio persistente de dedos separa intentos aun con la muñeca en movimiento y conserva preinicio')
assert.equal(findSpellingShapeStart([...openStroke, ...foldedStroke.slice(0, 4), ...openStroke]), 0,
  'cambio fugaz o ruido no parte el recorrido')
const rotatedStroke = openStroke.map(frame => frame.map((value, at) => {
  if (at < 63) return value
  const coord = at % 3, base = at - coord
  return coord === 0 ? 1 - frame[base + 1] : coord === 1 ? frame[base] : value
}))
assert.equal(findSpellingShapeStart([...openStroke, ...rotatedStroke]), 0,
  'trasladar o rotar la mano sin cambiar dedos no abre otra letra')
assert.equal(findSpellingShapeStart(Array.from({ length: 28 }, (_, i) => shapeFrame(false, i))), 0,
  'recorrido continuo con la misma forma se conserva íntegro')
assert.equal(findSpellingShapeStart([...openStroke, ...Array.from({ length: 12 }, () => bothHands)]), 0,
  'el detector de deletreo no separa gestos de dos manos')
assert.equal(findSpellingShapeStart([...openStroke, Array(126).fill(0), ...openStroke]), 0,
  'pérdida de seguimiento por sí sola no crea una frontera')
const mixedShapes = [...openStroke, ...foldedStroke]
const longMixedShapes = [...Array.from({ length: 48 }, () => shapeFrame(false)), ...foldedStroke]
const prefetchedStart = findSpellingShapeStart(longMixedShapes)
assert.ok(prefetchedStart > 0)
const boundaryCalls = []
const prefetchedRead = prefetchSpellingBoundary(longMixedShapes, async input => {
  boundaryCalls.push(input)
  return { prediction: 'G', confidence: .99, is_idle: false }
})
await Promise.resolve()
assert.equal(boundaryCalls.length, 1, 'la frontera larga se lee mientras llega la respuesta principal')
const prefetchedG = await refineSpellingAttempt(longMixedShapes, { prediction: '', confidence: 0, is_idle: true }, prefetchedRead)
assert.equal(prefetchedG.result.prediction, 'G')
assert.equal(prefetchedG.selectedShapeStart, prefetchedStart)
assert.equal(boundaryCalls.length, 1, 'no duplicar el segundo viaje de red para la misma frontera')
const fullReadWins = await refineSpellingAttempt(longMixedShapes, { prediction: 'S', confidence: .99, is_idle: false }, prefetchedRead)
assert.equal(fullReadWins.result.prediction, 'S', 'la frontera rápida no reemplaza un recorrido completo válido')
assert.equal(fullReadWins.selectedShapeStart, 0)
const failingSpeculation = prefetchSpellingBoundary(longMixedShapes, async () => { throw Error('offline') })
await Promise.resolve()
const preservedRead = await refineSpellingAttempt(longMixedShapes, { prediction: 'G', confidence: .99, is_idle: false }, failingSpeculation)
assert.equal(preservedRead.result.prediction, 'G', 'un respaldo especulativo fallido no invalida la lectura completa')
await assert.rejects(refineSpellingAttempt(longMixedShapes, { prediction: '', confidence: 0, is_idle: true }, failingSpeculation), /offline/)
let shortCalls = 0
const shortRead = prefetchSpellingBoundary(mixedShapes, async () => { shortCalls++ })
assert.equal(shortCalls, 0, 'no aumentar peticiones de cada gesto corto')
await shortRead(mixedShapes)
assert.equal(shortCalls, 1)
const validG = { prediction: 'G', confidence: 0.99, is_idle: false }
const protectedG = await refineSpellingAttempt(mixedShapes, validG, () => {
  assert.fail('una G ya respaldada por el recorrido no consulta un corte de dedos')
})
assert.equal(protectedG.selectedShapeStart, 0)
assert.equal(protectedG.frames, mixedShapes)
const abstention = { prediction: '', confidence: 0, is_idle: false }
const recoveredS = await refineSpellingAttempt(mixedShapes, abstention, async input => {
  assert.ok(input.includes(foldedStroke[0]), 'el respaldo no pierde el inicio del nuevo trazo')
  return { prediction: 'S', confidence: 0.99, is_idle: false }
})
assert.equal(recoveredS.selectedShapeStart, 10)
assert.equal(recoveredS.result.prediction, 'S')
for (const result of [
  { prediction: 'S', confidence: 0.60, is_idle: false },
  { prediction: 'NO', confidence: 0.99, is_idle: false },
  { prediction: 'N', confidence: 0.99, is_idle: false },
  { prediction: 'S', confidence: 0.99, is_idle: true },
]) {
  const rejected = await refineSpellingAttempt(mixedShapes, abstention, async () => result)
  assert.equal(rejected.selectedShapeStart, 0, 'no borrar el buffer por una lectura inválida o postura intermedia')
  assert.equal(rejected.result, abstention)
}
const stableFrames = [...mixedShapes, ...Array.from({ length: 10 }, () => foldedStroke.at(-1))]
const stableN = { prediction: 'N', confidence: 0.95, is_idle: false }
const protectedN = await refineSpellingAttempt(stableFrames, stableN, () => {
  assert.fail('una letra estática asentada conserva el especialista histórico')
})
assert.equal(protectedN.selectedShapeStart, 0)
const verifiedN = await recheckStaticSpellingPose('N', stableFrames, async input => {
  assert.equal(input.length, 24, 'solo el checkpoint antiguo usa el adaptador de pose')
  return stableN
})
assert.equal(verifiedN.result.prediction, 'N')
assert.equal(verifiedN.confirmedFrame, stableFrames.at(-1), 'bloquear la pose actual corroborada')
const sequenceN = await recheckStaticSpellingPose('N', stableFrames, async input => {
  assert.deepEqual(input, stableFrames.slice(-8), 'el híbrido recibe los ocho cuadros reales recientes, sin remuestreo')
  return stableN
}, { sequence: true })
assert.equal(sequenceN.confirmedFrame, stableFrames.at(-1))
assert.equal(await recheckStaticSpellingPose('M', stableFrames, async () => stableN, { sequence: true }), null,
  'si la pose reciente es N, no rescatar una M antigua por la ruta legada')
assert.equal((await recheckStaticSpellingPose('M', stableFrames,
  async () => ({ prediction: 'M', confidence: 0.99, is_idle: false }), { sequence: true })).result.prediction, 'M',
  'una M realmente corroborada mantiene su confirmación')

const originalLetters = ['G', 'M', 'N']
const pendingN = appendSpellingCandidate(originalLetters, null, 'N', true)
assert.deepEqual(originalLetters, ['G', 'M', 'N'], 'el estado anterior no se modifica')
assert.deepEqual(pendingN.letters, ['G', 'M', 'N', 'N'], 'el candidato conserva modo alfabeto y separación del trazo')
assert.deepEqual(visibleSpellingLetters(pendingN.letters, pendingN.pendingIndex), originalLetters,
  'el prefijo móvil no aparece en pantalla ni se envía a voz/historial')
assert.deepEqual(appendSpellingCandidate(pendingN.letters, pendingN.pendingIndex, 'Ñ'),
  { letters: ['G', 'M', 'N', 'Ñ'], pendingIndex: null }, 'Ñ resuelve solo su propia N provisional')
assert.deepEqual(appendSpellingCandidate(originalLetters, null, 'Ñ'),
  { letters: ['G', 'M', 'N', 'Ñ'], pendingIndex: null }, 'una N asentada antes de Ñ nunca se elimina')
assert.deepEqual(visibleSpellingLetters(pendingN.letters, null), [...originalLetters, 'N'],
  'si después se sostiene la N, quitar provisionalidad confirma esa misma letra')
const firstPendingN = appendSpellingCandidate([], null, 'N', true)
assert.equal(usesAlphabetOnly(firstPendingN.letters), true, 'una primera N provisional sigue impidiendo palabras durante el deletreo')
assert.deepEqual(visibleSpellingLetters(firstPendingN.letters, firstPendingN.pendingIndex), [])
assert.deepEqual(appendSpellingCandidate(firstPendingN.letters, firstPendingN.pendingIndex, 'Ñ'),
  { letters: ['Ñ'], pendingIndex: null }, 'una primera Ñ no lleva una N extra')
for (const prediction of ['G', 'H', 'J', 'S', 'Z', 'M', 'N']) {
  assert.deepEqual(appendSpellingCandidate(originalLetters, null, prediction),
    { letters: [...originalLetters, prediction], pendingIndex: null }, 'otras letras conservan su salida')
  assert.deepEqual(appendSpellingCandidate(firstPendingN.letters, firstPendingN.pendingIndex, prediction),
    { letters: ['N', prediction], pendingIndex: null }, 'no borrar una N previa ante otra letra distinta de Ñ')
}
for (const prediction of ['G', 'H', 'Ñ', 'I']) {
  assert.equal(await recheckStaticSpellingPose(prediction, stableFrames, () => {
    assert.fail('el respaldo M/N no toca letras móviles ni sus posturas intermedias')
  }), null)
}
assert.equal(await recheckStaticSpellingPose('N', slow, () => {
  assert.fail('no emitir N mientras una posible Ñ sigue moviéndose')
}), null)
for (const result of [
  { prediction: 'M', confidence: 1, is_idle: false },
  { prediction: 'N', confidence: 0.8, is_idle: false },
  { prediction: 'N', confidence: 0.99, is_idle: true },
]) {
  assert.equal(await recheckStaticSpellingPose('N', stableFrames, async () => result), null,
    'sin corroboración fuerte de la misma letra no levantar el filtro')
}
assert.equal(hasHandTrajectory(held), false, 'sostener una postura no inventa un recorrido')
assert.equal(hasHandTrajectory(Array.from({ length: 12 }, () => Array(126).fill(0))), false)
assert.deepEqual(trimHeldGestureFrames([...slow, ...held]), slow, 'no alimentar H con el gesto más doce cuadros de espera')
assert.deepEqual(trimHeldGestureFrames([...slow, ...held.slice(0, 2)]), [...slow, ...held.slice(0, 2)], 'no recortar una pausa breve en el trazo')
assert.deepEqual(trimHeldGestureFrames(held), held, 'las letras estáticas conservan su pose')
assert.equal(slow.length, 10, 'la segmentación no modifica la grabación original')
assert.equal(isPoseSettled(slow), false, 'S lenta sigue moviéndose aunque cada salto sea pequeño')
assert.equal(isPoseSettled([...slow, ...held]), true, 'la cola quieta permite confirmar una postura')
assert.equal(isPoseSettled(held.slice(0, 4)), false, 'no decidir quietud por cuatro cuadros aislados')
const changed = [{ pose: 'old' }, { pose: 'S-start' }, { pose: 'S-second' }]
assert.deepEqual(preserveShapeChangeStart(changed, 3), changed.slice(1), 'preservar inicio de la siguiente letra antes de añadir su tercer cuadro')
assert.deepEqual(preserveShapeChangeStart(changed, 0), [], 'sin cambio de forma no conservar el gesto anterior')
const request = [{ pose: 'J-start' }, { pose: 'J-end' }]
const live = [...request, { pose: 'L' }]
assert.equal(confirmedPoseSnapshot(request), request.at(-1), 'la respuesta J bloquea J, no la L que ya llegó')
assert.notEqual(confirmedPoseSnapshot(request), live.at(-1), 'no perder L por una respuesta tardía')
assert.equal(shouldUnlockChangedShape({ changedFrames: 3, strokeEnded: false, poseSettled: false }), false,
  'la continuación de S/J no se registra como otra letra')
assert.equal(shouldUnlockChangedShape({ changedFrames: 3, strokeEnded: false, poseSettled: true }), true,
  'una nueva L ya asentada desbloquea aunque la respuesta anterior fuera provisional')
assert.equal(shouldUnlockChangedShape({ changedFrames: 3, strokeEnded: true, poseSettled: false }), true,
  'tras A, la S nueva puede empezar sin una pausa artificial')

assert.equal(shouldUnlockSpellingStroke({ wristTrajectory: true }), true)
assert.equal(shouldUnlockSpellingStroke({ wristTrajectory: false }), false)
const tipPendulum = Array.from({ length: 28 }, (_, i) => {
  const frame = downFrames()[0]
  for (const tip of [8, 12]) frame[63 + tip * 3] += 0.04 * Math.sin(i * 2 * Math.PI / 27)
  return frame
})
assert.equal(hasFingerPendulumTrajectory(tipPendulum), true, 'un péndulo de puntas con muñeca quieta desbloquea N→Ñ')
assert.equal(hasFingerPendulumTrajectory(downFrames()), false, 'N quieta no se convierte en Ñ')
assert.equal(shouldUnlockSpellingStroke({ fingerPendulum: true }), true)
const tipNoise = Array.from({ length: 40 }, (_, i) => {
  const frame = downFrames()[0]
  for (const tip of [8, 12]) frame[63 + tip * 3] += i % 2 ? 0.001 : -0.001
  return frame
})
assert.equal(hasFingerPendulumTrajectory(tipNoise), false)
assert.equal(shouldUnlockSpellingStroke({ movementSum: 0.08, peakMovement: 0.03, moving: true }), false,
  'los picos absolutos por sí solos no demuestran el siguiente trazo')
assert.equal(shouldUnlockSpellingStroke({ movementSum: 0.01, peakMovement: 0.002, moving: false, wristTrajectory: true }), true,
  'un trazo lento coherente no depende de un salto grande en un cuadro')
assert.equal(shouldUnlockSpellingStroke({ movementSum: 0.08, peakMovement: 0.03, moving: true, wristTrajectory: false }), false,
  'el jitter de puntas no abre otra G si la muñeca permanece en el mismo sitio')
assert.equal(hasHandTrajectory(held, [0]), false)
assert.equal(hasHandTrajectory(slow, [0]), true)
assert.equal(hasWristTrajectory(slow), true)
const oneTrackingJump = held.map(frame => [...frame])
oneTrackingJump[5][63] += 0.1
assert.equal(hasWristTrajectory(oneTrackingJump), false, 'un fallo aislado de tracking no abre otra G')

const active = {
  locked: false, inFlight: false, spelling: false,
  length: 18, minLength: 12,
  now: 1000, retryAt: 0, lastProbeAt: 600, intervalMs: 220,
  gestureHappened: true,
}
assert.equal(shouldProbeWhileSigning(active), true, 'consulta mientras la mano se mueve')
assert.equal(shouldProbeWhileSigning({ ...active, sequence: true, newFrames: 2 }), false,
  'una lectura más rápida no confirma un pico con cuadros casi idénticos')
assert.equal(shouldProbeWhileSigning({ ...active, sequence: true, newFrames: 3 }), true)
assert.equal(shouldProbeWhileSigning({ ...active, spelling: true, sequence: true }), true,
  'el modelo completo también consulta mientras se deletrea, desde la primera letra')
for (const change of [
  { locked: true }, { inFlight: true }, { spelling: true },
  { length: 8 }, { retryAt: 1200 }, { lastProbeAt: 900 },
  { gestureHappened: false },
]) {
  assert.equal(shouldProbeWhileSigning({ ...active, ...change }), false)
}

// Respuestas iniciales de signara-traza-G.json: G ya aparecía antes de que
// el buffer creciera a 180 cuadros. El giro durante el trazo no debe borrarla.
const trace = [
  { prediction: '', confidence: 0.64, inputFrames: 12 },
  { prediction: 'G', confidence: 1, inputFrames: 16 },
  { prediction: 'G', confidence: 1, inputFrames: 20 },
  { prediction: 'G', confidence: 1, inputFrames: 24 },
]
const votes = []
let emittedAt = null
for (const event of trace) {
  if (!event.prediction) { votes.length = 0; continue }
  votes.push(event.prediction)
  if (votes.length > 2) votes.shift()
  if (shouldConfirmLetter({
    ...event, stable: votes.length === 2 && new Set(votes).size === 1,
    sequence: true, probe: true, shapeChanged: true, handStill: false, hasMotion: true,
  })) { emittedAt = event.inputFrames; break }
}
assert.equal(emittedAt, 20, 'la primera G se confirma sin casilla ni pausa al repetir consenso')
const candidate = {
  prediction: 'J', confidence: 0.99, stable: true, sequence: true,
  probe: true, shapeChanged: true, handStill: false, hasMotion: true,
}
assert.equal(shouldConfirmLetter({ ...candidate, stable: false }), false, 'una lectura aislada no basta')
assert.equal(shouldConfirmLetter({ ...candidate, confidence: 0.8 }), false, 'durante movimiento exigir alta confianza')
assert.equal(shouldConfirmLetter({ ...candidate, windowMinConfidence: 0.73 }), false,
  'ambas ventanas deben tener alta confianza, no solo la respuesta final')
for (const prediction of ['H', 'Ñ']) {
  assert.equal(shouldConfirmLetter({ ...candidate, prediction, confidence: 0.88, windowMinConfidence: 0.88, alphabetOnly: true }), true,
    'dentro del nombre conservar dos votos concordantes sin el umbral del vocabulario general')
}
assert.equal(shouldConfirmLetter({ ...candidate, confidence: 0.8, alphabetOnly: true }), false,
  'no aceptar cualquier letra por estar en modo alfabeto')
assert.equal(shouldConfirmLetter({ ...candidate, prediction: 'I' }), false, 'no emitir I a mitad de J')
assert.equal(shouldConfirmLetter({ ...candidate, hasMotion: false }), false, 'una postura sin trazo no valida una letra dinámica')
assert.equal(shouldConfirmLetter({ ...candidate, sequence: false }), false, 'la ruta vieja conserva el guard de respuesta atrasada')
assert.equal(shouldConfirmLetter({ ...candidate, prediction: 'S', probe: false }), true,
  'la S completa no se descarta porque sus dedos cambiaron durante la petición')
assert.equal(shouldConfirmLetter({ ...candidate, prediction: 'L', probe: false, shapeChanged: false,
  handStill: true, poseSettled: false }), false, 'no emitir L/F como postura intermedia de un trazo suave')
assert.equal(shouldConfirmLetter({ ...candidate, prediction: 'L', probe: false, shapeChanged: false,
  handStill: true, poseSettled: true }), true, 'L realmente quieta mantiene su ruta estática')
const recheckedStatic = { ...candidate, prediction: 'N', poseSettled: true, handStill: false,
  shapeChanged: true, currentPoseValidated: true }
assert.equal(shouldConfirmLetter(recheckedStatic), true, 'pose N quieta corroborada no depende de un único frame con jitter')
assert.equal(shouldConfirmLetter({ ...recheckedStatic, prediction: 'M' }), true)
assert.equal(shouldConfirmLetter({ ...recheckedStatic, currentPoseValidated: false }), false)
assert.equal(shouldConfirmLetter({ ...recheckedStatic, poseSettled: false }), false, 'el trazo no se confunde con una postura')
assert.equal(shouldConfirmLetter({ ...recheckedStatic, stable: false }), false, 'la relectura no salta el consenso')
assert.equal(shouldConfirmLetter({ ...recheckedStatic, prediction: 'I' }), false, 'no relajar I durante J')
const heldFingers = { ...candidate, prediction: 'N', windowMinConfidence: 0.99, staticFingerPoseSettled: true }
assert.equal(shouldConfirmLetter(heldFingers), true, 'N estable no exige inmovilidad de todas sus puntas')
assert.equal(shouldConfirmLetter({ ...heldFingers, staticFingerPoseSettled: false }), false)
assert.equal(shouldConfirmLetter({ ...heldFingers, stable: false }), false)
assert.equal(shouldConfirmLetter({ ...heldFingers, windowMinConfidence: 0.90 }), false)
assert.equal(shouldConfirmLetter({ ...heldFingers, prediction: 'I' }), false)

const ily = Array.from({ length: 21 }, () => [0, 0, 0])
ily[5] = [0, 1, 0]; ily[8] = [0, 2, 0]
ily[9] = [1, 1, 0]; ily[12] = [1, 1.25, 0]
ily[13] = [2, 1, 0]; ily[16] = [2, 1.25, 0]
ily[17] = [3, 1, 0]; ily[20] = [3, 4.2, 0]
const ilyFrames = Array.from({ length: 8 }, () => [...Array(63).fill(0), ...ily.flat()])
assert.equal(looksLikeIly(ilyFrames).ily, true)
assert.equal(maybeCorrectTeAmo('G', ilyFrames), 'G', 'la geometría no reemplaza una letra reconocida')
assert.equal(maybeCorrectTeAmo('NO', ilyFrames), 'TE_AMO', 'el rescate léxico sigue disponible')

console.log('OK Interpretar: gesto completo y consultas provisionales sin pausa')

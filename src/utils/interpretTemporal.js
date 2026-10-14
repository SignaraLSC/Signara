// El modelo legado recibe 24 frames remuestreados; el modelo de secuencia
// recibe la toma real sin remuestreo. Este tope solo evita memoria sin límite.
export const MAX_GESTURE_FRAMES = 180

// Letras con recorrido en el corpus LSC actual. Una postura provisional de
// una letra estática (I durante J, por ejemplo) debe esperar al fin del gesto.
const MOTION_LETTERS = new Set(['G', 'H', 'J', 'S', 'Z', 'Ñ'])

export function usesAlphabetOnly(letters) {
  return letters.length > 0
}

export function shouldCloseSpelling({ spelling, locked, inFlight, handStill, now, lastActivityAt }) {
  return spelling && locked && !inFlight && handStill && now - lastActivityAt >= 1800
}

// Recorrido relativo al tamaño de la mano: no exigir un salto grande entre
// cuadros para detectar un trazo lento o realizado solo con los dedos.
export function hasHandTrajectory(frames, points = [0, 4, 8, 12, 16, 20]) {
  for (const offset of [0, 63]) {
    const valid = frames.filter(frame => Math.abs(frame[offset]) + Math.abs(frame[offset + 1]) > 1e-6)
    if (valid.length < 6) continue
    const spans = valid.map(frame => Math.max(...[5, 9, 17].map(id =>
      Math.hypot(frame[offset + id * 3] - frame[offset], frame[offset + id * 3 + 1] - frame[offset + 1]))))
    spans.sort((a, b) => a - b)
    const scale = Math.max(spans[Math.floor(spans.length / 2)], 0.025)
    for (const id of points) {
      const at = offset + id * 3
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, path = 0
      for (let i = 0; i < valid.length; i++) {
        const frame = valid[i]
        minX = Math.min(minX, frame[at]); maxX = Math.max(maxX, frame[at])
        minY = Math.min(minY, frame[at + 1]); maxY = Math.max(maxY, frame[at + 1])
        if (i) path += Math.hypot(frame[at] - valid[i - 1][at], frame[at + 1] - valid[i - 1][at + 1])
      }
      if (Math.hypot(maxX - minX, maxY - minY) >= scale * 0.22 && path >= scale * 0.35) return true
    }
  }
  return false
}

export function hasWristTrajectory(frames) {
  // Antirrebote del comienzo de otro trazo: una punta que salta o un único
  // fallo de muñeca no cuentan. Mediana de tres solo para esta decisión;
  // el modelo sigue recibiendo los landmarks originales, sin suavizarlos.
  const smooth = frames.map((frame, index) => {
    const out = [...frame]
    for (const offset of [0, 63]) {
      for (const coordinate of [0, 1]) {
        const values = frames.slice(Math.max(0, index - 1), Math.min(frames.length, index + 2))
          .map(value => value[offset + coordinate]).sort((a, b) => a - b)
        out[offset + coordinate] = values[Math.floor(values.length / 2)]
      }
    }
    return out
  })
  return hasHandTrajectory(smooth, [0])
}

export function trimHeldGestureFrames(frames, minFrames = 6) {
  if (frames.length <= minFrames || !hasHandTrajectory(frames)) return [...frames]
  const steps = frames.slice(1).map((frame, i) => {
    const previous = frames[i]
    let distance = 0, count = 0
    for (let at = 0; at < 126; at += 3) {
      if (Math.abs(frame[at]) + Math.abs(frame[at + 1]) +
          Math.abs(previous[at]) + Math.abs(previous[at + 1]) < 1e-6) continue
      distance += Math.abs(frame[at] - previous[at]) + Math.abs(frame[at + 1] - previous[at + 1])
      count += 2
    }
    return count ? distance / count : 0
  })
  const sorted = [...steps].sort((a, b) => a - b)
  const threshold = Math.max(0.002, sorted[Math.floor((sorted.length - 1) * 0.9)] * 0.12)
  let end = frames.length
  while (end > minFrames && steps[end - 2] <= threshold) end--
  // Una esquina breve no es el final. Recortar solo una cola de quietud,
  // conservando TODOS los cuadros del recorrido y sin remuestreo a 24.
  return frames.slice(0, frames.length - end >= 3 ? end : frames.length)
}

export function isPoseSettled(frames, tailLength = 8) {
  // Un trazo suave puede avanzar en cada cuadro menos que STOP_ABS: medir
  // también el recorrido acumulado reciente, no solo el último salto.
  const recent = frames.slice(-tailLength)
  return recent.length >= 6 && !hasHandTrajectory(recent)
}

export function stabilizeSingleHand(frame, previous) {
  // La etiqueta Left/Right puede cambiar al girar una sola mano. Mantener
  // su identidad solo si la muñeca sigue cerca; no intercambiar dos manos
  // reales ni heredar una identidad después de perder el seguimiento.
  if (!previous) return frame
  const present = value => [0, 63].filter(at => Math.abs(value[at]) + Math.abs(value[at + 1]) > 1e-6)
  const currentSlots = present(frame), previousSlots = present(previous)
  if (currentSlots.length !== 1 || previousSlots.length !== 1 || currentSlots[0] === previousSlots[0]) return frame
  const at = currentSlots[0], old = previousSlots[0]
  const scale = Math.max(...[5, 9, 17].map(id =>
    Math.hypot(previous[old + id * 3] - previous[old], previous[old + id * 3 + 1] - previous[old + 1])))
  if (Math.hypot(frame[at] - previous[old], frame[at + 1] - previous[old + 1]) > Math.max(0.08, scale)) return frame
  return [...frame.slice(63), ...frame.slice(0, 63)]
}

export function findGestureAttemptStart(frames, pauseFrames = 8) {
  // Una letra rechazada también termina. Separar un nuevo intento tras una
  // pausa sostenida, sin esperar a que el clasificador acepte el anterior.
  // No usar ventanas de longitud fija ni elegir cortes por su softmax.
  if (frames.length < pauseFrames + 6) return 0
  let quiet = 0, pauseEnd = -1, latestStart = 0
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1], after = frames[i]
    let distance = 0, count = 0
    const spans = []
    for (const at of [0, 63]) {
      const visible = Math.abs(before[at]) + Math.abs(before[at + 1]) > 1e-6
      const nowVisible = Math.abs(after[at]) + Math.abs(after[at + 1]) > 1e-6
      if (visible !== nowVisible) { distance = Infinity; break }
      if (!visible) continue
      spans.push(Math.max(...[5, 9, 17].map(id =>
        Math.hypot(before[at + id * 3] - before[at], before[at + id * 3 + 1] - before[at + 1]))))
      for (let id = 0; id < 21; id++) {
        const p = at + id * 3
        distance += Math.abs(after[p] - before[p]) + Math.abs(after[p + 1] - before[p + 1])
        count += 2
      }
    }
    const threshold = Math.max(0.0015, Math.max(0, ...spans) * 0.015)
    if (count && distance / count <= threshold) {
      quiet++
      if (quiet >= pauseFrames) pauseEnd = i
    } else {
      quiet = 0
    }
    // Los dedos ocluidos pueden vibrar aunque la persona esté en reposo.
    // Corroborar una meseta por postura y recorrido acumulado, no exigir
    // que TODOS los landmarks tengan saltos diminutos en cada cuadro.
    if (i >= pauseFrames - 1 && isGesturePlateau(frames.slice(i - pauseFrames + 1, i + 1))) pauseEnd = i
    const start = pauseEnd - 2 // conservar dos cuadros anteriores al arranque
    const afterPause = frames.slice(Math.max(0, pauseEnd + 1), i + 1)
    const changedPose = afterPause.length >= 6 && isStaticFingerPoseSettled(afterPause) &&
      afterPause.slice(-6).every(frame => !sameFingerConfiguration(frames[pauseEnd], frame))
    if (start > latestStart && i - pauseEnd >= 6 &&
        (hasWristTrajectory(frames.slice(start, i + 1)) ||
          hasFingerPendulumTrajectory(frames.slice(start, i + 1)) || changedPose)) {
      latestStart = start
      pauseEnd = -1
    }
  }
  return latestStart
}

function fingerConfiguration(frame) {
  const slots = [0, 63].filter(at => Math.abs(frame[at]) + Math.abs(frame[at + 1]) > 1e-6)
  if (slots.length !== 1) return null
  const offset = slots[0]
  return [1, 5, 9, 13, 17].map(mcp => {
    const point = id => frame.slice(offset + id * 3, offset + id * 3 + 3)
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
    const chain = [0, 1, 2, 3].map(i => point(mcp + i))
    const length = chain.slice(1).reduce((sum, p, i) => sum + distance(p, chain[i]), 0)
    return distance(chain[0], chain[3]) / Math.max(length, 1e-6)
  })
}

export function isStaticFingerPoseSettled(frames, wristAllowance = 0.22) {
  // Solo para confirmar M/N: girar la mano puede desplazar mucho las puntas
  // sin cambiar los dedos. Una trayectoria de muñeca real sigue siendo móvil.
  const recent = frames.slice(-8)
  if (recent.length < 8) return false
  const profiles = recent.map(fingerConfiguration)
  if (profiles.some(p => !p)) return false
  for (let finger = 0; finger < 5; finger++) {
    const values = profiles.map(p => p[finger]).sort((a, b) => a - b)
    if (values[6] - values[1] > 0.10) return false
  }
  const slots = recent.map(frame => [0, 63].filter(at => Math.abs(frame[at]) + Math.abs(frame[at + 1]) > 1e-6))
  if (slots.some(s => s.length !== 1 || s[0] !== slots[0][0])) return false
  const offset = slots[0][0]
  const spans = recent.map(frame => Math.max(...[5, 9, 17].map(id =>
    Math.hypot(frame[offset + id * 3] - frame[offset], frame[offset + id * 3 + 1] - frame[offset + 1])))).sort((a, b) => a - b)
  const scale = Math.max(spans[4], 0.025)
  const xs = recent.map(frame => frame[offset]), ys = recent.map(frame => frame[offset + 1])
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < scale * wristAllowance
}

export function isDownwardFingerPoseSettled(frames, label) {
  if (!['M', 'N'].includes(label)) return false
  const recent = frames.slice(-8)
  if (recent.length < 8) return false
  const slots = recent.map(frame => [0, 63].filter(at => Math.abs(frame[at]) + Math.abs(frame[at + 1]) > 1e-6))
  if (slots.some(s => s.length !== 1 || s[0] !== slots[0][0])) return false
  const offset = slots[0][0]
  const profiles = recent.map(fingerConfiguration)
  if (profiles.some(p => !p)) return false
  // El meñique doblado puede fluctuar; la decisión N/M depende de los otros
  // tres dedos. No elevar una respuesta anatómica sin verificar la mano LIVE.
  for (const finger of [1, 2, 3]) {
    const values = profiles.map(p => p[finger]).sort((a, b) => a - b)
    if (values[6] - values[1] > 0.12) return false
  }
  const required = label === 'M' ? 3 : 2
  const votes = recent.filter((frame, index) => {
    const profile = profiles[index]
    if (profile[4] > 0.80 || (label === 'N' && profile[3] > 0.65)) return false
    return [5, 9, 13].slice(0, required).every((mcp, finger) => {
      const point = id => frame.slice(offset + id * 3, offset + id * 3 + 3)
      const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]))
      const chain = [0, 1, 2, 3].map(i => point(mcp + i))
      const length = chain.slice(1).reduce((sum, p, i) => sum + distance(p, chain[i]), 0)
      return length > 1e-5 && profile[finger + 1] >= 0.85 &&
        (chain[3][1] - chain[0][1]) / length >= 0.45
    })
  }).length
  const spans = recent.map(frame => Math.max(...[5, 9, 17].map(id =>
    Math.hypot(frame[offset + id * 3] - frame[offset], frame[offset + id * 3 + 1] - frame[offset + 1])))).sort((a, b) => a - b)
  const xs = recent.map(frame => frame[offset]), ys = recent.map(frame => frame[offset + 1])
  return votes >= 6 && Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < Math.max(spans[4], 0.025) * 0.18
}

function isGesturePlateau(frames) {
  if (!isStaticFingerPoseSettled(frames, 0.08)) return false
  const recent = frames.slice(-8)
  // Cuadros duplicados no son evidencia independiente de una pausa larga
  // (por ejemplo, una esquina de Z capturada con cadencia doble).
  if (new Set(recent.map(frame => frame.join(','))).size < 6) return false
  const offset = Math.abs(recent[0][0]) + Math.abs(recent[0][1]) > 1e-6 ? 0 : 63
  const spans = recent.map(frame => Math.max(...[5, 9, 17].map(id =>
    Math.hypot(frame[offset + id * 3] - frame[offset], frame[offset + id * 3 + 1] - frame[offset + 1])))).sort((a, b) => a - b)
  const scale = Math.max(spans[4], 0.025)
  // Una Ñ puede mover solo las puntas: no tratar su péndulo como reposo
  // solo porque la muñeca y la extensión de los dedos sean constantes.
  return [8, 12].every(id => {
    const at = offset + id * 3
    const path = recent.map((_, i) => [0, 1].map(coordinate => {
      const values = recent.slice(Math.max(0, i - 1), i + 2).map(frame => frame[at + coordinate]).sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)]
    }))
    const xs = path.map(p => p[0]), ys = path.map(p => p[1])
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < scale * 0.20
  })
}

export function sameFingerConfiguration(a, b) {
  const pa = a && fingerConfiguration(a), pb = b && fingerConfiguration(b)
  if (!pa || !pb) return false
  const differences = pa.map((value, i) => Math.abs(value - pb[i]))
  return Math.max(...differences) < 0.12 && differences.reduce((sum, value) => sum + value, 0) / 5 < 0.035
}

export function findSpellingShapeStart(frames) {
  // Separar también un cambio persistente de dedos mientras la muñeca sigue
  // moviéndose. No confundir traslado/giro rígido con otra letra, ni usar el
  // softmax para buscar el corte que mejor favorezca una clase particular.
  if (frames.length < 14) return 0
  const profiles = frames.map(fingerConfiguration)
  const medianProfile = group => Array.from({ length: 5 }, (_, i) => {
    const values = group.map(p => p[i]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  })
  const delta = (a, b) => a.map((v, i) => Math.abs(v - b[i]))
  const initial = profiles.slice(0, 6)
  if (initial.some(p => !p)) return 0
  let anchor = medianProfile(initial), changedAt = -1, latestStart = 0
  for (let i = 6; i < profiles.length; i++) {
    const current = profiles[i]
    if (!current) { changedAt = -1; continue }
    const differences = delta(current, anchor)
    const different = Math.max(...differences) >= 0.35 && differences.reduce((s, v) => s + v, 0) / 5 >= 0.14
    if (!different) { changedAt = -1; continue }
    if (changedAt < 0) changedAt = i
    if (i - changedAt < 5) continue
    const group = profiles.slice(i - 5, i + 1)
    if (group.some(p => !p)) continue
    const candidate = medianProfile(group)
    if (group.some(p => Math.max(...delta(p, candidate)) > 0.16)) continue
    latestStart = Math.max(0, changedAt - 2)
    anchor = candidate
    changedAt = -1
  }
  return latestStart
}

function usableSpellingRead(result, frames) {
  const letter = result.prediction
  if (result.is_idle || !/^[A-ZÑ]$/.test(letter || '')) return false
  return MOTION_LETTERS.has(letter)
    ? result.confidence >= 0.85 && hasHandTrajectory(frames)
    : result.confidence >= 0.70 && isPoseSettled(frames)
}

export async function refineSpellingAttempt(frames, result, read) {
  // El cambio de dedos solo propone una frontera. G/S también cambian de
  // forma dentro de una seña: una lectura válida del recorrido entero gana.
  // Un único respaldo geométrico, nunca buscar cortes hasta maximizar softmax.
  const shapeStart = findSpellingShapeStart(frames)
  const unchanged = { result, frames, shapeStart, selectedShapeStart: 0 }
  if (!shapeStart || usableSpellingRead(result, frames)) return unchanged
  const separated = frames.slice(shapeStart)
  const input = trimHeldGestureFrames(separated)
  if (input.length < 6) return unchanged
  const boundaryResult = await read(input)
  // No sacar N/K/etc. de una postura intermedia del segmento: las letras
  // estáticas conservan su ruta original, con sus controles de quietud.
  if (!MOTION_LETTERS.has(boundaryResult.prediction) || !usableSpellingRead(boundaryResult, separated)) {
    return { ...unchanged, boundaryResult }
  }
  return { result: boundaryResult, frames: separated, shapeStart, selectedShapeStart: shapeStart,
    boundaryResult }
}

export function retainMotionVotesAfterBoundary(votes, retainedFrames) {
  // Un recorte puede quitar la preparación del MISMO trazo, no otra letra.
  // Conservar solo votos móviles que siguen respaldados por >=6 cuadros
  // compartidos en movimiento y al menos la mitad de su consulta original.
  // Posturas estáticas, otra mano/intento o una cola quieta no heredan votos.
  const retained = new Set(retainedFrames)
  return votes.filter(vote => {
    if (!MOTION_LETTERS.has(vote.prediction) || !vote.frames?.length ||
        !retained.has(vote.frames.at(-1))) return false
    const shared = vote.frames.filter(frame => retained.has(frame))
    return shared.length >= Math.max(6, Math.ceil(vote.frames.length / 2)) && hasHandTrajectory(shared)
  })
}

export function prefetchSpellingBoundary(frames, read) {
  // Una cola larga rechazada puede contener la siguiente letra. Consultar
  // UNA frontera geométrica en paralelo evita dos viajes de red en serie.
  // No gana por ser más rápida: refineSpellingAttempt sigue prefiriendo una
  // lectura válida del recorrido completo, incluso si G/S cambian sus dedos.
  const start = frames.length >= 48 ? findSpellingShapeStart(frames) : 0
  const input = start ? trimHeldGestureFrames(frames.slice(start)) : []
  if (input.length < 6) return read
  // Capturar también el rechazo: si la lectura completa era válida, una
  // consulta especulativa fallida no debe desconectar la cámara.
  const pending = Promise.resolve().then(() => read(input)).then(
    result => ({ result }), error => ({ error }))
  return async candidate => {
    if (candidate.length !== input.length || candidate[0] !== input[0] ||
        candidate.at(-1) !== input.at(-1)) return read(candidate)
    const reply = await pending
    if (reply.error) throw reply.error
    return reply.result
  }
}

export function preserveShapeChangeStart(buffer, changedFrames) {
  // El cuadro actual se añade después del desbloqueo. Conservar los primeros
  // cuadros que validaron el cambio en vez de borrar el arranque de S/J/etc.
  return changedFrames > 1 ? buffer.slice(-(changedFrames - 1)) : []
}

export function confirmedPoseSnapshot(queryFrames) {
  // Una respuesta tardía pertenece a su consulta, no a la mano que ahora
  // puede estar haciendo L. Bloquear esa L perdería la letra siguiente.
  return queryFrames.at(-1) ?? null
}

export function preserveMotionPreparation(buffer, queryFrames, preparationFrames) {
  // Reutilizar la frontera geométrica que evaluó la API. Mantener tanto el
  // inicio real como todos los cuadros llegados durante la respuesta.
  if (!Number.isInteger(preparationFrames) || preparationFrames <= 0 ||
      preparationFrames > queryFrames.length - 6) return buffer
  const start = buffer.indexOf(queryFrames[preparationFrames])
  return start > 0 ? buffer.slice(start) : buffer
}

export async function recheckStaticSpellingPose(prediction, frames, read, { sequence = false } = {}) {
  // Confirmar la pose ACTUAL si una respuesta quedó bloqueada por jitter o
  // latencia: histórico en modo legado, corroboración híbrida si está activa.
  // Nunca rescatar una postura de N mientras todavía se traza una Ñ.
  if (!['M', 'N'].includes(prediction) || !isPoseSettled(frames)) return null
  const snapshot = frames.slice(-8)
  // Con el modelo variable activo, conservar los ocho cuadros reales y su
  // corroboración anatómica. /predict legado podía devolver otra vez M
  // para una N y saltarse la corrección de la ruta híbrida.
  const result = await read(sequence ? snapshot : resampleGestureFrames(snapshot))
  if (result.is_idle || result.prediction !== prediction || result.confidence < 0.94) return null
  return { result, frames: snapshot, confirmedFrame: confirmedPoseSnapshot(snapshot) }
}

export function appendSpellingCandidate(letters, pendingIndex, prediction, provisional = false) {
  const next = [...letters]
  // Una N NO asentada puede ser prefijo de Ñ. Las N ya asentadas se conservan,
  // incluso en N→Ñ. No reescribir ninguna otra letra ni tocar el recorrido.
  if (pendingIndex === next.length - 1 && next[pendingIndex] === 'N' && prediction === 'Ñ') next.pop()
  next.push(prediction)
  return { letters: next, pendingIndex: provisional ? next.length - 1 : null }
}

export function visibleSpellingLetters(letters, pendingIndex) {
  return letters.filter((_, i) => i !== pendingIndex)
}

export function shouldUnlockChangedShape({ changedFrames, strokeEnded, poseSettled, minFrames = 3 }) {
  // Confirmar una J/S mientras sigue trazándose no convierte su continuación
  // en una letra nueva. Otra forma ya asentada sí puede abrir la siguiente.
  return changedFrames >= minFrames && (strokeEnded || poseSettled)
}

export function shouldConfirmWord({ prediction, stable, confidence, minConfidence, finalized, handStill, spelling, hasMotion = true, inputFrames = 12 }) {
  if (spelling || confidence < minConfidence) return false
  if ((inputFrames < 8 && !hasMotion) || (['SI', 'NO', 'POR_FAVOR'].includes(prediction) && !hasMotion)) return false
  // BIEN/MAL son posturas: no anunciar una postura provisional a mitad de G.
  if (['BIEN', 'MAL', 'TE_AMO'].includes(prediction) && !handStill) return false
  return stable || (finalized && confidence >= 0.84) || (!finalized && handStill && confidence >= 0.94)
}

export function shouldConfirmLetter({
  prediction, confidence, stable, sequence, probe, shapeChanged, handStill, hasMotion,
  minConfidence = 0.70, windowMinConfidence = confidence, alphabetOnly = false,
  poseSettled = handStill,
  currentPoseValidated = false,
  staticFingerPoseSettled = false,
}) {
  if (!stable || confidence < minConfidence) return false
  if (sequence) {
    // `stable` aquí exige dos ventanas sucesivas de la misma letra. El giro
    // de los dedos dentro de un recorrido no invalida ese consenso temporal.
    if (MOTION_LETTERS.has(prediction)) {
      // Cambios propios del trazo no invalidan una S al llegar su respuesta
      // final. La forma confirmada y los cuadros posteriores se separan.
      return hasMotion && windowMinConfidence >= (probe ? (alphabetOnly ? 0.85 : 0.94) : minConfidence)
    }
    // Dos lecturas fuertes del especialista histórico + dedos estables no
    // requieren inmovilidad de todas las puntas. No aplica a I/J ni a Ñ.
    if (['M', 'N'].includes(prediction) && staticFingerPoseSettled && windowMinConfidence >= 0.94) return true
    const rechecked = currentPoseValidated && ['M', 'N'].includes(prediction)
    return (handStill || rechecked) && poseSettled && (!shapeChanged || rechecked) &&
      windowMinConfidence >= (probe ? (alphabetOnly ? 0.85 : 0.94) : minConfidence)
  }
  return !shapeChanged
}

export function hasFingerPendulumTrajectory(frames) {
  if (frames.length < 8) return false
  const slots = frames.map(frame => [0, 63].filter(at => Math.abs(frame[at]) + Math.abs(frame[at + 1]) > 1e-6))
  if (slots.some(s => s.length !== 1 || s[0] !== slots[0][0])) return false
  const offset = slots[0][0]
  const spans = frames.map(frame => Math.max(...[5, 9, 17].map(id =>
    Math.hypot(frame[offset + id * 3] - frame[offset], frame[offset + id * 3 + 1] - frame[offset + 1])))).sort((a, b) => a - b)
  const scale = Math.max(spans[Math.floor(spans.length / 2)], 0.025)
  return [8, 12].every(id => {
    const at = offset + id * 3
    const path = frames.map((_, i) => {
      const values = frames.slice(Math.max(0, i - 1), i + 2).map(frame => frame[at] / scale).sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)]
    })
    const lowBefore = [], highBefore = [], lowAfter = [], highAfter = []
    for (let i = 0; i < path.length; i++) {
      lowBefore[i] = Math.min(path[i], lowBefore[i - 1] ?? Infinity)
      highBefore[i] = Math.max(path[i], highBefore[i - 1] ?? -Infinity)
      const j = path.length - 1 - i
      lowAfter[j] = Math.min(path[j], lowAfter[j + 1] ?? Infinity)
      highAfter[j] = Math.max(path[j], highAfter[j + 1] ?? -Infinity)
    }
    const swing = Math.max(...path.map((value, i) => Math.max(
      Math.min(value - lowBefore[i], value - lowAfter[i]),
      Math.min(highBefore[i] - value, highAfter[i] - value))))
    return Math.max(...path) - Math.min(...path) >= 0.25 && swing >= 0.10
  })
}

export function shouldUnlockSpellingStroke({ wristTrajectory = false, fingerPendulum = false }) {
  // Después de confirmar una letra, un nuevo trazo puede conservar la misma
  // forma de dedos. El recorrido coherente ya exige extensión y distancia
  // relativa a la mano. No exigir un salto de 0.024: rechazaba trazos lentos.
  return wristTrajectory || fingerPendulum
}

export function resampleGestureFrames(buffer, targetLength = 24) {
  const n = buffer.length
  if (n === 0 || n === targetLength) return [...buffer]
  if (n === 1) return Array.from({ length: targetLength }, () => [...buffer[0]])
  const out = new Array(targetLength)
  for (let i = 0; i < targetLength; i++) {
    const t = (i * (n - 1)) / (targetLength - 1)
    const lo = Math.floor(t)
    const hi = Math.min(lo + 1, n - 1)
    const f = t - lo
    out[i] = buffer[lo].map((v, k) => v + (buffer[hi][k] - v) * f)
  }
  return out
}

export function shouldProbeWhileSigning({
  locked, inFlight, spelling, sequence = false, length, minLength, now, retryAt,
  lastProbeAt, intervalMs, gestureHappened, newFrames = Infinity,
}) {
  return !locked && !inFlight && (!spelling || sequence) && length >= minLength &&
    now >= retryAt && now - lastProbeAt >= intervalMs && gestureHappened && (!sequence || newFrames >= 3)
}

export function newFrameCountSinceQuery(frames, previousEnd) {
  const at = previousEnd ? frames.lastIndexOf(previousEnd) : -1
  return at >= 0 ? frames.length - at - 1 : frames.length
}

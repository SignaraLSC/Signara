export function voiceKey(text) {
  return String(text || '')
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zñ0-9]+/g, ' ')
    .trim()
}

export function createVoiceResultLedger(replayedParts = []) {
  return { nextIndex: 0, finalParts: [], replayedParts: [...replayedParts] }
}

export function advanceVoiceResultLedger(ledger, results, { newSpeech = false } = {}) {
  // Los resultados finales son inmutables dentro de un ciclo de Web Speech.
  // Su índice es identidad, no el texto: dos «hola» realmente dichos en dos
  // resultados diferentes son válidos; reenviar el mismo índice no lo es.
  const deltaParts = []
  if (newSpeech) ledger.replayedParts = []
  while (ledger.nextIndex < results.length && results[ledger.nextIndex].isFinal) {
    const index = ledger.nextIndex++
    const text = String(results[index][0]?.transcript || '').trim()
    ledger.finalParts.push(text)
    const replay = ledger.replayedParts[index]
    if (text && (!replay || voiceKey(replay) !== voiceKey(text))) deltaParts.push(text)
  }
  const interimText = Array.from(results).slice(ledger.nextIndex)
    .map(result => String(result[0]?.transcript || '').trim()).filter(Boolean).join(' ')
  const finalText = ledger.finalParts.filter(Boolean).join(' ')
  return {
    finalText, interimText, delta: deltaParts.join(' '),
    combined: [finalText, interimText].filter(Boolean).join(' '),
    isFullyFinal: ledger.nextIndex === results.length,
  }
}

export function collapseRepeatedPhrase(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  let changed = true
  while (changed) {
    changed = false
    for (let size = Math.floor(words.length / 2); size >= 2; size--) {
      const a = words.slice(words.length - size * 2, words.length - size)
      const b = words.slice(words.length - size)
      if (a.length === size && voiceKey(a.join(' ')) === voiceKey(b.join(' '))) {
        words.splice(words.length - size, size)
        changed = true
        break
      }
    }
  }
  return words.join(' ')
}

export function deriveVoiceClause(rawText, previousKey = '') {
  const full = collapseRepeatedPhrase(rawText)
  const normalized = voiceKey(full)
  if (!normalized || normalized === previousKey) {
    return { full, normalized: previousKey, clause: '' }
  }

  let clause = full
  if (previousKey && normalized.startsWith(`${previousKey} `)) {
    clause = full.split(/\s+/).slice(previousKey.split(/\s+/).length).join(' ')
  }
  return { full, normalized, clause }
}

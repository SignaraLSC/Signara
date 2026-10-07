export function voiceKey(text) {
  return String(text || '')
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zñ0-9]+/g, ' ')
    .trim()
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

/**
 * Idiomas de salida (seña → español → este idioma).
 * `code` = BCP-47 / Google Translate target.
 * `speech` = lang para speechSynthesis.
 */
export const OUTPUT_LANGUAGES = [
  { code: 'es', speech: 'es-ES', label: 'Español', native: 'Español', flag: 'ES' },
  { code: 'en', speech: 'en-US', label: 'Inglés', native: 'English', flag: 'EN' },
  { code: 'pt', speech: 'pt-BR', label: 'Portugués', native: 'Português', flag: 'PT' },
  { code: 'fr', speech: 'fr-FR', label: 'Francés', native: 'Français', flag: 'FR' },
  { code: 'it', speech: 'it-IT', label: 'Italiano', native: 'Italiano', flag: 'IT' },
  { code: 'de', speech: 'de-DE', label: 'Alemán', native: 'Deutsch', flag: 'DE' },
  { code: 'zh-CN', speech: 'zh-CN', label: 'Chino', native: '中文', flag: 'ZH' },
  { code: 'ja', speech: 'ja-JP', label: 'Japonés', native: '日本語', flag: 'JA' },
]

export const DEFAULT_OUTPUT_LANG = 'es'
const STORAGE_KEY = 'signara:outputLang'

export function getStoredOutputLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && OUTPUT_LANGUAGES.some((l) => l.code === v)) return v
  } catch { /* ignore */ }
  return DEFAULT_OUTPUT_LANG
}

export function storeOutputLang(code) {
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
}

export function findOutputLang(code) {
  return OUTPUT_LANGUAGES.find((l) => l.code === code) || OUTPUT_LANGUAGES[0]
}

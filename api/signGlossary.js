/**
 * Traducciones fijas del vocabulario Signara (seña → idioma).
 * Evita basura de MyMemory (p. ej. "como estas" → "speak Spanish sir").
 */

const GLOSSARY = {
  adios: {
    en: 'Goodbye',
    pt: 'Adeus',
    fr: 'Au revoir',
    it: 'Arrivederci',
    de: 'Tschüss',
    'zh-CN': '再见',
    ja: 'さようなら',
  },
  ayuda: {
    en: 'Help',
    pt: 'Ajuda',
    fr: 'Aide',
    it: 'Aiuto',
    de: 'Hilfe',
    'zh-CN': '帮助',
    ja: '助けて',
  },
  ayudame: {
    en: 'Help me',
    pt: 'Me ajuda',
    fr: 'Aide-moi',
    it: 'Aiutami',
    de: 'Hilf mir',
    'zh-CN': '帮帮我',
    ja: '助けてください',
  },
  ayudanos: {
    en: 'Help us',
    pt: 'Nos ajude',
    fr: 'Aidez-nous',
    it: 'Aiutaci',
    de: 'Helft uns',
    'zh-CN': '帮帮我们',
    ja: '助けてください',
  },
  ayudalo: {
    en: 'Help him',
    pt: 'Ajude-o',
    fr: 'Aide-le',
    it: 'Aiutalo',
    de: 'Hilf ihm',
    'zh-CN': '帮助他',
    ja: '彼を助けて',
  },
  te_ayudo: {
    en: 'I help you',
    pt: 'Eu te ajudo',
    fr: 'Je t’aide',
    it: 'Ti aiuto',
    de: 'Ich helfe dir',
    'zh-CN': '我帮你',
    ja: '手伝います',
  },
  bien: {
    en: 'Good',
    pt: 'Bem',
    fr: 'Bien',
    it: 'Bene',
    de: 'Gut',
    'zh-CN': '好',
    ja: '元気',
  },
  cabeza: {
    en: 'Head',
    pt: 'Cabeça',
    fr: 'Tête',
    it: 'Testa',
    de: 'Kopf',
    'zh-CN': '头',
    ja: '頭',
  },
  'como estas': {
    en: 'How are you',
    pt: 'Como vai',
    fr: 'Comment ça va',
    it: 'Come stai',
    de: 'Wie geht’s',
    'zh-CN': '你好吗',
    ja: '元気ですか',
  },
  familia: {
    en: 'Family',
    pt: 'Família',
    fr: 'Famille',
    it: 'Famiglia',
    de: 'Familie',
    'zh-CN': '家庭',
    ja: '家族',
  },
  gracias: {
    en: 'Thank you',
    pt: 'Obrigado',
    fr: 'Merci',
    it: 'Grazie',
    de: 'Danke',
    'zh-CN': '谢谢',
    ja: 'ありがとう',
  },
  hola: {
    en: 'Hello',
    pt: 'Olá',
    fr: 'Bonjour',
    it: 'Ciao',
    de: 'Hallo',
    'zh-CN': '你好',
    ja: 'こんにちは',
  },
  mal: {
    en: 'Bad',
    pt: 'Mal',
    fr: 'Mal',
    it: 'Male',
    de: 'Schlecht',
    'zh-CN': '不好',
    ja: '悪い',
  },
  no: {
    en: 'No',
    pt: 'Não',
    fr: 'Non',
    it: 'No',
    de: 'Nein',
    'zh-CN': '不',
    ja: 'いいえ',
  },
  ojos: {
    en: 'Eyes',
    pt: 'Olhos',
    fr: 'Yeux',
    it: 'Occhi',
    de: 'Augen',
    'zh-CN': '眼睛',
    ja: '目',
  },
  perdon: {
    en: 'Sorry',
    pt: 'Desculpa',
    fr: 'Pardon',
    it: 'Scusa',
    de: 'Entschuldigung',
    'zh-CN': '对不起',
    ja: 'ごめんなさい',
  },
  'por favor': {
    en: 'Please',
    pt: 'Por favor',
    fr: 'S’il vous plaît',
    it: 'Per favore',
    de: 'Bitte',
    'zh-CN': '请',
    ja: 'お願いします',
  },
  si: {
    en: 'Yes',
    pt: 'Sim',
    fr: 'Oui',
    it: 'Sì',
    de: 'Ja',
    'zh-CN': '是',
    ja: 'はい',
  },
  'tengo sed': {
    en: 'I am thirsty',
    pt: 'Estou com sede',
    fr: 'J’ai soif',
    it: 'Ho sete',
    de: 'Ich habe Durst',
    'zh-CN': '我渴了',
    ja: '喉が渇いた',
  },
  'te amo': {
    en: 'I love you',
    pt: 'Eu te amo',
    fr: 'Je t’aime',
    it: 'Ti amo',
    de: 'Ich liebe dich',
    'zh-CN': '我爱你',
    ja: '愛してる',
  },
}

function normalizeKey(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
}

/** @returns {string|null} */
export function glossaryTranslate(text, target) {
  if (!target || target === 'es') return null
  const entry = GLOSSARY[normalizeKey(text)]
  if (!entry) return null
  return entry[target] || entry[target.split('-')[0]] || null
}

/** Basura conocida de MyMemory / TM pública. */
export function isJunkTranslation(source, translated) {
  const t = String(translated || '').trim().toLowerCase()
  if (!t) return true
  if (/mymemory warning/i.test(t)) return true
  if (/speak spanish/i.test(t)) return true
  if (t === 'comp estas') return true
  const srcWords = normalizeKey(source).split(' ').filter(Boolean).length
  const outWords = t.split(/\s+/).filter(Boolean).length
  // Frases cortas de seña no deberían explotar a oraciones largas.
  if (srcWords <= 3 && outWords > srcWords + 5) return true
  return false
}

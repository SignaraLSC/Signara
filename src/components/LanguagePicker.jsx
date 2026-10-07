import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import {
  OUTPUT_LANGUAGES,
  findOutputLang,
  getStoredOutputLang,
  storeOutputLang,
  getStoredInputLang,
  storeInputLang,
} from '../data/outputLanguages.js'

const ACCENTS = {
  purple: {
    menu: 'border-pastel-purple-line shadow-[0_18px_40px_-16px_rgba(45,42,38,0.4)]',
    active: 'bg-pastel-purple text-pastel-grape',
    activeLabel: 'text-pastel-grape',
    flagChip: 'text-pastel-grape',
    button:
      'border-pastel-purple-line/80 shadow-[0_8px_20px_-14px_rgba(126,100,201,0.45)] ' +
      'hover:border-pastel-grape focus:ring-pastel-purple/50',
    badge: 'bg-pastel-purple text-pastel-grape',
    chevron: 'text-pastel-grape',
  },
  blue: {
    menu: 'border-pastel-blue-line shadow-[0_18px_40px_-16px_rgba(45,42,38,0.4)]',
    active: 'bg-pastel-blue text-pastel-ink',
    activeLabel: 'text-signara-blue',
    flagChip: 'text-signara-blue',
    button:
      'border-pastel-blue-line shadow-[0_8px_20px_-14px_rgba(147,190,240,0.7)] ' +
      'hover:border-signara-blue focus:ring-pastel-blue/60',
    badge: 'bg-pastel-blue text-signara-blue',
    chevron: 'text-signara-blue',
  },
}

/**
 * Selector de idioma (entrada o salida).
 * props:
 *   mode: 'output' | 'input'
 *   accent: 'purple' | 'blue'  (input → blue por defecto)
 *   title: texto pequeño encima del idioma
 *   tutorialId: data-tutorial
 */
export default function LanguagePicker({
  value,
  onChange,
  className = '',
  mode = 'output',
  accent,
  title,
  tutorialId,
  fullWidth,
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const rootRef = useRef(null)
  const btnRef = useRef(null)
  const listId = useId()

  const isInput = mode === 'input'
  const stretch = fullWidth ?? !isInput
  const tone = ACCENTS[accent || (isInput ? 'blue' : 'purple')] || ACCENTS.purple
  const defaultVal = isInput ? getStoredInputLang() : getStoredOutputLang()
  const current = findOutputLang(value || defaultVal)
  const heading = title || (isInput ? 'Hablo / escribo en' : 'Selecciona el idioma')
  const aria = isInput ? 'Idioma de entrada' : 'Idioma de salida'
  const tutorial = tutorialId || (isInput ? 'translate-language' : 'interpret-language')

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      setMenuPos({
        top: r.bottom + 8,
        left: r.left,
        width: Math.max(r.width, stretch ? r.width : 220),
      })
    }
    place()
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target) && !e.target.closest?.('[data-lang-menu]')) {
        setOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, stretch])

  function select(code) {
    if (isInput) storeInputLang(code)
    else storeOutputLang(code)
    onChange?.(code)
    setOpen(false)
  }

  const subtitle = current.native && current.native !== current.label
    ? `${current.label} · ${current.native}`
    : current.label

  const menu = open && menuPos && createPortal(
    <ul
      id={listId}
      data-lang-menu
      role="listbox"
      aria-label={aria}
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        width: menuPos.width,
      }}
      className={
        'lang-picker-scroll z-[400] max-h-56 overflow-y-auto rounded-xl border-2 bg-white p-1.5 ' +
        tone.menu
      }
    >
      {OUTPUT_LANGUAGES.map((lang) => {
        const active = lang.code === current.code
        const line = lang.native && lang.native !== lang.label
          ? `${lang.label} · ${lang.native}`
          : lang.label
        return (
          <li key={lang.code} role="option" aria-selected={active}>
            <button
              type="button"
              onClick={() => select(lang.code)}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-bold transition ' +
                (active
                  ? tone.active
                  : 'text-pastel-ink hover:bg-pastel-cream')
              }
            >
              <span className={
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-[10px] font-extrabold ' +
                tone.flagChip
              }>
                {lang.flag}
              </span>
              <span className="min-w-0 flex-1 truncate">{line}</span>
              {active && (
                <span className={
                  'text-[10px] font-extrabold uppercase tracking-wider ' + tone.activeLabel
                }>
                  Activo
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>,
    document.body,
  )

  return (
    <div
      ref={rootRef}
      data-tutorial={tutorial}
      className={'relative z-30 ' + (stretch ? '' : 'inline-block ') + className}
    >
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={
          'group inline-flex h-12 items-center gap-2.5 rounded-xl border-2 px-3.5 text-left text-sm font-bold transition ' +
          (stretch ? 'w-full ' : 'w-auto max-w-full ') +
          'bg-white text-pastel-ink focus:outline-none focus:ring-4 ' +
          tone.button
        }
      >
        <span className={
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold tracking-wide ' +
          tone.badge
        }>
          {current.flag}
        </span>
        <span className={'min-w-0 ' + (stretch ? 'flex-1' : '')}>
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-pastel-sub">
            {heading}
          </span>
          <span className="block truncate text-pastel-ink">{subtitle}</span>
        </span>
        <Icon
          name="chevron"
          className={'h-4 w-4 shrink-0 transition ' + tone.chevron + (open ? ' rotate-180' : '')}
          strokeWidth={2.5}
        />
      </button>
      {menu}
    </div>
  )
}

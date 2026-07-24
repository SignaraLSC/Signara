import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import {
  OUTPUT_LANGUAGES,
  findOutputLang,
  getStoredOutputLang,
  storeOutputLang,
} from '../data/outputLanguages.js'

/**
 * Selector de idioma de salida (seña → español → idioma elegido).
 * El menú se renderiza en un portal para que no lo recorte overflow de padres.
 */
export default function LanguagePicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const rootRef = useRef(null)
  const btnRef = useRef(null)
  const listId = useId()
  const current = findOutputLang(value || getStoredOutputLang())

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      setMenuPos({
        top: r.bottom + 8,
        left: r.left,
        width: r.width,
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
  }, [open])

  function select(code) {
    storeOutputLang(code)
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
      aria-label="Idioma de salida"
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        width: menuPos.width,
      }}
      className="lang-picker-scroll z-[400] max-h-56 overflow-y-auto rounded-xl border-2 border-pastel-purple-line bg-white p-1.5 shadow-[0_18px_40px_-16px_rgba(45,42,38,0.4)]"
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
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm font-bold transition ' +
                (active
                  ? 'bg-pastel-purple text-pastel-grape'
                  : 'text-pastel-ink hover:bg-pastel-cream')
              }
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-[10px] font-extrabold text-pastel-grape ring-1 ring-pastel-ink/10">
                {lang.flag}
              </span>
              <span className="min-w-0 flex-1 truncate">{line}</span>
              {active && (
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-pastel-grape">
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
      data-tutorial="interpret-language"
      className={'relative z-30 ' + className}
    >
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={
          'group inline-flex h-12 w-full items-center gap-2.5 rounded-xl border-2 px-3.5 text-left text-sm font-bold transition ' +
          'border-pastel-purple-line/80 bg-white text-pastel-ink shadow-[0_8px_20px_-14px_rgba(126,100,201,0.45)] ' +
          'hover:border-pastel-grape focus:outline-none focus:ring-4 focus:ring-pastel-purple/50'
        }
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pastel-purple text-[11px] font-extrabold tracking-wide text-pastel-grape">
          {current.flag}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-pastel-sub">
            Selecciona el idioma
          </span>
          <span className="block truncate text-pastel-ink">{subtitle}</span>
        </span>
        <Icon
          name="chevron"
          className={'h-4 w-4 shrink-0 text-pastel-grape transition ' + (open ? 'rotate-180' : '')}
          strokeWidth={2.5}
        />
      </button>
      {menu}
    </div>
  )
}

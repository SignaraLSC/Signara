import { useEffect, useRef, useState } from 'react'
import { FLOATING_TUTORIAL_STEPS } from '../utils/floatingAvatarTutorial.js'

export default function FloatingAvatarTutorial({ onClose }) {
  const [index, setIndex] = useState(0)
  const dialogRef = useRef(null)
  const nextRef = useRef(null)
  const step = FLOATING_TUTORIAL_STEPS[index]
  const last = index === FLOATING_TUTORIAL_STEPS.length - 1

  useEffect(() => { nextRef.current?.focus() }, [index])

  function keyboard(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const buttons = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])
    if (!buttons.length) return
    const first = buttons[0], final = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); final.focus() }
    else if (!event.shiftKey && document.activeElement === final) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="absolute inset-2 z-[60] flex items-center justify-center rounded-[1.5rem] bg-[#f8f4ed]/95 p-2">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="floating-guide-title"
        aria-describedby="floating-guide-body" onKeyDown={keyboard}
        className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-2xl border-2 border-pastel-purple-line bg-white shadow-lg">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-pastel-grape">Guía rápida · {index + 1}/{FLOATING_TUTORIAL_STEPS.length}</p>
          <button type="button" onClick={onClose} aria-label="Cerrar tutorial" className="rounded-lg px-2 py-1 text-xs font-bold text-pastel-sub">Saltar</button>
        </div>
        <div className="min-h-0 overflow-y-auto px-3 py-3" aria-live="polite">
          <h2 id="floating-guide-title" className="text-base font-black leading-snug text-pastel-ink">{step.title}</h2>
          <p id="floating-guide-body" className="mt-2 text-xs leading-relaxed text-pastel-sub">{step.body}</p>
          {index === 1 && <div aria-hidden="true" className="mt-3 flex items-center gap-2 text-[10px] font-bold text-pastel-sub">
            <span className="h-4 w-4 rounded-full bg-pastel-grape" /> Preparando → <span className="h-4 w-4 rounded-full bg-pastel-pink" /> Escuchando
          </div>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-pastel-ink/10 p-3">
          <button type="button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}
            className="rounded-xl px-3 py-2 text-xs font-bold text-pastel-grape disabled:opacity-30">Atrás</button>
          <button ref={nextRef} type="button" onClick={() => { if (last) onClose(); else setIndex(value => value + 1) }}
            className="rounded-xl bg-pastel-grape px-3 py-2 text-xs font-bold text-white">{last ? 'Entendido' : 'Siguiente'}</button>
        </div>
      </section>
    </div>
  )
}

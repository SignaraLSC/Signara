import { useEffect, useRef, useState } from 'react'

/** Clase de salida emparejada con cada entrada (Material Motion). */
export const MOTION_EXIT = {
  'animate-motion-enter-forward': 'animate-motion-exit-forward',
  'animate-motion-enter-back': 'animate-motion-exit-back',
  'animate-motion-fade-through': 'animate-motion-exit-fade-through',
  'animate-motion-enter': 'animate-motion-exit',
}

export const MOTION_EXIT_MS = 340

/**
 * Transición de pantalla con entrada y salida simultáneas.
 * Mantiene la pantalla anterior montada mientras sale.
 */
export default function ScreenTransition({ screen, enterClass, render }) {
  const [layers, setLayers] = useState([{ screen, className: enterClass, phase: 'enter' }])
  const prevScreenRef = useRef(screen)
  const isFirstMount = useRef(true)

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      const timer = window.setTimeout(() => {
        setLayers([{ screen, className: enterClass, phase: 'idle' }])
      }, MOTION_EXIT_MS)
      return () => window.clearTimeout(timer)
    }

    if (screen === prevScreenRef.current) return

    const fromScreen = prevScreenRef.current
    const exitClass = MOTION_EXIT[enterClass] || 'animate-motion-exit'
    prevScreenRef.current = screen

    setLayers([
      { screen: fromScreen, className: exitClass, phase: 'exit' },
      { screen, className: enterClass, phase: 'enter' },
    ])

    const timer = window.setTimeout(() => {
      setLayers([{ screen, className: enterClass, phase: 'idle' }])
    }, MOTION_EXIT_MS)

    return () => window.clearTimeout(timer)
  }, [screen, enterClass])

  return (
    <div className="relative min-h-screen w-full">
      {layers.map((layer, index) => (
        <div
          key={`${layer.screen}-${layer.phase}-${index}`}
          className={
            'absolute inset-0 min-h-screen w-full ' +
            (layer.phase === 'idle' ? '' : layer.className + ' ') +
            (layer.phase === 'exit'
              ? 'motion-exit-host pointer-events-none z-[1]'
              : 'z-[2]')
          }
          aria-hidden={layer.phase === 'exit'}
        >
          {render(layer.screen)}
        </div>
      ))}
    </div>
  )
}

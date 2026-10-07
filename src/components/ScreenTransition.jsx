import { useEffect, useRef, useState } from 'react'
import { MOTION_EXIT, MOTION_EXIT_MS } from './motionConstants.js'

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
      {layers.map((layer) => (
        <div
          // Clave SOLO por pantalla (no por fase). Antes la clave incluía la
          // fase, así que al terminar la transición (enter → idle) la clave
          // cambiaba y React DESMONTABA y RE-MONTABA la pantalla entera,
          // re-disparando todas sus animaciones de entrada → se veía "cargar
          // dos veces". Con la clave estable, la capa que entra y la capa idle
          // son el MISMO elemento: la animación de entrada corre una sola vez.
          // fromScreen y toScreen siempre difieren (si son iguales, el efecto
          // sale temprano y no se crea capa de salida), así que no hay choque
          // de claves entre las dos capas simultáneas.
          key={layer.screen}
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

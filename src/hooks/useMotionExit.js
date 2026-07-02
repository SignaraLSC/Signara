import { useCallback, useRef, useState } from 'react'

export const MODAL_EXIT_MS = 360

/**
 * Retarda el desmontaje hasta completar la animación de salida.
 */
export function useMotionExit(onComplete, duration = MODAL_EXIT_MS) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)

  const requestClose = useCallback(
    (beforeComplete) => {
      if (closingRef.current) return
      closingRef.current = true
      setClosing(true)

      window.setTimeout(() => {
        beforeComplete?.()
        onComplete?.()
        closingRef.current = false
        setClosing(false)
      }, duration)
    },
    [onComplete, duration],
  )

  return { closing, requestClose }
}

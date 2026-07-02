import { useCallback, useEffect, useState } from 'react'

export function useModeTutorial(mode) {
  const storageKey = `signara:tutorial:${mode}`
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let seen = false
    try {
      seen = !!window.localStorage.getItem(storageKey)
    } catch (_) {}

    if (!seen) {
      const timer = window.setTimeout(() => setOpen(true), 900)
      return () => window.clearTimeout(timer)
    }
  }, [storageKey])

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch (_) {}
    setOpen(false)
  }, [storageKey])

  const start = useCallback(() => {
    setOpen(true)
  }, [])

  return { open, finish, start }
}

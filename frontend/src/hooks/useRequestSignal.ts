import { useCallback, useEffect, useRef } from 'react'

export function useRequestSignal() {
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const active = new AbortController()
    controller.current = active
    return () => active.abort()
  }, [])
  return useCallback(() => {
    controller.current ??= new AbortController()
    return controller.current.signal
  }, [])
}

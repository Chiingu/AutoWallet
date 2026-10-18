import { useEffect, useState } from 'react'

export function useCountdown() {
  const [countdown, setCountdown] = useState(0)
  const running = countdown > 0

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setCountdown((remaining) => Math.max(0, remaining - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  return { countdown, startCountdown: setCountdown }
}

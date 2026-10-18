import { useEffect, useEffectEvent, useState } from 'react'
import { PaymentLiveError, streamPaymentUpdates } from '../../api/paymentLiveApi'

type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'paused'

export function usePaymentLiveUpdates({ userId, enabled, onRefresh, onSessionEnded }: {
  userId: string; enabled: boolean; onRefresh: () => Promise<void>; onSessionEnded: () => void
}): LiveStatus {
  const [connection, setConnection] = useState<{ userId: string; status: LiveStatus }>({ userId: '', status: 'connecting' })
  const refresh = useEffectEvent(onRefresh)
  const sessionEnded = useEffectEvent(onSessionEnded)

  useEffect(() => {
    if (!enabled || !userId) return
    let active = true
    let attempt = 0
    let controller: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    let dirty = false
    const status = (value: LiveStatus) => { if (active) setConnection({ userId, status: value }) }
    const queueRefresh = () => {
      if (!active) return
      dirty = true
      if (refreshing || refreshTimer) return
      refreshTimer = setTimeout(async () => {
        refreshTimer = undefined
        if (!active) return
        dirty = false
        refreshing = true
        try { await refresh() } catch { /* The dashboard displays its own read errors. */ }
        finally { refreshing = false; if (dirty && active) queueRefresh() }
      }, 200)
    }
    const stop = () => {
      controller?.abort()
      clearTimeout(retryTimer)
      clearTimeout(refreshTimer)
      refreshTimer = undefined
      dirty = false
    }
    const connect = async () => {
      if (!active) return
      if (!navigator.onLine || document.visibilityState === 'hidden') { stop(); status('paused'); return }
      stop()
      const token = localStorage.getItem('autowallet_token')
      if (!token) { sessionEnded(); return }
      const next = new AbortController()
      controller = next
      const started = Date.now()
      status(attempt ? 'reconnecting' : 'connecting')
      try {
        await streamPaymentUpdates(token, next.signal, () => {
          if (next.signal.aborted || !active) return
          status('connected')
          // Subscribe before resyncing, including after a reconnect. Redis does
          // not replay events missed while this tab was disconnected.
          queueRefresh()
        }, () => { if (!next.signal.aborted) queueRefresh() })
      } catch (reason) {
        if (!active || next.signal.aborted) return
        if (reason instanceof PaymentLiveError && reason.status === 401) { sessionEnded(); return }
        if (reason instanceof PaymentLiveError && (reason.status === 403 || reason.status === 404)) { status('unavailable'); return }
        status('reconnecting')
        if (Date.now() - started > 30000) attempt = 0
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5))
        retryTimer = setTimeout(() => { void connect() }, delay)
      }
    }
    const resume = () => { attempt = 0; void connect() }
    window.addEventListener('online', resume)
    window.addEventListener('offline', resume)
    document.addEventListener('visibilitychange', resume)
    queueMicrotask(() => { if (active) void connect() })
    return () => {
      active = false
      stop()
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [enabled, userId])

  return !enabled ? 'paused' : connection.userId === userId ? connection.status : 'connecting'
}

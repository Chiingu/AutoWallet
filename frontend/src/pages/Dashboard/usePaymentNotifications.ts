import { useMemo, useSyncExternalStore } from 'react'
import type { DashboardTransaction } from './dashboardApi'

const changeEvent = 'autowallet:notification-reads'
const volatileReads = new Map<string, string>()
const storageKey = (userId: string) => `autowallet_notification_reads:${userId}`

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(changeEvent, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(changeEvent, onChange)
  }
}

function readSnapshot(userId: string): string | null {
  if (!userId) return null
  if (volatileReads.has(userId)) return volatileReads.get(userId)!
  try { return localStorage.getItem(storageKey(userId)) } catch { return null }
}

function parseIds(snapshot: string | null): string[] {
  try {
    const value: unknown = JSON.parse(snapshot || '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

// The service has no notification API yet. Synchronize browser read state
// across mounted views and tabs; keep a memory fallback if storage is blocked.
export function usePaymentNotifications(userId: string, payments: DashboardTransaction[]) {
  const snapshot = useSyncExternalStore(subscribe, () => readSnapshot(userId), () => null)
  const ids = useMemo(() => parseIds(snapshot), [snapshot])
  const readSet = useMemo(() => new Set(ids), [ids])
  const unread = payments.filter(payment => !readSet.has(payment.id)).length
  const markRead = (nextIds: string[]) => {
    if (!userId) return
    // Re-read when acting so another tab's latest changes are included.
    const next = JSON.stringify([...new Set([...parseIds(readSnapshot(userId)), ...nextIds])])
    try {
      localStorage.setItem(storageKey(userId), next)
      volatileReads.delete(userId)
    } catch { volatileReads.set(userId, next) }
    window.dispatchEvent(new Event(changeEvent))
  }
  return { unread, readIds: ids, markRead }
}

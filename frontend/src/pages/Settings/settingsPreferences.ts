import { useEffect, useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
const changeEvent = 'autowallet:preferences'
let fallbackTheme: ThemePreference = 'light'
let volatileTheme: ThemePreference | null = null
const fallbackAlerts = new Map<string, boolean>()

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(changeEvent, onChange)
  return () => { window.removeEventListener('storage', onChange); window.removeEventListener(changeEvent, onChange) }
}

function getTheme(): ThemePreference {
  if (volatileTheme !== null) return volatileTheme
  try {
    const saved = localStorage.getItem('autowallet_theme')
    return saved === 'dark' || saved === 'system' || saved === 'light' ? saved : fallbackTheme
  } catch { return fallbackTheme }
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, getTheme, () => 'light' as const)
}

export function saveTheme(preference: ThemePreference) {
  fallbackTheme = preference
  let persisted = true
  try { localStorage.setItem('autowallet_theme', preference) } catch { persisted = false }
  volatileTheme = persisted ? null : preference
  window.dispatchEvent(new Event(changeEvent))
  return persisted
}

export function useDashboardTheme() {
  const preference = useThemePreference()
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') { document.documentElement.dataset.autowalletTheme = preference === 'dark' ? 'dark' : 'light'; return }
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.autowalletTheme = preference === 'system' ? query.matches ? 'dark' : 'light' : preference }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [preference])
}

export function getPaymentAlerts(userId: string) {
  if (fallbackAlerts.has(userId)) return fallbackAlerts.get(userId)!
  try { return localStorage.getItem(`autowallet_payment_alerts:${userId}`) !== 'off' } catch { return fallbackAlerts.get(userId) ?? true }
}

export function usePaymentAlerts(userId: string) {
  return useSyncExternalStore(subscribe, () => getPaymentAlerts(userId), () => true)
}

export function savePaymentAlerts(userId: string, enabled: boolean) {
  let persisted = true
  try { localStorage.setItem(`autowallet_payment_alerts:${userId}`, enabled ? 'on' : 'off'); fallbackAlerts.delete(userId) } catch { persisted = false; fallbackAlerts.set(userId, enabled) }
  window.dispatchEvent(new Event(changeEvent))
  return persisted
}

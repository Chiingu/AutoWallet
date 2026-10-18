import { apiFetch } from './request'
import { apiErrorDetail } from './errors'

export class SettingsApiError extends Error {
  status: number
  retryAfter: number
  code: string | null
  constructor(status: number, message: string, retryAfter = 0, code: string | null = null) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
    this.code = code
  }
}

export async function settingsRequest(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('autowallet_token')
  if (!token) throw new SettingsApiError(401, 'Please sign in again.')
  const response = await apiFetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const { message, code } = apiErrorDetail(payload, 'This action is unavailable right now. Please try again.')
    const retry = Number(response.headers.get('Retry-After'))
    throw new SettingsApiError(response.status, message, Number.isFinite(retry) ? Math.max(0, Math.min(900, retry)) : 0, code)
  }
  return response
}

export interface SecurityInfo {
  twoFactorEnabled: boolean | null
  signInMethod: string | null
  role: string | null
}

export const unknownSecurity: SecurityInfo = { twoFactorEnabled: null, signInMethod: null, role: null }

export function securityFromExport(value: unknown): SecurityInfo | null {
  if (typeof value !== 'object' || value === null || !('profile' in value) || typeof value.profile !== 'object' || value.profile === null) return null
  const profile = value.profile
  return {
    twoFactorEnabled: 'two_factor_enabled' in profile && typeof profile.two_factor_enabled === 'boolean' ? profile.two_factor_enabled : null,
    signInMethod: 'signs_in_with' in profile && typeof profile.signs_in_with === 'string' ? profile.signs_in_with : null,
    role: 'role' in profile && typeof profile.role === 'string' ? profile.role : null,
  }
}

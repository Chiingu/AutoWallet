import { apiErrorDetail } from './errors'
import { apiFetch } from './request'
import type { DashboardAccount } from '../pages/Dashboard/dashboardApi'

export type ExportFormat = 'json' | 'zip' | 'tar.gz'

export interface SecurityInfo {
  two_factor_enabled?: boolean
  signs_in_with?: string
  role?: string
}

export interface TwoFactorSetupResponse {
  secret: string
  qr_code_uri: string
}

export interface TwoFactorCodesResponse {
  message?: string
  recovery_codes: string[]
}

export interface GdprSummary {
  profile: SecurityInfo
  payments: number
  rules: number
  envelopes: number
}

export interface ApiKeyItem {
  id: string
  name: string
  prefix: string
  secret_key?: string
  created_at: string
  last_used_at: string | null
}

export class SettingsApiError extends Error {
  status: number
  code: string | null
  retryAfter: number

  constructor(message: string, status: number, code: string | null = null, retryAfter = 0) {
    super(message)
    this.name = 'SettingsApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

export function securityFromExport(payload: unknown): SecurityInfo | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('profile' in payload)) return null
  const profile = (payload as { profile: unknown }).profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  const record = profile as Record<string, unknown>
  return {
    two_factor_enabled: typeof record.two_factor_enabled === 'boolean' ? record.two_factor_enabled : undefined,
    signs_in_with: typeof record.signs_in_with === 'string' ? record.signs_in_with : undefined,
    role: typeof record.role === 'string' ? record.role : undefined,
  }
}

export async function settingsRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('autowallet_token')
  if (!token) throw new SettingsApiError('Your session has ended.', 401)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await apiFetch(path, { ...options, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const { message, code } = apiErrorDetail(payload, 'The request could not be completed. Please try again.')
    const retryHeader = Number(response.headers?.get?.('retry-after') ?? 0)
    throw new SettingsApiError(
      message,
      response.status,
      code,
      Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 0,
    )
  }
  return response
}

async function settingsJson<T>(
  path: string,
  options: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  const token = localStorage.getItem('autowallet_token')
  if (!token) throw new SettingsApiError('Your session has ended.', 401)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await apiFetch(path, { ...options, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const { message, code } = apiErrorDetail(payload, fallbackMessage)
    throw new SettingsApiError(message, response.status, code)
  }
  return (await response.json()) as T
}

export function updateProfile(
  body: { full_name?: string; email?: string },
  signal?: AbortSignal,
): Promise<DashboardAccount> {
  return settingsJson<DashboardAccount>(
    '/api/auth/me',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      signal,
    },
    'Could not update your profile.',
  )
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<{ message: string }> {
  return settingsJson<{ message: string }>(
    '/api/auth/change-password',
    {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      signal,
    },
    'Could not update your password.',
  )
}

export function setupTwoFactor(signal?: AbortSignal): Promise<TwoFactorSetupResponse> {
  return settingsJson<TwoFactorSetupResponse>(
    '/api/auth/2fa/setup',
    { method: 'POST', body: JSON.stringify({}), signal },
    'Could not start 2FA setup.',
  )
}

export function enableTwoFactor(code: string, signal?: AbortSignal): Promise<TwoFactorCodesResponse> {
  return settingsJson<TwoFactorCodesResponse>(
    '/api/auth/2fa/enable',
    { method: 'POST', body: JSON.stringify({ code }), signal },
    'Could not enable 2FA.',
  )
}

export function disableTwoFactor(signal?: AbortSignal): Promise<{ message: string; is_2fa_enabled: boolean }> {
  return settingsJson<{ message: string; is_2fa_enabled: boolean }>(
    '/api/auth/2fa/disable',
    { method: 'POST', body: JSON.stringify({}), signal },
    'Could not disable 2FA.',
  )
}

export function regenerateRecoveryCodes(code: string, signal?: AbortSignal): Promise<TwoFactorCodesResponse> {
  return settingsJson<TwoFactorCodesResponse>(
    '/api/auth/2fa/recovery-codes/regenerate',
    { method: 'POST', body: JSON.stringify({ code }), signal },
    'Could not regenerate recovery codes.',
  )
}

export function fetchApiKeys(signal?: AbortSignal): Promise<ApiKeyItem[]> {
  return settingsJson<ApiKeyItem[]>(
    '/api/auth/api-keys',
    { signal },
    'Could not load API keys.',
  )
}

export function createApiKey(name: string, signal?: AbortSignal): Promise<ApiKeyItem> {
  return settingsJson<ApiKeyItem>(
    '/api/auth/api-keys',
    { method: 'POST', body: JSON.stringify({ name: name.trim() }), signal },
    'Could not create API key.',
  )
}

export async function revokeApiKey(keyId: string, signal?: AbortSignal): Promise<void> {
  await settingsRequest(`/api/auth/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    signal,
  })
}

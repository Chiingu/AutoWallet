import { apiErrorDetail } from '../../api/errors'
import { apiFetch } from '../../api/request'
import type { WalletType } from '../../api/walletTypes'

export type { WalletType } from '../../api/walletTypes'

export interface DashboardAccount {
  id: string
  email: string
  full_name: string
  bank_account_id: string | null
  role?: 'user' | 'admin'
  email_verified?: boolean
  is_2fa_enabled?: boolean
  has_password?: boolean
  created_at?: string
}

export type DashboardUser = DashboardAccount

export interface DashboardWallet {
  id: string
  wallet_type: WalletType
  balance: number
}

export interface DashboardTransaction {
  id: string
  reference: string
  amount: number
  status: 'pending' | 'processed' | 'failed'
  kind?: 'payment' | 'transfer' | 'spending'
  created_at?: string
  allocations?: Partial<Record<WalletType, number>>
}

export interface DashboardRule {
  id: string
  name: string
  rule_type: 'percentage_remainder' | 'lock_fixed' | 'cap'
  target_wallet: WalletType
  priority: number
  fixed_amount: number | null
  percentage: number | null
  condition_field: string | null
  condition_operator: string | null
  condition_value: number | null
  is_active: boolean
}

export interface RuleDraft {
  name: string
  rule_type: 'percentage_remainder' | 'lock_fixed'
  target_wallet: WalletType
  priority: number
  fixed_amount: number | null
  percentage: number | null
  condition_field: string | null
  condition_operator: string | null
  condition_value: number | null
  is_active: boolean
}

export interface DashboardData {
  user: DashboardAccount
  account: DashboardAccount
  wallets: DashboardWallet[]
  transactions: DashboardTransaction[]
  rules: DashboardRule[]
}

export class DashboardApiError extends Error {
  status: number
  code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'DashboardApiError'
    this.status = status
    this.code = code
  }
}

async function readDashboardError(response: Response, fallback: string): Promise<DashboardApiError> {
  const payload = await response.json().catch(() => null)
  const { message, code } = apiErrorDetail(payload, fallback)
  return new DashboardApiError(message, response.status, code)
}

async function get<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw await readDashboardError(response, 'Could not load your dashboard.')
  }

  return (await response.json()) as T
}

async function post<T>(path: string, token: string, body: unknown, fallbackMessage: string): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await readDashboardError(response, fallbackMessage)
  }

  return (await response.json()) as T
}

async function patch<T>(path: string, token: string, body: unknown, fallbackMessage: string): Promise<T> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await readDashboardError(response, fallbackMessage)
  }

  return (await response.json()) as T
}

async function del<T>(path: string, token: string, fallbackMessage: string): Promise<T> {
  const response = await apiFetch(path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })

  if (!response.ok) {
    throw await readDashboardError(response, fallbackMessage)
  }

  return (await response.json()) as T
}

export async function fetchDashboardData(token: string, signal?: AbortSignal): Promise<DashboardData> {
  const account = await get<DashboardAccount>('/api/auth/me', token, signal)
  if (!account.bank_account_id) {
    return { user: account, account, wallets: [], transactions: [], rules: [] }
  }

  const [wallets, transactions, rules] = await Promise.all([
    get<DashboardWallet[]>('/api/wallets/', token, signal),
    get<DashboardTransaction[]>('/api/transactions/', token, signal),
    get<DashboardRule[]>('/api/rules/', token, signal),
  ])

  const sortedTransactions = [...transactions].sort((a, b) => {
    const left = a.created_at ? Date.parse(a.created_at) : 0
    const right = b.created_at ? Date.parse(b.created_at) : 0
    return right - left
  })

  return { user: account, account, wallets, transactions: sortedTransactions, rules }
}

export function linkBankAccount(token: string, bankAccountId: string): Promise<DashboardAccount> {
  return post<DashboardAccount>(
    '/api/auth/link-bank-account',
    token,
    { bank_account_id: bankAccountId.trim() },
    'Could not link this bank account ID.',
  )
}

export function recordPayment(token: string, reference: string, amount: number): Promise<DashboardTransaction> {
  return post<DashboardTransaction>(
    '/api/transactions/',
    token,
    { reference: reference.trim(), amount },
    'Could not record this payment.',
  )
}

export function createRule(token: string, rule: RuleDraft): Promise<DashboardRule> {
  return post<DashboardRule>('/api/rules/', token, rule, 'Could not save this rule.')
}

export function updateRule(token: string, ruleId: string, updates: Partial<RuleDraft>): Promise<DashboardRule> {
  return patch<DashboardRule>(`/api/rules/${encodeURIComponent(ruleId)}`, token, updates, 'Could not update this rule.')
}

export function deleteRule(token: string, ruleId: string): Promise<{ message: string }> {
  return del<{ message: string }>(`/api/rules/${encodeURIComponent(ruleId)}`, token, 'Could not delete this rule.')
}

export function reorderRule(token: string, ruleId: string, direction: 'up' | 'down'): Promise<DashboardRule[]> {
  return post<DashboardRule[]>('/api/rules/reorder', token, { id: ruleId, direction }, 'Could not reorder rules.')
}

export function transferBetweenEnvelopes(
  token: string,
  payload: { from_wallet: WalletType; to_wallet: WalletType; amount: number; reference?: string },
): Promise<{ transaction: DashboardTransaction; wallets: DashboardWallet[] }> {
  return post<{ transaction: DashboardTransaction; wallets: DashboardWallet[] }>(
    '/api/wallets/transfer',
    token,
    payload,
    'Could not move money between envelopes.',
  )
}

export function spendFromEnvelope(
  token: string,
  payload: { wallet_type: WalletType; amount: number; reference?: string },
): Promise<{ transaction: DashboardTransaction; wallets: DashboardWallet[] }> {
  return post<{ transaction: DashboardTransaction; wallets: DashboardWallet[] }>(
    '/api/wallets/spend',
    token,
    payload,
    'Could not record spending from this envelope.',
  )
}

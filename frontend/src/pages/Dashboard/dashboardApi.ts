import { newestPaymentsFirst } from './paymentUtils'
import { apiFetch } from '../../api/request'
import { isWalletType } from '../../api/walletTypes'
import type { WalletType } from '../../api/walletTypes'
export type { WalletType } from '../../api/walletTypes'

export interface DashboardUser {
  id: string
  full_name: string
  email: string
  bank_account_id: string | null
}

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
  created_at?: string
  allocations?: Partial<Record<WalletType, number>>
}

export interface DashboardRule {
  id: string
  name: string
  rule_type: 'lock_fixed' | 'percentage_remainder'
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
  user: DashboardUser
  wallets: DashboardWallet[]
  transactions: DashboardTransaction[]
  rules: DashboardRule[]
}

export class DashboardApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const transactionStatuses = new Set(['pending', 'processed', 'failed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseArray<T>(value: unknown, parseItem: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Invalid dashboard response')
  return value.map(parseItem)
}

function parseUser(value: unknown): DashboardUser {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      typeof value.full_name !== 'string' || typeof value.email !== 'string' ||
      (value.bank_account_id !== null && typeof value.bank_account_id !== 'string')) {
    throw new Error('Invalid account response')
  }
  return {
    id: value.id,
    full_name: value.full_name,
    email: value.email,
    bank_account_id: value.bank_account_id,
  }
}

function parseWallet(value: unknown): DashboardWallet {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      !isWalletType(value.wallet_type) || !isFiniteNumber(value.balance)) {
    throw new Error('Invalid wallet response')
  }
  return { id: value.id, wallet_type: value.wallet_type, balance: value.balance }
}

function parseTransaction(value: unknown): DashboardTransaction {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      typeof value.reference !== 'string' || !isFiniteNumber(value.amount) ||
      typeof value.status !== 'string' || !transactionStatuses.has(value.status) ||
      (value.created_at !== undefined && (typeof value.created_at !== 'string' || Number.isNaN(Date.parse(value.created_at))))) {
    throw new Error('Invalid transaction response')
  }
  let allocations: DashboardTransaction['allocations']
  if (value.allocations !== undefined) {
    if (!isRecord(value.allocations)) throw new Error('Invalid transaction response')
    allocations = {}
    for (const [walletType, amount] of Object.entries(value.allocations)) {
      if (!isWalletType(walletType) || !isFiniteNumber(amount) || amount < 0) throw new Error('Invalid transaction response')
      allocations[walletType] = amount
    }
  }
  return {
    id: value.id,
    reference: value.reference,
    amount: value.amount,
    status: value.status as DashboardTransaction['status'],
    ...(value.created_at !== undefined ? { created_at: value.created_at as string } : {}),
    ...(allocations !== undefined ? { allocations } : {}),
  }
}

function parseRule(value: unknown): DashboardRule {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      typeof value.name !== 'string' || !isWalletType(value.target_wallet) ||
      (value.rule_type !== 'lock_fixed' && value.rule_type !== 'percentage_remainder') ||
      !isFiniteNumber(value.priority) || typeof value.is_active !== 'boolean' ||
      (value.fixed_amount !== null && !isFiniteNumber(value.fixed_amount)) ||
      (value.percentage !== null && !isFiniteNumber(value.percentage)) ||
      (value.condition_field !== null && typeof value.condition_field !== 'string') ||
      (value.condition_operator !== null && typeof value.condition_operator !== 'string') ||
      (value.condition_value !== null && !isFiniteNumber(value.condition_value))) {
    throw new Error('Invalid rule response')
  }
  return {
    id: value.id,
    name: value.name,
    rule_type: value.rule_type,
    target_wallet: value.target_wallet,
    priority: value.priority,
    fixed_amount: value.fixed_amount,
    percentage: value.percentage,
    condition_field: value.condition_field,
    condition_operator: value.condition_operator,
    condition_value: value.condition_value,
    is_active: value.is_active,
  }
}

async function getJson(path: string, token: string, signal: AbortSignal): Promise<unknown> {
  const response = await apiFetch(path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal,
  }, 15000)
  if (!response.ok) throw new DashboardApiError(response.status, `Could not load ${path}`)
  return response.json()
}

export async function fetchDashboardUser(token: string, signal: AbortSignal): Promise<DashboardUser> {
  return parseUser(await getJson('/api/auth/me', token, signal))
}

export async function fetchDashboardResources(user: DashboardUser, token: string, signal: AbortSignal): Promise<DashboardData> {
  if (!user.bank_account_id) return { user, wallets: [], transactions: [], rules: [] }

  const [wallets, transactions, rules] = await Promise.all([
    getJson('/api/wallets/', token, signal),
    getJson('/api/transactions/', token, signal),
    getJson('/api/rules/', token, signal),
  ])

  return {
    user,
    wallets: parseArray(wallets, parseWallet),
    transactions: newestPaymentsFirst(parseArray(transactions, parseTransaction)),
    rules: parseArray(rules, parseRule).sort((a, b) => a.priority - b.priority),
  }
}

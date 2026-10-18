import type { DashboardTransaction, WalletType } from './dashboardApi'
import { newestPaymentsFirst } from './paymentUtils'

export interface EnvelopeHistoryRow {
  payment: DashboardTransaction
  added: number
  balanceAfter: number
}

export type EnvelopeHistory =
  | { status: 'empty' | 'unavailable'; rows: [] }
  | { status: 'ready'; rows: EnvelopeHistoryRow[] }

/** Build a ledger only when the API supplies each payment's envelope allocation and it
 * reconciles with the current wallet balance. Missing data must not become
 * an invented payment history. */
export function buildEnvelopeHistory(
  type: WalletType,
  transactions: DashboardTransaction[],
  currentBalance: number,
): EnvelopeHistory {
  const processed = newestPaymentsFirst(transactions.filter((payment) => payment.status === 'processed'))
  if (processed.length === 0) return currentBalance === 0
    ? { status: 'empty', rows: [] }
    : { status: 'unavailable', rows: [] }
  if (processed.some((payment) => payment.allocations?.[type] === undefined)) return { status: 'unavailable', rows: [] }

  let runningBalance = 0
  const chronological = [...processed].reverse()
  const rows = chronological.map((payment) => {
    const added = payment.allocations?.[type] ?? 0
    runningBalance += added
    return { payment, added, balanceAfter: runningBalance }
  })

  if (Math.abs(runningBalance - currentBalance) > 0.02) {
    return { status: 'unavailable', rows: [] }
  }

  return { status: 'ready', rows: rows.filter((row) => Math.abs(row.added) > 0.001).reverse() }
}

import type { DashboardTransaction } from './dashboardApi'
export { formatDate as paymentDate } from '../../utils/format'

export function newestPaymentsFirst(payments: DashboardTransaction[]) {
  // Preserve server order when some dates are missing; a partial comparison
  // cannot establish a reliable chronological history.
  if (payments.some((payment) => !payment.created_at)) return [...payments]
  return [...payments].sort((a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!))
}

export function hasCompleteSplit(payment: DashboardTransaction) {
  if (!payment.allocations || payment.amount <= 0) return false
  const allocated = Object.values(payment.allocations).reduce<number>((sum, value) => sum + (value ?? 0), 0)
  return Math.abs(allocated - payment.amount) < 0.02
}

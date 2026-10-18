import { AlertCircle, Check, Clock3 } from 'lucide-react'
import type { DashboardTransaction, WalletType } from './dashboardApi'
import { envelopeMeta, money } from './envelopeDisplay'
import { hasCompleteSplit } from './paymentUtils'

export function PaymentStatus({ status }: { status: DashboardTransaction['status'] }) {
  const Icon = status === 'processed' ? Check : status === 'pending' ? Clock3 : AlertCircle
  return <span className={`dashboard-payment-status dashboard-payment-status--${status}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{status === 'processed' ? 'Processed' : status === 'pending' ? 'Pending' : 'Failed'}</span>
}

export function PaymentSplitBar({ payment }: { payment: DashboardTransaction }) {
  if (payment.status === 'pending') return <span className="text-xs text-[#7A879B]">Splitting…</span>
  if (!hasCompleteSplit(payment)) return <span className="text-xs text-[#96A2B2]">Breakdown unavailable</span>
  const types: WalletType[] = ['rent', 'tax', 'savings', 'free', 'main']
  const label = types.filter((type) => (payment.allocations?.[type] ?? 0) > 0)
    .map((type) => `${envelopeMeta[type].name} ${money.format(payment.allocations?.[type] ?? 0)} MAD`).join(', ')
  return <span className="dashboard-payment-split" role="img" aria-label="Payment split by envelope" aria-description={label}>{types.map((type) => (payment.allocations?.[type] ?? 0) > 0 ? <span key={type} style={{ width: `${((payment.allocations?.[type] ?? 0) / payment.amount) * 100}%`, backgroundColor: type === 'main' ? '#8A95D2' : type === 'free' ? '#EDA100' : envelopeMeta[type].color }} /> : null)}</span>
}

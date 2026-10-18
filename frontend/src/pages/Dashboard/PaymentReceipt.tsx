import { Check } from 'lucide-react'
import type { PreviewStep, SplitAmounts } from './dashboardSplit'
import { envelopeMeta, money, ruleDescription, walletOrder } from './envelopeDisplay'

interface Props {
  amount: number
  allocations: SplitAmounts
  reference: string
  steps?: PreviewStep[]
}

export function PaymentReceipt({ amount, allocations, reference, steps }: Props) {
  return <section className="workspace-card payment-receipt" aria-label="Payment receipt">
    <h2>Receipt</h2>
    <div className="receipt-heading"><strong>{reference}</strong><strong>{money.format(amount)} <small>MAD</small></strong></div>
    {steps ? steps.map(({ rule, allocated, remaining, reason }, index) => <div className="receipt-row" key={rule.id}>
      <span className="receipt-number">{index + 1}</span>
      <div className="receipt-description"><strong>{rule.name}</strong><p>{reason ?? ruleDescription(rule)}</p><span className="receipt-chip">{rule.rule_type === 'lock_fixed' ? 'Fixed amount' : `${rule.percentage ?? 0}% of what's left`}</span> <span className={`receipt-result ${reason ? 'receipt-result--skipped' : ''}`}>{reason ? 'Skipped' : <><Check size={14} />Ran</>}</span></div>
      <strong className="receipt-value">{money.format(allocated)}</strong><span className="receipt-remaining">{money.format(remaining)} left</span>
    </div>) : walletOrder.filter(type => type !== 'main' && allocations[type] > 0).map(type => {
      const { icon: Icon, name, color } = envelopeMeta[type]
      return <div className="receipt-row receipt-row--allocation" key={type}><span style={{ color }}><Icon className="h-[18px] w-[18px]" /></span><div className="receipt-description"><strong>{name}</strong><p>Recorded allocation</p></div><strong className="receipt-value">{money.format(allocations[type])}</strong></div>
    })}
    <div className="receipt-leftover"><span>Leftover → Main</span><strong>{money.format(allocations.main)}</strong></div>
    <div className="receipt-total"><span>Total <span className="receipt-result"><Check size={14} />Checks out</span></span><strong>{money.format(amount)} <small>MAD</small></strong></div>
    {!steps && <p className="workspace-note">These are the recorded envelope totals. The payment response does not include its individual rule steps.</p>}
  </section>
}

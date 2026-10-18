import { AlertCircle, ArrowLeft, Check, Clock3, Info } from 'lucide-react'
import type { DashboardData } from './dashboardApi'
import { PaymentStatus } from './PaymentDisplay'
import { DashboardSplitRibbon } from './DashboardSplitRibbon'
import { PaymentReceipt } from './PaymentReceipt'
import { hasCompleteSplit } from './paymentUtils'
import { formatDate, money } from '../../utils/format'
import type { SplitAmounts } from './dashboardSplit'

export function PaymentDetailView({ paymentId, data, onBack, onRefresh }: { paymentId: string; data: DashboardData; onBack: () => void; onRefresh: () => void }) {
  const payment = data.transactions.find(item => item.id === paymentId)
  if (!payment) return <section className="workspace-empty"><AlertCircle /><h1>Payment not found</h1><p>This payment is not in your account’s payment list.</p><button className="dashboard-primary-button" onClick={onBack}>Back to Activity</button></section>
  const complete = payment.status === 'processed' && hasCompleteSplit(payment)
  const allocations: SplitAmounts = { main: 0, rent: 0, tax: 0, savings: 0, free: 0, ...payment.allocations }
  const received = formatDate(payment.created_at, true)
  const time = payment.created_at ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(payment.created_at)) : ''
  return <div className="payment-detail workspace-page">
    <button className="workspace-back" onClick={onBack}><ArrowLeft size={16} />Activity</button>
    <header className="workspace-heading"><div><div className="workspace-title-row"><h1>{payment.reference}</h1><PaymentStatus status={payment.status} /></div><p>{money.format(payment.amount)} MAD{received ? ` · Received ${received}, ${time}` : ''}{data.user.bank_account_id ? ` · into ••••${data.user.bank_account_id.slice(-4)}` : ''}</p></div></header>
    {complete && <><div className="workspace-banner"><Info size={17} /><span>This is the recorded split for this payment.</span></div><div className="payment-detail-ribbon"><DashboardSplitRibbon amount={payment.amount} allocations={allocations} reference={payment.reference} /></div></>}
    {payment.status === 'failed' && <div className="workspace-banner workspace-banner--error" role="alert"><AlertCircle size={18} /><span>This payment failed. No successful split is available.</span></div>}
    {payment.status === 'pending' && <div className="workspace-banner" role="status"><Clock3 size={18} /><span>This payment is waiting to finish processing.</span><button onClick={onRefresh}>Refresh status</button></div>}
    <div className="payment-detail-grid">
      {complete ? <PaymentReceipt amount={payment.amount} allocations={allocations} reference={payment.reference} /> : <section className="workspace-card payment-missing"><AlertCircle size={25} /><h2>{payment.status === 'failed' ? 'What happens now' : payment.status === 'pending' ? 'Waiting for your split' : 'Split details unavailable'}</h2><p>{payment.status === 'failed' ? 'Check the payment status before recording it again. This service does not currently support retrying a failed payment.' : payment.status === 'pending' ? 'Refresh to check whether processing has finished.' : 'The payment service has not returned its saved allocations. Your current rules cannot tell us how an earlier payment was split.'}</p><button className="dashboard-secondary-button" onClick={onRefresh}>Refresh payment</button></section>}
      <div className="payment-detail-aside"><section className="workspace-card"><h2>Summary</h2><dl className="payment-summary"><div><dt>Reference</dt><dd>{payment.reference}</dd></div><div><dt>Received</dt><dd>{received ? `${received}, ${time}` : 'Not provided'}</dd></div><div><dt>Amount</dt><dd>{money.format(payment.amount)} MAD</dd></div><div><dt>Into</dt><dd>{data.user.bank_account_id ? `••••${data.user.bank_account_id.slice(-4)}` : 'Not linked'}</dd></div><div><dt>Status</dt><dd><PaymentStatus status={payment.status} /></dd></div></dl></section>
      <section className="workspace-card"><h2>What happened</h2><ol className="payment-timeline"><li><span><Check size={13} /></span><div><strong>Payment received</strong><p>{received || 'Timestamp not provided'}</p></div></li><li><span className={payment.status === 'failed' ? 'is-failed' : ''}>{payment.status === 'processed' ? <Check size={13} /> : payment.status === 'failed' ? <AlertCircle size={13} /> : <Clock3 size={13} />}</span><div><strong>{payment.status === 'processed' ? 'Payment processed' : payment.status === 'failed' ? 'Processing failed' : 'Processing pending'}</strong><p>{complete ? 'Envelope allocations recorded' : 'As reported by the payment service'}</p></div></li></ol></section></div>
    </div>
  </div>
}

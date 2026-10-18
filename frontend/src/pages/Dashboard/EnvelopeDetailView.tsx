import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, ChevronRight, MessageSquareText, ReceiptText } from 'lucide-react'
import type { DashboardData, DashboardTransaction, WalletType } from './dashboardApi'
import { envelopeDescription, envelopeMeta, envelopeTarget, money, ruleDescription } from './envelopeDisplay'
import { buildEnvelopeHistory } from './envelopeHistory'
import { paymentDate } from './paymentUtils'
import './envelopeDetail.css'

interface Props {
  type: WalletType
  data: DashboardData
  onBack: () => void
  onViewRules: () => void
  onAsk: (question: string) => void
  onSelectPayment: (payment: DashboardTransaction) => void
}

const shortDate = (value?: string) => paymentDate(value, true) || 'Date unavailable'

function GlanceRow({ label, value }: { label: string; value: string }) {
  return <div className="envelope-detail-glance-row"><dt>{label}</dt><dd>{value}</dd></div>
}

export function EnvelopeDetailView({ type, data, onBack, onViewRules, onSelectPayment, onAsk }: Props) {
  const meta = envelopeMeta[type]
  const Icon = meta.icon
  const wallet = data.wallets.find((item) => item.wallet_type === type)
  const balance = wallet?.balance ?? 0
  const total = data.wallets.reduce((sum, item) => sum + item.balance, 0)
  const share = total > 0 ? balance / total * 100 : 0
  const rule = data.rules.find((item) => item.target_wallet === type && item.is_active) ??
    data.rules.find((item) => item.target_wallet === type)
  const target = envelopeTarget(type, data.rules)
  const progress = target === null ? null : Math.max(0, Math.min(100, balance / target * 100))
  const history = buildEnvelopeHistory(type, data.transactions, balance)
  const latest = history.status === 'ready' ? history.rows[0] : undefined
  const now = new Date()
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)
  const addedThisMonth = history.status === 'ready' && history.rows.every((row) => row.payment.created_at)
    ? history.rows.filter((row) => { const date = new Date(row.payment.created_at!); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear() })
      .reduce((sum, row) => sum + row.added, 0)
    : null
  const firstFilled = history.status === 'ready' && target !== null && balance >= target
    ? [...history.rows].reverse().find((row) => row.balanceAfter >= target - 0.02)
    : undefined
  const processed = data.transactions.filter((payment) => payment.status === 'processed')
  const filledIndex = firstFilled ? processed.findIndex((payment) => payment.id === firstFilled.payment.id) : -1
  const skippedAfterFill = filledIndex > 0 && history.status === 'ready'
    ? processed.slice(0, filledIndex).filter((payment) => (payment.allocations?.[type] ?? 0) === 0).length
    : 0
  const taxExpected = type === 'tax' && rule?.percentage && processed.length > 0 && history.status === 'ready'
    ? processed.reduce((sum, payment) => sum + payment.amount, 0) * rule.percentage / 100
    : null
  const reserveVsGross = taxExpected && taxExpected > 0 ? balance / taxExpected * 100 : null

  return <section className="envelope-detail" aria-labelledby="envelope-detail-heading">
    <button type="button" className="envelope-detail-mobile-back" onClick={onBack} aria-label="Back to Envelopes"><ArrowLeft className="h-4 w-4" />Envelopes</button>

    <section className="envelope-detail-hero" aria-label={`${meta.name} balance`}>
      <div className="envelope-detail-hero-identity">
        <span className="envelope-detail-icon" style={{ color: meta.color, backgroundColor: meta.tint }}><Icon className="h-6 w-6" aria-hidden="true" /></span>
        <div><h1 id="envelope-detail-heading">{meta.name}</h1><p>{envelopeDescription(type, data.rules)}</p></div>
      </div>
      <div className="envelope-detail-hero-balance">
        <strong>{money.format(balance)} <small>MAD</small></strong>
        {progress !== null && target !== null ? <div className="envelope-detail-target"><span className="envelope-detail-target-track" role="progressbar" aria-label={`${meta.name} target progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%`, backgroundColor: meta.color }} /></span><small>{progress >= 100 && type === 'rent' ? <><Check className="h-3 w-3" />Target met · {money.format(balance)} of {money.format(target)}</> : `${Math.round(progress)}% of ${money.format(target)} ${type === 'savings' ? 'cap' : 'target'}`}</small>{firstFilled && <small>Filled by {firstFilled.payment.reference}{firstFilled.payment.created_at ? ` · ${shortDate(firstFilled.payment.created_at)}` : ''}</small>}</div>
          : <small>{latest ? `Last change +${money.format(latest.added)} · ${shortDate(latest.payment.created_at)}` : 'Current recorded balance'}</small>}
      </div>
    </section>

    <div className="envelope-detail-actions">
      {type === 'rent' ? <button type="button" className="dashboard-primary-button" disabled title="Coming soon"><Check className="h-4 w-4" />Mark rent as paid <span className="dashboard-soon-badge">Soon</span></button>
        : <><button type="button" className="dashboard-primary-button" disabled title="Coming soon"><ReceiptText className="h-4 w-4" />Record spending <span className="dashboard-soon-badge">Soon</span></button><button type="button" className="dashboard-secondary-button envelope-detail-move" disabled title="Coming soon"><ArrowLeftRight className="h-4 w-4" />Move money <span className="dashboard-soon-badge">Soon</span></button></>}
    </div>

    <div className="envelope-detail-panels">
      <section className="envelope-detail-panel envelope-detail-rule" aria-labelledby="envelope-rule-heading">
        <h2 id="envelope-rule-heading">The rule that fills it</h2>
        {rule ? <div className="envelope-detail-rule-card">
          <span className="envelope-detail-priority">{rule.priority}</span>
          <span className="envelope-detail-rule-icon" style={{ color: meta.color, backgroundColor: meta.tint }}><Icon className="h-5 w-5" aria-hidden="true" /></span>
          <div><strong>{rule.name}</strong><p>{ruleDescription(rule)}</p></div>
          <span className={`envelope-detail-rule-status ${rule.is_active ? 'is-active' : ''}`}><span aria-hidden="true" />{rule.is_active ? 'Active' : 'Paused'}</span>
        </div> : <p className="envelope-detail-muted">No saved rule fills this envelope.</p>}
        <button type="button" className="envelope-detail-text-link" onClick={onViewRules}>View in Rules <ArrowRight className="h-4 w-4" /></button>
      </section>

      <section className="envelope-detail-panel envelope-detail-glance" aria-labelledby="envelope-glance-heading">
        <h2 id="envelope-glance-heading">At a glance</h2>
        <dl>
          <GlanceRow label="Holds" value={`${money.format(balance)} MAD`} />
          {target !== null && <GlanceRow label={type === 'savings' ? 'Cap' : 'Target'} value={`${money.format(target)} MAD`} />}
          {addedThisMonth !== null && <GlanceRow label={`Added in ${monthLabel}`} value={`+${money.format(addedThisMonth)} MAD`} />}
          {firstFilled && <GlanceRow label="Filled by" value={`${firstFilled.payment.reference}${firstFilled.payment.created_at ? ` · ${shortDate(firstFilled.payment.created_at)}` : ''}`} />}
          {firstFilled && skippedAfterFill > 0 && <GlanceRow label="Skipped by" value={`${skippedAfterFill} later payment${skippedAfterFill === 1 ? '' : 's'}`} />}
          <GlanceRow label="Share of all envelopes" value={`${share.toFixed(1)}%`} />
          {reserveVsGross !== null && <GlanceRow label="Vs gross at current rule" value={`${reserveVsGross.toFixed(1)}%`} />}
          <GlanceRow label="Last change" value={latest?.payment.created_at ? shortDate(latest.payment.created_at) : 'Unavailable'} />
        </dl>
      </section>
    </div>

    {type === 'tax' && <div className="envelope-detail-insight"><MessageSquareText className="h-4 w-4" aria-hidden="true" /><div><p>{reserveVsGross !== null ? `Tax received ${reserveVsGross.toFixed(1)}% of a full ${rule?.percentage ?? 0}% gross allocation because earlier rules ran first.` : 'Tax receives a share of what remains after higher-priority rules run.'}</p><button type="button" onClick={() => onAsk('Explain my Tax envelope balance and how higher-priority rules affect the amount set aside for Tax.')}>Ask why</button></div></div>}

    <section className="envelope-detail-panel envelope-detail-history" aria-labelledby="envelope-history-heading">
      <h2 id="envelope-history-heading">History</h2>
      <p>Every recorded change to {meta.name}, newest first.</p>
      {history.status === 'unavailable' ? <p className="envelope-detail-history-empty">The backend does not yet provide the per-payment allocations needed to show this envelope's history.</p>
        : history.rows.length === 0 ? <p className="envelope-detail-history-empty">No recorded changes to this envelope yet.</p>
          : <>
            <div className="envelope-detail-history-desktop"><table><caption className="sr-only">Payments that changed the {meta.name} envelope</caption><thead><tr><th>Payment</th><th>Date</th><th>Added (MAD)</th><th>Balance after (MAD)</th><th><span className="sr-only">Open payment</span></th></tr></thead><tbody>{history.rows.map((row) => <tr key={row.payment.id}><td><button type="button" onClick={() => onSelectPayment(row.payment)} aria-label={`View payment ${row.payment.reference}`}>{row.payment.reference}</button></td><td>{shortDate(row.payment.created_at)}</td><td>+{money.format(row.added)}</td><td>{money.format(row.balanceAfter)}</td><td><ChevronRight className="h-4 w-4" aria-hidden="true" /></td></tr>)}</tbody></table></div>
            <div className="envelope-detail-history-mobile">{history.rows.map((row) => <button type="button" key={row.payment.id} onClick={() => onSelectPayment(row.payment)} aria-label={`View payment ${row.payment.reference}`}><span><strong>{row.payment.reference}</strong><b>+{money.format(row.added)}</b></span><span><small>{shortDate(row.payment.created_at)}</small><small>Balance {money.format(row.balanceAfter)}</small></span><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>)}</div>
            <p className="envelope-detail-history-note">{history.rows.length} recorded change{history.rows.length === 1 ? '' : 's'} to {meta.name}.</p>
          </>}
    </section>
  </section>
}

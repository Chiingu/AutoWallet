import { useState } from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, ChevronRight, MinusCircle, Plus, Sparkles, X } from 'lucide-react'
import { Dialog } from '../../components/common/Dialog'
import { parseAmount } from '../../utils/format'
import type { DashboardData, DashboardRule, DashboardTransaction, WalletType } from './dashboardApi'
import {
  envelopeDescription,
  envelopeMeta,
  envelopeTarget,
  money,
  ruleDescription,
  walletOrder,
} from './envelopeDisplay'
import { buildEnvelopeHistory } from './envelopeHistory'
import { newestPaymentsFirst, paymentDate } from './paymentUtils'
import './envelopeDetail.css'

interface EnvelopeDetailViewProps {
  type: WalletType
  data: DashboardData
  onBack: () => void
  onOpenRules: () => void
  onOpenPayment: (payment: DashboardTransaction) => void
  onRecordPayment: () => void
  recordDisabled: boolean
  onMoveMoney?: (payload: {
    from_wallet: WalletType
    to_wallet: WalletType
    amount: number
    reference?: string
  }) => Promise<void>
  onSpendMoney?: (payload: {
    wallet_type: WalletType
    amount: number
    reference?: string
  }) => Promise<void>
  onAskAssistant?: (question: string) => void
}

function glanceRows(
  type: WalletType,
  balance: number,
  total: number,
  target: number | null,
  rule: DashboardRule | undefined,
  history: ReturnType<typeof buildEnvelopeHistory>,
  processedPayments: DashboardTransaction[],
): { label: string; value: string }[] {
  const share = total > 0 ? `${((balance / total) * 100).toFixed(1)}%` : '0.0%'
  const lastRow = history.rows[0]
  const lastAdded = lastRow
    ? `${lastRow.added >= 0 ? '+' : '−'}${money.format(Math.abs(lastRow.added))} (${lastRow.payment.reference})`
    : history.status === 'unavailable'
      ? 'Unavailable'
      : 'None yet'

  if (type === 'rent' && target !== null) {
    const filledRow = history.rows[history.rows.length - 1]
    const skippedCount = processedPayments.filter((payment) => payment.allocations?.rent === 0).length
    const hasAllocationData = processedPayments.length > 0 &&
      processedPayments.every((payment) => payment.allocations?.rent !== undefined)
    return [
      { label: 'Target', value: `${money.format(target)} MAD` },
      { label: 'Status', value: balance >= target ? 'Met for this cycle' : `${money.format(Math.max(0, target - balance))} MAD to go` },
      { label: 'Filled by', value: filledRow ? `${filledRow.payment.reference}${filledRow.payment.created_at ? ` · ${paymentDate(filledRow.payment.created_at)}` : ''}` : lastAdded },
      { label: 'Skipped by', value: hasAllocationData ? `${skippedCount} later ${skippedCount === 1 ? 'payment' : 'payments'}` : 'Unavailable' },
    ]
  }

  if (type === 'savings' && target !== null) {
    return [
      { label: 'Cap', value: `${money.format(target)} MAD` },
      { label: 'Progress', value: `${money.format(balance)} of ${money.format(target)} (${Math.min(100, Math.round((balance / target) * 100))}%)` },
      { label: 'Remaining', value: `${money.format(Math.max(0, target - balance))} MAD to cap` },
      { label: 'Added last', value: lastAdded },
    ]
  }

  return [
    { label: 'Share of total', value: share },
    { label: 'Added last', value: lastAdded },
    { label: 'Payments', value: history.status === 'ready' ? `${history.rows.length} recorded` : `${processedPayments.length} processed` },
    { label: 'Cap', value: target !== null ? `${money.format(target)} MAD` : rule ? 'None' : 'No active rule' },
  ]
}

function insightCopy(type: WalletType, balance: number, target: number | null, rule: DashboardRule | undefined) {
  if (!rule) return `${envelopeMeta[type].name} has no active rule right now.`
  if (type === 'rent' && target !== null && balance >= target) {
    return `Rent is already at its ${money.format(target)} target, so the next payment will skip this rule.`
  }
  if (type === 'savings' && target !== null) {
    return `${money.format(Math.max(0, target - balance))} MAD left until the ${money.format(target)} cap.`
  }
  return `${ruleDescription(rule)}.`
}

export function EnvelopeDetailView({
  type,
  data,
  onBack,
  onOpenRules,
  onOpenPayment,
  onRecordPayment,
  recordDisabled,
  onMoveMoney,
  onSpendMoney,
  onAskAssistant,
}: EnvelopeDetailViewProps) {
  const meta = envelopeMeta[type]
  const Icon = meta.icon
  const balances = new Map<WalletType, number>(data.wallets.map((wallet) => [wallet.wallet_type, wallet.balance]))
  const balance = balances.get(type) ?? 0
  const total = walletOrder.reduce((sum, item) => sum + (balances.get(item) ?? 0), 0)
  const share = total > 0 ? ((balance / total) * 100).toFixed(1) : '0.0'
  const rules = [...data.rules].sort((a, b) => a.priority - b.priority)
  const rule = rules.find((item) => item.target_wallet === type)
  const target = envelopeTarget(type, rules)
  const percent = target ? Math.min(100, Math.round((balance / target) * 100)) : null
  const processedPayments = newestPaymentsFirst(data.transactions.filter((payment) => payment.status === 'processed'))
  const history = buildEnvelopeHistory(type, data.transactions, balance)
  const rows = glanceRows(type, balance, total, target, rule, history, processedPayments)

  const [moveOpen, setMoveOpen] = useState(false)
  const [spendOpen, setSpendOpen] = useState(false)
  const [toWallet, setToWallet] = useState<WalletType>(() => walletOrder.find((wt) => wt !== type) ?? 'free')
  const [amountInput, setAmountInput] = useState('')
  const [referenceInput, setReferenceInput] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const openMoveDialog = () => {
    setToWallet(walletOrder.find((wt) => wt !== type) ?? 'free')
    setAmountInput('')
    setReferenceInput('')
    setModalError(null)
    setMoveOpen(true)
  }

  const openSpendDialog = () => {
    setAmountInput('')
    setReferenceInput('')
    setModalError(null)
    setSpendOpen(true)
  }

  const handleMoveSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onMoveMoney) return
    const parsed = parseAmount(amountInput)
    if (type === toWallet) {
      setModalError('Choose a different destination envelope.')
      return
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setModalError('Enter an amount above 0.00 MAD.')
      return
    }
    if (parsed > balance + 0.001) {
      setModalError(`Only ${money.format(balance)} MAD is available in ${meta.name}.`)
      return
    }
    setSubmitting(true)
    setModalError(null)
    try {
      await onMoveMoney({
        from_wallet: type,
        to_wallet: toWallet,
        amount: parsed,
        reference: referenceInput.trim() || undefined,
      })
      setMoveOpen(false)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not move money.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSpendSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onSpendMoney) return
    const parsed = parseAmount(amountInput)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setModalError('Enter an amount above 0.00 MAD.')
      return
    }
    if (parsed > balance + 0.001) {
      setModalError(`Only ${money.format(balance)} MAD is available in ${meta.name}.`)
      return
    }
    setSubmitting(true)
    setModalError(null)
    try {
      await onSpendMoney({
        wallet_type: type,
        amount: parsed,
        reference: referenceInput.trim() || undefined,
      })
      setSpendOpen(false)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not record spending.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="envelope-detail" aria-labelledby="envelope-detail-heading">
      <button type="button" onClick={onBack} className="envelope-detail-mobile-back" aria-label="Back to Envelopes">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Envelopes
      </button>

      <div className="envelope-detail-hero">
        <div className="envelope-detail-hero-identity">
          <span className="envelope-detail-icon" style={{ backgroundColor: meta.tint, color: meta.color }} aria-hidden="true">
            <Icon className="h-6 w-6" />
          </span>
          <div>
            <h1 id="envelope-detail-heading">{meta.name}</h1>
            <p>{envelopeDescription(type, rules)}</p>
          </div>
        </div>

        <div className="envelope-detail-hero-balance">
          <strong>
            {money.format(balance)} <small>MAD</small>
          </strong>
          {target !== null && percent !== null ? (
            <div className="envelope-detail-target">
              <span
                className="envelope-detail-target-track"
                role="progressbar"
                aria-label={`${meta.name} target progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%`, backgroundColor: meta.color }} />
              </span>
              <small>
                {percent >= 100 ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Target met · {money.format(target)}
                  </>
                ) : (
                  <>
                    {type === 'savings' ? 'Cap' : 'Target'} {money.format(target)} · {money.format(Math.max(0, target - balance))} to go ({percent}%)
                  </>
                )}
              </small>
            </div>
          ) : (
            <small>{share}% of your total balance</small>
          )}
        </div>
      </div>

      <div className="envelope-detail-actions">
        <button
          type="button"
          className="dashboard-secondary-button envelope-detail-move"
          onClick={openMoveDialog}
          disabled={recordDisabled || balance <= 0}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Move money
        </button>
        {onSpendMoney && (
          <button
            type="button"
            className="dashboard-secondary-button envelope-detail-move"
            onClick={openSpendDialog}
            disabled={recordDisabled || balance <= 0}
          >
            <MinusCircle className="h-4 w-4" aria-hidden="true" />
            Record spending
          </button>
        )}
        <button type="button" className="dashboard-primary-button" onClick={onRecordPayment} disabled={recordDisabled}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Record payment
        </button>
      </div>

      <div className="envelope-detail-panels">
        <section className="envelope-detail-panel envelope-detail-rule" aria-labelledby="envelope-rule-heading">
          <h2 id="envelope-rule-heading">The rule that fills it</h2>
          {rule ? (
            <>
              <div className="envelope-detail-rule-card">
                <span className="envelope-detail-priority">{rule.priority}</span>
                <span className="envelope-detail-rule-icon" style={{ backgroundColor: meta.tint, color: meta.color }} aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <strong>{rule.name}</strong>
                  <p>{ruleDescription(rule)}</p>
                </div>
                <span className={`envelope-detail-rule-status ${rule.is_active ? 'is-active' : ''}`}>
                  <span aria-hidden="true" />
                  {rule.is_active ? 'Active' : 'Paused'}
                </span>
              </div>
              <button type="button" onClick={onOpenRules} className="envelope-detail-text-link">
                See all rules
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          ) : (
            <p className="envelope-detail-muted">No rule is set for this envelope yet.</p>
          )}
        </section>

        <section className="envelope-detail-panel envelope-detail-glance" aria-labelledby="envelope-glance-heading">
          <h2 id="envelope-glance-heading">At a glance</h2>
          <dl>
            {rows.map((row) => (
              <div key={row.label} className="envelope-detail-glance-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <aside className="envelope-detail-insight" aria-label="Envelope note">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <div>
          <p>{insightCopy(type, balance, target, rule)}</p>
          <button
            type="button"
            disabled={!onAskAssistant}
            onClick={() => onAskAssistant?.(`Explain my ${meta.name} envelope balance (${money.format(balance)} MAD) and how its rule works.`)}
          >
            Ask Assistant
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section className="envelope-detail-panel envelope-detail-history" aria-labelledby="envelope-history-heading">
        <h2 id="envelope-history-heading">Balance history</h2>
        <p>Payments that added to this envelope.</p>
        {history.status === 'ready' && history.rows.length > 0 ? (
          <>
            <div className="envelope-detail-history-desktop">
              <table aria-label={`Payments that changed the ${meta.name} envelope`}>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Date</th>
                    <th scope="col">Added (MAD)</th>
                    <th scope="col">Balance after</th>
                    <th scope="col"><span className="sr-only">Open payment</span></th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((row) => (
                    <tr key={row.payment.id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => onOpenPayment(row.payment)}
                          aria-label={`View payment ${row.payment.reference}`}
                        >
                          {row.payment.reference}
                        </button>
                      </td>
                      <td>{paymentDate(row.payment.created_at) || '—'}</td>
                      <td>{row.added >= 0 ? `+${money.format(row.added)}` : `−${money.format(Math.abs(row.added))}`}</td>
                      <td>{money.format(row.balanceAfter)}</td>
                      <td>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="envelope-detail-history-mobile">
              {history.rows.map((row) => (
                <button
                  type="button"
                  key={row.payment.id}
                  onClick={() => onOpenPayment(row.payment)}
                  aria-label={`View payment ${row.payment.reference}`}
                >
                  <span>
                    <strong>{row.payment.reference}</strong>
                    <b>{row.added >= 0 ? `+${money.format(row.added)}` : `−${money.format(Math.abs(row.added))}`}</b>
                  </span>
                  <span>
                    <small>{paymentDate(row.payment.created_at) || 'Date unavailable'}</small>
                    <small>Balance after {money.format(row.balanceAfter)}</small>
                  </span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ))}
            </div>
            <p className="envelope-detail-history-note">
              Payments that skipped this envelope (for example, once a target was already met) aren&apos;t listed here.
            </p>
          </>
        ) : (
          <p className="envelope-detail-history-empty">
            {history.status === 'unavailable'
              ? `We can't show a payment-by-payment history yet because the backend does not yet provide the per-payment allocations that produced this ${money.format(balance)} MAD balance.`
              : `No payments have added to ${meta.name} yet.`}
          </p>
        )}
      </section>

      {moveOpen && (
        <Dialog
          onClose={() => {
            if (!submitting) setMoveOpen(false)
          }}
          dismissible={!submitting}
          labelledBy="detail-move-money-title"
          panelClassName="dashboard-modal record-payment-dialog"
        >
          <button
            type="button"
            className="dashboard-modal-close"
            onClick={() => setMoveOpen(false)}
            disabled={submitting}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 id="detail-move-money-title">Move money from {meta.name}</h2>
          <p>Available in {meta.name}: {money.format(balance)} MAD.</p>
          <form onSubmit={(event) => void handleMoveSubmit(event)} noValidate>
            <label htmlFor="detail-move-to">
              To envelope
              <select
                id="detail-move-to"
                className="dashboard-input mt-2"
                value={toWallet}
                onChange={(event) => {
                  setToWallet(event.target.value as WalletType)
                  setModalError(null)
                }}
                disabled={submitting}
              >
                {walletOrder
                  .filter((wt) => wt !== type)
                  .map((wt) => (
                    <option key={wt} value={wt}>
                      {envelopeMeta[wt].name} ({money.format(balances.get(wt) ?? 0)} MAD)
                    </option>
                  ))}
              </select>
            </label>

            <label htmlFor="detail-move-amount">
              Amount (MAD)
              <span className="workspace-amount-input">
                <input
                  id="detail-move-amount"
                  type="text"
                  inputMode="decimal"
                  className="dashboard-input"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value)
                    setModalError(null)
                  }}
                  placeholder="500.00"
                  disabled={submitting}
                />
                <span>MAD</span>
              </span>
            </label>

            <label htmlFor="detail-move-ref">
              Note <span className="workspace-optional">(optional)</span>
              <input
                id="detail-move-ref"
                type="text"
                className="dashboard-input"
                value={referenceInput}
                onChange={(event) => setReferenceInput(event.target.value)}
                placeholder={`Transfer: ${meta.name} → ${envelopeMeta[toWallet].name}`}
                maxLength={100}
                disabled={submitting}
              />
            </label>

            {modalError && (
              <p className="workspace-field-error" role="alert">
                {modalError}
              </p>
            )}

            <footer>
              <button
                type="button"
                className="dashboard-secondary-button"
                onClick={() => setMoveOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="dashboard-primary-button" disabled={submitting}>
                {submitting ? 'Moving…' : 'Move money'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}

      {spendOpen && (
        <Dialog
          onClose={() => {
            if (!submitting) setSpendOpen(false)
          }}
          dismissible={!submitting}
          labelledBy="detail-spend-title"
          panelClassName="dashboard-modal record-payment-dialog"
        >
          <button
            type="button"
            className="dashboard-modal-close"
            onClick={() => setSpendOpen(false)}
            disabled={submitting}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 id="detail-spend-title">Record spending from {meta.name}</h2>
          <p>Deduct an outgoing payment or bill directly from your {meta.name} envelope ({money.format(balance)} MAD available).</p>
          <form onSubmit={(event) => void handleSpendSubmit(event)} noValidate>
            <label htmlFor="detail-spend-amount">
              Amount (MAD)
              <span className="workspace-amount-input">
                <input
                  id="detail-spend-amount"
                  type="text"
                  inputMode="decimal"
                  className="dashboard-input"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value)
                    setModalError(null)
                  }}
                  placeholder="350.00"
                  disabled={submitting}
                />
                <span>MAD</span>
              </span>
            </label>

            <label htmlFor="detail-spend-ref">
              Description / Reference
              <input
                id="detail-spend-ref"
                type="text"
                className="dashboard-input"
                value={referenceInput}
                onChange={(event) => setReferenceInput(event.target.value)}
                placeholder={`Paid from ${meta.name}`}
                maxLength={100}
                disabled={submitting}
              />
            </label>

            {modalError && (
              <p className="workspace-field-error" role="alert">
                {modalError}
              </p>
            )}

            <footer>
              <button
                type="button"
                className="dashboard-secondary-button"
                onClick={() => setSpendOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="dashboard-primary-button" disabled={submitting}>
                {submitting ? 'Recording…' : 'Record spending'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </section>
  )
}

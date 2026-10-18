import { useState } from 'react'
import { ArrowLeftRight, Check, X } from 'lucide-react'
import { Dialog } from '../../components/common/Dialog'
import { parseAmount } from '../../utils/format'
import type { DashboardRule, DashboardWallet, WalletType } from './dashboardApi'
import {
  envelopeChartColor,
  envelopeDescription,
  envelopeMeta,
  envelopeOrder,
  envelopeTarget,
  money,
  walletOrder,
} from './envelopeDisplay'
import './envelopes.css'

interface EnvelopesViewProps {
  wallets: DashboardWallet[]
  rules: DashboardRule[]
  onSelect: (type: WalletType) => void
  onMoveMoney?: (payload: {
    from_wallet: WalletType
    to_wallet: WalletType
    amount: number
    reference?: string
  }) => Promise<void>
  busy?: boolean
}

const setAsideTypes: WalletType[] = ['rent', 'tax', 'savings']
const otherTypes: WalletType[] = ['free', 'main']

export function EnvelopesSkeleton() {
  return (
    <section className="envelopes-view envelopes-skeleton" aria-label="Loading envelopes" role="status">
      <div className="envelopes-page-heading">
        <div>
          <span className="envelopes-skeleton-line envelopes-skeleton-title" />
          <span className="envelopes-skeleton-line envelopes-skeleton-subtitle" />
        </div>
      </div>
      <div className="envelopes-overview">
        <div>
          <span className="envelopes-skeleton-line envelopes-skeleton-label" />
          <span className="envelopes-skeleton-line envelopes-skeleton-value" />
          <span className="envelopes-skeleton-line envelopes-skeleton-subtitle" />
        </div>
        <div>
          <span className="envelopes-skeleton-line envelopes-skeleton-bar" />
          <span className="envelopes-skeleton-line envelopes-skeleton-row" />
          <span className="envelopes-skeleton-line envelopes-skeleton-row" />
        </div>
      </div>
      <span className="envelopes-skeleton-line envelopes-skeleton-label" />
      <div className="envelopes-grid envelopes-grid--set-aside">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="envelopes-skeleton-card">
            <span className="envelopes-skeleton-line envelopes-skeleton-label" />
            <span className="envelopes-skeleton-line envelopes-skeleton-value" />
            <span className="envelopes-skeleton-line envelopes-skeleton-row" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading envelopes</span>
    </section>
  )
}

export function EnvelopesView({ wallets, rules, onSelect, onMoveMoney, busy = false }: EnvelopesViewProps) {
  const balances = new Map<WalletType, number>(wallets.map((wallet) => [wallet.wallet_type, wallet.balance]))
  const total = walletOrder.reduce((sum, type) => sum + (balances.get(type) ?? 0), 0)
  const setAsideTotal = envelopeOrder.reduce((sum, type) => sum + (balances.get(type) ?? 0), 0)
  const freeBalance = balances.get('free') ?? 0

  const [moveOpen, setMoveOpen] = useState(false)
  const [fromWallet, setFromWallet] = useState<WalletType>('free')
  const [toWallet, setToWallet] = useState<WalletType>('savings')
  const [amountInput, setAmountInput] = useState('')
  const [referenceInput, setReferenceInput] = useState('')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const openMoveModal = () => {
    const firstWithFunds = walletOrder.find((wt) => (balances.get(wt) ?? 0) > 0) ?? 'free'
    setFromWallet(firstWithFunds)
    setToWallet(firstWithFunds === 'savings' ? 'free' : 'savings')
    setAmountInput('')
    setReferenceInput('')
    setMoveError(null)
    setMoveOpen(true)
  }

  const submitMove = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onMoveMoney) return
    const parsed = parseAmount(amountInput)
    const available = balances.get(fromWallet) ?? 0
    if (fromWallet === toWallet) {
      setMoveError('Choose two different envelopes to move money between.')
      return
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMoveError('Enter an amount above 0.00 MAD.')
      return
    }
    if (parsed > available + 0.001) {
      setMoveError(`Only ${money.format(available)} MAD is available in ${envelopeMeta[fromWallet].name}.`)
      return
    }

    setSubmitting(true)
    setMoveError(null)
    try {
      await onMoveMoney({
        from_wallet: fromWallet,
        to_wallet: toWallet,
        amount: parsed,
        reference: referenceInput.trim() || undefined,
      })
      setMoveOpen(false)
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Could not move money between envelopes.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="envelopes-view" aria-labelledby="envelopes-heading">
      <div className="envelopes-page-heading">
        <div>
          <h1 id="envelopes-heading">Envelopes</h1>
          <p>How your money is split across every envelope.</p>
        </div>
        <button
          type="button"
          className="dashboard-secondary-button envelopes-move-button"
          onClick={openMoveModal}
          disabled={busy || total <= 0}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Move money
        </button>
      </div>

      <section className="envelopes-overview" aria-label="Total across envelopes">
        <div className="envelopes-overview-total">
          <p>Total across envelopes</p>
          <strong>
            {money.format(total)} <small>MAD</small>
          </strong>
          <span>
            Set aside {money.format(setAsideTotal)} · Free to spend {money.format(freeBalance)}
          </span>
        </div>

        <div>
          <div className="envelopes-allocation-bar" role="img" aria-label="Balance allocation by envelope">
            {walletOrder.map((type) => {
              const balance = balances.get(type) ?? 0
              const width = total > 0 ? Math.max(0, (balance / total) * 100) : 0
              if (width <= 0) return null
              return (
                <span
                  key={type}
                  style={{ width: `${width}%`, backgroundColor: envelopeChartColor(type) }}
                  title={`${envelopeMeta[type].name}: ${money.format(balance)} MAD`}
                />
              )
            })}
          </div>
          <div className="envelopes-allocation-list">
            {walletOrder.map((type) => {
              const balance = balances.get(type) ?? 0
              const share = total > 0 ? Math.round((balance / total) * 100) : 0
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onSelect(type)}
                  className="envelopes-allocation-row"
                >
                  <span className="envelopes-allocation-name">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: envelopeChartColor(type) }}
                      aria-hidden="true"
                    />
                    <span>{envelopeMeta[type].name}</span>
                  </span>
                  <strong>{money.format(balance)}</strong>
                  <span>{share}%</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <div className="envelopes-section">
        <div className="envelopes-section-heading">
          <h2>Set aside</h2>
          <span>Filled first from every payment, in rule order</span>
        </div>
        <div className="envelopes-grid envelopes-grid--set-aside">
          {setAsideTypes.map((type) => (
            <EnvelopeCard
              key={type}
              type={type}
              balance={balances.get(type) ?? 0}
              total={total}
              rules={rules}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      <div className="envelopes-section">
        <div className="envelopes-section-heading">
          <h2>Other</h2>
          <span>What remains after set-aside rules</span>
        </div>
        <div className="envelopes-grid envelopes-grid--other">
          {otherTypes.map((type) => (
            <EnvelopeCard
              key={type}
              type={type}
              balance={balances.get(type) ?? 0}
              total={total}
              rules={rules}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      {moveOpen && (
        <Dialog
          onClose={() => {
            if (!submitting) setMoveOpen(false)
          }}
          dismissible={!submitting}
          labelledBy="move-money-title"
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
          <h2 id="move-money-title">Move money between envelopes</h2>
          <p>Transfer funds immediately between your envelopes. Your total balance stays the same.</p>
          <form onSubmit={(event) => void submitMove(event)} noValidate>
            <label htmlFor="move-from-wallet">
              From envelope
              <select
                id="move-from-wallet"
                className="dashboard-input mt-2"
                value={fromWallet}
                onChange={(event) => {
                  const next = event.target.value as WalletType
                  setFromWallet(next)
                  if (next === toWallet) {
                    const fallback = walletOrder.find((wt) => wt !== next) ?? 'free'
                    setToWallet(fallback)
                  }
                  setMoveError(null)
                }}
                disabled={submitting}
              >
                {walletOrder.map((wt) => (
                  <option key={wt} value={wt}>
                    {envelopeMeta[wt].name} ({money.format(balances.get(wt) ?? 0)} MAD)
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="move-to-wallet">
              To envelope
              <select
                id="move-to-wallet"
                className="dashboard-input mt-2"
                value={toWallet}
                onChange={(event) => {
                  setToWallet(event.target.value as WalletType)
                  setMoveError(null)
                }}
                disabled={submitting}
              >
                {walletOrder.map((wt) => (
                  <option key={wt} value={wt} disabled={wt === fromWallet}>
                    {envelopeMeta[wt].name} ({money.format(balances.get(wt) ?? 0)} MAD)
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="move-amount">
              Amount (MAD)
              <span className="workspace-amount-input">
                <input
                  id="move-amount"
                  type="text"
                  inputMode="decimal"
                  className="dashboard-input"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value)
                    setMoveError(null)
                  }}
                  placeholder="500.00"
                  disabled={submitting}
                />
                <span>MAD</span>
              </span>
            </label>

            <label htmlFor="move-reference">
              Note <span className="workspace-optional">(optional)</span>
              <input
                id="move-reference"
                type="text"
                className="dashboard-input"
                value={referenceInput}
                onChange={(event) => setReferenceInput(event.target.value)}
                placeholder={`Transfer: ${envelopeMeta[fromWallet].name} → ${envelopeMeta[toWallet].name}`}
                maxLength={100}
                disabled={submitting}
              />
            </label>

            {moveError && (
              <p className="workspace-field-error" role="alert">
                {moveError}
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
    </section>
  )
}

function EnvelopeCard({
  type,
  balance,
  total,
  rules,
  onSelect,
}: {
  type: WalletType
  balance: number
  total: number
  rules: DashboardRule[]
  onSelect: (type: WalletType) => void
}) {
  const meta = envelopeMeta[type]
  const Icon = meta.icon
  const target = envelopeTarget(type, rules)
  const percent = target ? Math.min(100, Math.round((balance / target) * 100)) : null
  const remaining = target ? Math.max(0, target - balance) : null
  const share = total > 0 ? ((balance / total) * 100).toFixed(1) : '0.0'

  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      className={`envelopes-card envelopes-card--${type}`}
      aria-label={`Open ${meta.name} envelope, ${money.format(balance)} MAD`}
    >
      <span className="envelopes-card-heading">
        <span className="envelopes-card-icon" style={{ backgroundColor: meta.tint, color: meta.color }} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span>
          <strong>{meta.name}</strong>
          <small>{envelopeDescription(type, rules)}</small>
        </span>
      </span>

      <strong className="envelopes-card-value">
        {money.format(balance)} <small>MAD</small>
      </strong>

      {target !== null && percent !== null && (
        <span className="envelopes-card-progress">
          <span
            className="envelopes-card-track"
            role="progressbar"
            aria-label={`${meta.name} target progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%`, backgroundColor: meta.color }} />
          </span>
          <span className="envelopes-card-progress-caption">
            {percent >= 100 ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Target met · {money.format(target)}
              </>
            ) : (
              <>
                {type === 'savings' ? 'Cap' : 'Target'} {money.format(target)} · {money.format(remaining ?? 0)} to go ({percent}%)
              </>
            )}
          </span>
        </span>
      )}

      {type === 'tax' && target === null && (
        <span className="envelopes-card-footnote">No cap · grows with every payment</span>
      )}
      {type === 'free' && (
        <span className="envelopes-card-footnote">{share}% of your total balance</span>
      )}
      {type === 'main' && (
        <span className="envelopes-card-footnote">0% when Free to spend takes 100%</span>
      )}
    </button>
  )
}

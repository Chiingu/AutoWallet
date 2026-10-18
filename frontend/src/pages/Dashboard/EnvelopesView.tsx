import { ArrowLeftRight, Check } from 'lucide-react'
import type { DashboardData, DashboardTransaction, WalletType } from './dashboardApi'
import { envelopeDescription, envelopeMeta, envelopeTarget, money, walletOrder } from './envelopeDisplay'
import { paymentDate } from './paymentUtils'
import './envelopes.css'

const setAsideTypes: WalletType[] = ['rent', 'tax', 'savings']

function paymentChange(type: WalletType, transactions: DashboardTransaction[]) {
  return transactions.find((payment) => payment.status === 'processed' &&
    typeof payment.allocations?.[type] === 'number' && payment.allocations[type]! > 0)
}

function EnvelopeCard({ type, data, onOpen }: {
  type: WalletType
  data: DashboardData
  onOpen: (type: WalletType) => void
}) {
  const meta = envelopeMeta[type]
  const Icon = meta.icon
  const balance = data.wallets.find((wallet) => wallet.wallet_type === type)?.balance ?? 0
  const target = envelopeTarget(type, data.rules)
  const progress = target === null ? null : Math.max(0, Math.min(100, balance / target * 100))
  const latestChange = paymentChange(type, data.transactions)
  const change = latestChange?.allocations?.[type]

  return (
    <button type="button" className={`envelopes-card envelopes-card--${type}`} onClick={() => onOpen(type)}
      aria-label={`Open ${meta.name} envelope, ${money.format(balance)} MAD`}>
      <span className="envelopes-card-heading">
        <span className="envelopes-card-icon" style={{ color: meta.color, backgroundColor: meta.tint }}><Icon className="h-[19px] w-[19px]" aria-hidden="true" /></span>
        <span><strong>{meta.name}</strong><small>{envelopeDescription(type, data.rules)}</small></span>
      </span>
      <span className="envelopes-card-value">{money.format(balance)} <small>MAD</small></span>
      {progress !== null && target !== null && (
        <span className="envelopes-card-progress">
          <span className="envelopes-card-track" role="progressbar" aria-label={`${meta.name} target progress`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
            <span style={{ width: `${progress}%`, backgroundColor: meta.color }} />
          </span>
          <span className="envelopes-card-progress-caption">
            {progress >= 100 && type === 'rent' ? <><Check className="h-3 w-3" aria-hidden="true" />Target met · {money.format(balance)} of {money.format(target)}</>
              : `${Math.round(progress)}% of the ${money.format(target)} ${type === 'savings' ? 'cap' : 'target'}`}
          </span>
        </span>
      )}
      <span className="envelopes-card-footnote">
        {latestChange && change !== undefined
          ? `Last change +${money.format(change)}${latestChange.created_at ? ` · ${paymentDate(latestChange.created_at)}` : ''}`
          : type === 'main' && balance === 0 ? 'Nothing so far: your rules use every payment' : 'Payment changes will appear here when available'}
      </span>
    </button>
  )
}

export function EnvelopesSkeleton() {
  return <section className="envelopes-view envelopes-skeleton" role="status" aria-label="Loading envelopes">
    <div className="envelopes-page-heading"><div><span className="envelopes-skeleton-line envelopes-skeleton-title" /><span className="envelopes-skeleton-line envelopes-skeleton-subtitle" /></div></div>
    <div className="envelopes-overview"><div><span className="envelopes-skeleton-line envelopes-skeleton-label" /><span className="envelopes-skeleton-line envelopes-skeleton-value" /><span className="envelopes-skeleton-line envelopes-skeleton-subtitle" /></div><div><span className="envelopes-skeleton-line envelopes-skeleton-bar" />{[1, 2, 3, 4, 5].map((index) => <span key={index} className="envelopes-skeleton-line envelopes-skeleton-row" />)}</div></div>
    <span className="envelopes-skeleton-line envelopes-skeleton-label" />
    <div className="envelopes-grid envelopes-grid--set-aside">{[1, 2, 3].map((index) => <div key={index} className="envelopes-skeleton-card"><span className="envelopes-skeleton-line envelopes-skeleton-label" /><span className="envelopes-skeleton-line envelopes-skeleton-value" /><span className="envelopes-skeleton-line envelopes-skeleton-row" /></div>)}</div>
    <span className="envelopes-skeleton-line envelopes-skeleton-label" />
    <div className="envelopes-grid envelopes-grid--other">{[1, 2].map((index) => <div key={index} className="envelopes-skeleton-card"><span className="envelopes-skeleton-line envelopes-skeleton-label" /><span className="envelopes-skeleton-line envelopes-skeleton-value" /></div>)}</div>
    <span className="sr-only">Loading envelope balances</span>
  </section>
}

export function EnvelopesView({ data, onOpen }: {
  data: DashboardData
  onOpen: (type: WalletType) => void
}) {
  const balances = Object.fromEntries(walletOrder.map((type) => [type, data.wallets.find((wallet) => wallet.wallet_type === type)?.balance ?? 0])) as Record<WalletType, number>
  const total = walletOrder.reduce((sum, type) => sum + balances[type], 0)
  const setAside = setAsideTypes.reduce((sum, type) => sum + balances[type], 0)

  return <section className="envelopes-view" aria-labelledby="envelopes-title">
    <div className="envelopes-page-heading">
      <div><h1 id="envelopes-title">Envelopes</h1><p>What each envelope holds and the rule that fills it.</p></div>
      <button type="button" className="dashboard-primary-button envelopes-move-button" disabled title="Coming soon"><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Move money <span className="dashboard-soon-badge">Soon</span></button>
    </div>

    <section className="envelopes-overview" aria-label="Envelope balance overview">
      <div className="envelopes-overview-total">
        <p>Total in your envelopes</p>
        <strong>{money.format(total)} <small>MAD</small></strong>
        <span>Set aside {money.format(setAside)} · Free to spend {money.format(balances.free)} · Main {money.format(balances.main)}</span>
      </div>
      <div className="envelopes-overview-allocation">
        <div className="envelopes-allocation-bar" role="img" aria-label="Balance allocation by envelope">
          {walletOrder.map((type) => balances[type] > 0 && total > 0 ? <span key={type} style={{ width: `${balances[type] / total * 100}%`, backgroundColor: type === 'free' ? '#EFA400' : envelopeMeta[type].color }} /> : null)}
        </div>
        <div className="envelopes-allocation-list">
          {walletOrder.map((type) => { const meta = envelopeMeta[type]; const Icon = meta.icon; return <button type="button" key={type} onClick={() => onOpen(type)} className="envelopes-allocation-row">
            <span className="envelopes-allocation-name" style={{ color: meta.color }}><Icon className="h-4 w-4" aria-hidden="true" /><span>{meta.name}</span></span>
            <strong>{money.format(balances[type])}</strong><span>{total > 0 ? (balances[type] / total * 100).toFixed(1) : '0.0'}%</span>
          </button> })}
        </div>
      </div>
    </section>

    <section className="envelopes-section" aria-labelledby="envelopes-set-aside-title">
      <div className="envelopes-section-heading"><h2 id="envelopes-set-aside-title">Set aside</h2><span>{money.format(setAside)} MAD in Rent, Tax and Savings</span></div>
      <div className="envelopes-grid envelopes-grid--set-aside">{setAsideTypes.map((type) => <EnvelopeCard key={type} type={type} data={data} onOpen={onOpen} />)}</div>
    </section>

    <section className="envelopes-section" aria-labelledby="envelopes-other-title">
      <div className="envelopes-section-heading"><h2 id="envelopes-other-title">Free to spend and Main</h2><span>{money.format(balances.free + balances.main)} MAD</span></div>
      <div className="envelopes-grid envelopes-grid--other"><EnvelopeCard type="free" data={data} onOpen={onOpen} /><EnvelopeCard type="main" data={data} onOpen={onOpen} /></div>
    </section>

  </section>
}

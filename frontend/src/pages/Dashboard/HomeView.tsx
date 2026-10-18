import { ArrowRight, Check, ChevronRight, FlaskConical, Mail, Plus, ShieldCheck, ShoppingBag } from 'lucide-react'
import type { DashboardData, DashboardTransaction, WalletType } from './dashboardApi'
import { previewSplit } from './dashboardSplit'
import type { SplitAmounts } from './dashboardSplit'
import { DashboardSplitRibbon } from './DashboardSplitRibbon'
import { PaymentSplitBar as SplitBar, PaymentStatus as Status } from './PaymentDisplay'
import { hasCompleteSplit, paymentDate as date } from './paymentUtils'
import { envelopeDescription, envelopeMeta, envelopeOrder, envelopeTarget, money } from './envelopeDisplay'

const previewAmount = 8500

function EnvelopeRow({ type, data }: { type: WalletType; data: DashboardData }) {
  const item = envelopeMeta[type]
  const Icon = item.icon
  const balance = data.wallets.find((wallet) => wallet.wallet_type === type)?.balance
  const target = envelopeTarget(type, data.rules)
  const progress = target && balance !== undefined ? Math.max(0, Math.min(100, balance / target * 100)) : 0
  return <article className="dashboard-envelope-row">
    <span className="dashboard-envelope-icon" style={{ backgroundColor: item.tint, color: item.color }}><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-bold text-[#243044]">{item.name}</h3><strong className={`shrink-0 text-sm tabular-nums ${type === 'main' ? 'text-[#65748C]' : 'text-[#243044]'}`}>{balance === undefined ? '—' : money.format(balance)}</strong></div>
      <p className="mt-1 text-xs leading-5 text-[#66758D]">{envelopeDescription(type, data.rules)}</p>
      {target !== null && balance !== undefined && <div className="mt-3 max-w-[320px]"><div className="h-1 overflow-hidden rounded-full bg-[#E5EAF0]" role="progressbar" aria-label={`${item.name} target progress`} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span className="block h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: item.color }} /></div><p className="mt-2 text-[11px] text-[#66758D]">{type === 'rent' && progress >= 100 ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-[#188442]" aria-hidden="true" />Target met</span> : `${Math.round(progress)}% of the ${money.format(target)} ${type === 'savings' ? 'cap' : 'target'}`}</p></div>}
    </div>
  </article>
}

function Payments({ payments, onSelect, limit }: { payments: DashboardTransaction[]; onSelect: (payment: DashboardTransaction) => void; limit?: number }) {
  const visiblePayments = limit === undefined ? payments : payments.slice(0, limit)
  if (payments.length === 0) return <div className="dashboard-empty-payments">
    <div className="flex items-center text-[#7EA4C1]" aria-hidden="true"><span className="mr-2 w-10 border-t-2 border-dashed border-[#9FB1C0]" /><Mail className="h-8 w-8 fill-[#D7E7F3]" /><Mail className="-ml-1 h-8 w-8 fill-[#D7E7F3]" /><Mail className="-ml-1 h-8 w-8 fill-[#D7E7F3]" /></div>
    <h3 className="mt-5 text-base font-bold text-[#273247]">No payments yet</h3>
    <p className="mt-2 max-w-xs text-sm leading-6 text-[#728198]">When a client pays your linked account, it shows up here, already split.</p>
  </div>
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="dashboard-payments-table"><thead><tr><th>Reference</th><th>Received ↓</th><th className="text-right">Amount (MAD)</th><th>Split</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{visiblePayments.map((payment) => <tr key={payment.id}><td className="font-mono font-semibold text-[#263246]">{payment.reference}</td><td className="text-[#708099]">{date(payment.created_at) || '—'}</td><td className="text-right font-semibold tabular-nums text-[#263246]">{money.format(payment.amount)}</td><td className="w-[32%]"><SplitBar payment={payment} /></td><td><Status status={payment.status} /></td><td><button type="button" onClick={() => onSelect(payment)} aria-label={`View ${payment.reference}`} className="text-[#8090A7] hover:text-[#5963B6]"><ChevronRight className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
    <div className="divide-y divide-[#DCE3EB] md:hidden">{visiblePayments.map((payment) => <button type="button" key={payment.id} onClick={() => onSelect(payment)} className="block w-full py-3.5 text-left"><span className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs font-semibold text-[#263246]">{payment.reference}</span><strong className="text-sm tabular-nums text-[#263246]">{money.format(payment.amount)}</strong></span><span className="mt-2 flex items-center gap-2"><span className="shrink-0 text-xs text-[#7A879B]">{date(payment.created_at) || '—'}</span><span className="min-w-0 flex-1"><SplitBar payment={payment} /></span><Status status={payment.status} /></span></button>)}</div>
  </>
}

export function LoadingHome() {
  return <div className="animate-pulse space-y-8" role="status" aria-label="Loading dashboard"><div className="h-8 w-60 rounded-lg bg-[#E6EBF1]" /><div className="grid gap-8 md:grid-cols-2"><div className="space-y-4"><div className="h-5 w-32 rounded bg-[#E6EBF1]" /><div className="h-14 w-56 rounded bg-[#E6EBF1]" /><div className="h-4 w-72 rounded bg-[#E6EBF1]" /></div><div className="space-y-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded bg-[#E6EBF1]" />)}</div></div><div className="h-64 rounded bg-[#E6EBF1]" /><div className="h-56 rounded-xl bg-white" /><span className="sr-only">Loading dashboard data</span></div>
}

interface HomeViewProps {
  data: DashboardData
  recordAvailable: boolean
  onNavigate: (view: 'sandbox' | 'rules' | 'activity') => void
  onRecord: () => void
  onSelectPayment: (payment: DashboardTransaction) => void
}

export function HomeView({ data, recordAvailable, onNavigate, onRecord, onSelectPayment }: HomeViewProps) {
  const payments = data.transactions
  const firstName = data.user.full_name.trim().split(/\s+/)[0] || 'there'
  const latest = data.transactions.find(payment => payment.status === 'processed')
  const wallets = data.wallets
  const freeBalance = wallets.find((item) => item.wallet_type === 'free')?.balance ?? 0
  const setAside = wallets.filter((item) => item.wallet_type === 'rent' || item.wallet_type === 'tax' || item.wallet_type === 'savings').reduce((sum, item) => sum + item.balance, 0)
  const totalBalance = wallets.reduce((sum, item) => sum + item.balance, 0)
  const historical = data.transactions.find((item) => item.status === 'processed' && hasCompleteSplit(item))
  const ribbonAllocations: SplitAmounts = historical ? { main: 0, rent: 0, tax: 0, savings: 0, free: 0, ...historical.allocations } : previewSplit(previewAmount, data.rules, wallets)
  const activeRules = data.rules.filter((item) => item.is_active).length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return <>
    <div className="dashboard-intro"><div><h1>{greeting}, {firstName}</h1><p>{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date())}</p></div><div className="dashboard-actions"><span>Payments</span><button type="button" onClick={() => onNavigate('sandbox')} className="dashboard-secondary-button"><FlaskConical className="h-4 w-4" />Simulate payment</button><button type="button" onClick={() => onRecord()} disabled={!recordAvailable} className="dashboard-primary-button"><Plus className="h-4 w-4" />Record payment</button></div></div>
    <div className="dashboard-hero"><section aria-labelledby="free-heading" className="dashboard-free"><div className="flex items-center gap-2"><span className="dashboard-envelope-icon !h-7 !w-7" style={{ backgroundColor: envelopeMeta.free.tint, color: envelopeMeta.free.color }}><ShoppingBag className="h-4 w-4" /></span><h2 id="free-heading" className="text-sm font-bold text-[#29364A]">Free to spend</h2></div><p className="dashboard-free-amount">{money.format(freeBalance)} <span>MAD</span></p><p className="mt-4 text-sm text-[#62718A]">Set aside {money.format(setAside)} in Rent, Tax and Savings</p><p className="mt-1 text-sm text-[#8290A5]">Total {money.format(totalBalance)}</p><p className="mt-5 flex items-start gap-2 text-sm text-[#66758D]"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#178449]" />{latest ? <>+{money.format(latest.amount)} from {latest.reference}{latest.created_at ? ` · ${date(latest.created_at)}` : ''}</> : payments.length ? 'No processed payments yet.' : 'No payments yet. Your first payment will appear here.'}</p><div className="mt-5 text-sm text-[#66758D]"><p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{activeRules > 0 ? `${activeRules} active rules are ready to split payments.` : 'Set up rules to organize your payments.'}</p><button type="button" onClick={() => onNavigate('rules')} className="ml-6 mt-1 inline-flex items-center gap-1 font-semibold text-[#5963B6]">View rules <ArrowRight className="h-4 w-4" /></button></div></section>{data.transactions.length === 0 ? <div className="dashboard-empty-hero"><Payments payments={[]} onSelect={onSelectPayment} /></div> : <section aria-labelledby="set-aside-heading" className="dashboard-set-aside"><h2 id="set-aside-heading" className="mb-2 text-sm font-bold text-[#29364A]">Set aside</h2>{envelopeOrder.map((type) => <EnvelopeRow key={type} type={type} data={data} />)}</section>}</div>
          <section className="dashboard-split-section" aria-labelledby="split-heading"><div className="dashboard-section-heading"><h2 id="split-heading">{historical ? 'Last payment split' : 'What your next payment will do'}</h2>{historical?.created_at && <span>{date(historical.created_at)}</span>}<button type="button" onClick={() => historical ? onSelectPayment(historical) : onNavigate('sandbox')}>{historical ? 'View payment' : 'Try an amount'} <ArrowRight className="h-4 w-4" /></button></div><DashboardSplitRibbon amount={historical?.amount ?? previewAmount} allocations={ribbonAllocations} reference={historical?.reference} preview={!historical} />{!historical && <p className="dashboard-preview-note">Preview with {money.format(previewAmount)} MAD using your current rules. Your balances will not change.</p>}</section>
          {data.transactions.length > 0 && <section className="dashboard-recent" aria-labelledby="recent-heading"><div className="dashboard-section-heading"><h2 id="recent-heading">Recent payments</h2><button type="button" onClick={() => onNavigate('activity')}>View all <ArrowRight className="h-4 w-4" /></button></div><Payments payments={payments} onSelect={onSelectPayment} limit={5} /></section>}
  </>
}

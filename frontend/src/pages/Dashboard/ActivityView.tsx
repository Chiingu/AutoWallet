import { useDeferredValue, useMemo, useState } from 'react'
import type { Ref } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Mail, Plus, Search, X } from 'lucide-react'
import type { DashboardTransaction, WalletType } from './dashboardApi'
import { envelopeMeta, money } from './envelopeDisplay'
import { PaymentSplitBar, PaymentStatus } from './PaymentDisplay'
import { paymentDate } from './paymentUtils'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'
import './activity.css'

type FilterName = 'date' | 'amount' | 'envelope' | 'status'
type SortField = 'reference' | 'received' | 'amount' | 'status'
type SortDirection = 'asc' | 'desc'
const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const rangeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

interface ActivityViewProps {
  payments: DashboardTransaction[]
  search: string
  onSearchChange: (value: string) => void
  onSelect: (payment: DashboardTransaction) => void
  onRecord: () => void
  recordDisabled: boolean
  searchInputRef?: Ref<HTMLInputElement>
}

function monthKey(payment: DashboardTransaction) {
  if (!payment.created_at) return 'unknown'
  return localDateKey(payment.created_at).slice(0, 7)
}

function localDateKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function monthTitle(key: string) {
  if (key === 'unknown') return 'Date unavailable'
  const [year, month] = key.split('-').map(Number)
  return monthFormatter.format(new Date(year, month - 1, 1))
}

function dateRangeLabel(payments: DashboardTransaction[]) {
  const dates = payments.flatMap((payment) => payment.created_at ? [new Date(payment.created_at)] : []).sort((a, b) => a.getTime() - b.getTime())
  if (!dates.length || dates.length !== payments.length) return 'All dates'
  const first = dates[0]
  const last = dates[dates.length - 1]
  return first.getFullYear() === last.getFullYear()
    ? `${rangeFormatter.format(first)} – ${rangeFormatter.format(last)}, ${last.getFullYear()}`
    : `${rangeFormatter.format(first)}, ${first.getFullYear()} – ${rangeFormatter.format(last)}, ${last.getFullYear()}`
}

function accessiblePaymentLabel(payment: DashboardTransaction) {
  return `${payment.reference}, ${money.format(payment.amount)} MAD, ${payment.created_at ? paymentDate(payment.created_at) : 'date unavailable'}, ${payment.status}`
}

export function ActivitySkeleton() {
  return <section className="activity-view" aria-label="Loading activity" role="status">
    <div className="activity-heading"><div><span className="activity-skeleton activity-skeleton--title" /><span className="activity-skeleton activity-skeleton--subtitle" /></div></div>
    <div className="activity-skeleton activity-skeleton--filters" />
    <div className="activity-panel activity-loading"><div className="activity-loading-head"><span>Reference</span><span>Received</span><span>Amount (MAD)</span><span>Split</span><span>Status</span></div>{Array.from({ length: 5 }, (_, index) => <div key={index} className="activity-loading-row"><span /><span /><span /><span /><span /></div>)}</div>
    <span className="sr-only">Loading payments</span>
  </section>
}

export function ActivityView({ payments, search, onSearchChange, onSelect, onRecord, recordDisabled, searchInputRef }: ActivityViewProps) {
  const [openFilter, setOpenFilter] = useState<FilterName | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [envelope, setEnvelope] = useState<WalletType | ''>('')
  const [status, setStatus] = useState<DashboardTransaction['status'] | ''>('')
  const [sortField, setSortField] = useState<SortField>('received')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const filtersRef = useDismissibleLayer(openFilter !== null, () => setOpenFilter(null))
  const deferredSearch = useDeferredValue(search)
  const availableDateRange = useMemo(() => dateRangeLabel(payments), [payments])

  const hasFilters = Boolean(search.trim() || startDate || endDate || minAmount || maxAmount || envelope || status)
  const clearFilters = () => {
    onSearchChange('')
    setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); setEnvelope(''); setStatus('')
    setOpenFilter(null)
  }
  const sortBy = (field: SortField) => {
    if (field === sortField) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDirection(field === 'received' ? 'desc' : 'asc') }
  }

  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    const min = minAmount ? Number(minAmount) : null
    const max = maxAmount ? Number(maxAmount) : null
    return payments.filter((payment) => {
      if (query && !payment.reference.toLowerCase().includes(query)) return false
      if ((startDate || endDate) && !payment.created_at) return false
      if (payment.created_at) {
        const received = localDateKey(payment.created_at)
        if (startDate && received < startDate) return false
        if (endDate && received > endDate) return false
      }
      if (min !== null && payment.amount < min) return false
      if (max !== null && payment.amount > max) return false
      if (envelope && !(payment.allocations?.[envelope] && payment.allocations[envelope] > 0)) return false
      if (status && payment.status !== status) return false
      return true
    })
  }, [payments, deferredSearch, startDate, endDate, minAmount, maxAmount, envelope, status])

  const groups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => {
      const result = sortField === 'received'
        ? (a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0)
        : sortField === 'amount' ? a.amount - b.amount : a[sortField].localeCompare(b[sortField])
      return (sortDirection === 'asc' ? result : -result) || a.reference.localeCompare(b.reference)
    })
    const byMonth = new Map<string, DashboardTransaction[]>()
    for (const payment of sorted) {
      const key = monthKey(payment)
      const items = byMonth.get(key)
      if (items) items.push(payment)
      else byMonth.set(key, [payment])
    }
    return [...byMonth.entries()].sort(([a], [b]) => a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a))
  }, [filtered, sortField, sortDirection])

  const sortHeader = (field: SortField, label: string) => <button type="button" onClick={() => sortBy(field)}>{label}{field === sortField ? sortDirection === 'desc' ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" /> : <span className="activity-sort-neutral" aria-hidden="true">↕</span>}</button>
  const toggle = (name: FilterName) => setOpenFilter((current) => current === name ? null : name)
  const selectedDate = startDate || endDate
    ? `${startDate || 'Any'} – ${endDate || 'Any'}`
    : availableDateRange
  const amountLabel = minAmount || maxAmount ? `${minAmount ? `From ${money.format(Number(minAmount))}` : ''}${minAmount && maxAmount ? ' · ' : ''}${maxAmount ? `To ${money.format(Number(maxAmount))}` : ''}` : 'Amount'

  return <section className="activity-view" aria-labelledby="activity-heading">
    <div className="activity-heading"><div><h1 id="activity-heading">Activity</h1><p>Every payment and how it was split.</p></div><button type="button" className="dashboard-primary-button" onClick={onRecord} disabled={recordDisabled}><Plus className="h-4 w-4" />Record payment</button></div>

    <label className="activity-mobile-search"><Search className="h-5 w-5" aria-hidden="true" /><input ref={searchInputRef} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="e.g. INV-2026-047" aria-label="Search payments by reference" type="search" /></label>

    <div className="activity-filter-bar" ref={filtersRef}>
      <div className="activity-filter-scroll" role="group" aria-label="Filter payments">
        <div className="activity-filter-wrap"><button type="button" className="activity-filter-chip activity-filter-chip--selected" onClick={() => toggle('date')} aria-expanded={openFilter === 'date'}>{selectedDate}<ChevronDown className="h-3 w-3" /></button>{openFilter === 'date' && <div className="activity-filter-menu activity-filter-menu--date"><strong>Received date</strong><label>From<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label><label>To<input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label><button type="button" className="activity-filter-reset" onClick={() => { setStartDate(''); setEndDate(''); setOpenFilter(null) }}>All dates</button>{!payments.some((payment) => payment.created_at) && <p>Payment dates are unavailable.</p>}</div>}</div>
        <div className="activity-filter-wrap"><button type="button" className={`activity-filter-chip ${minAmount || maxAmount ? 'activity-filter-chip--selected' : ''}`} onClick={() => toggle('amount')} aria-expanded={openFilter === 'amount'}>{minAmount || maxAmount ? '' : '+ '}{amountLabel}<ChevronDown className="h-3 w-3" /></button>{openFilter === 'amount' && <div className="activity-filter-menu"><strong>Amount (MAD)</strong><label>Minimum<input type="number" min="0" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="0.00" /></label><label>Maximum<input type="number" min={minAmount || '0'} step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Any" /></label><button type="button" className="activity-filter-reset" onClick={() => { setMinAmount(''); setMaxAmount(''); setOpenFilter(null) }}>Clear amount</button></div>}</div>
        <div className="activity-filter-wrap"><button type="button" className={`activity-filter-chip ${envelope ? 'activity-filter-chip--selected' : ''}`} onClick={() => toggle('envelope')} aria-expanded={openFilter === 'envelope'}>{envelope ? envelopeMeta[envelope].name : '+ Envelope'}<ChevronDown className="h-3 w-3" /></button>{openFilter === 'envelope' && <div className="activity-filter-menu activity-filter-menu--options"><strong>Envelope received</strong>{(['rent', 'tax', 'savings', 'free', 'main'] as const).map((type) => <button type="button" key={type} onClick={() => { setEnvelope(type); setOpenFilter(null) }} aria-pressed={envelope === type}>{envelopeMeta[type].name}</button>)}<button type="button" className="activity-filter-reset" onClick={() => { setEnvelope(''); setOpenFilter(null) }}>All envelopes</button><p>Envelope filtering needs payment split data.</p></div>}</div>
        <div className="activity-filter-wrap"><button type="button" className={`activity-filter-chip ${status ? 'activity-filter-chip--selected' : ''}`} onClick={() => toggle('status')} aria-expanded={openFilter === 'status'}>{status ? status[0].toUpperCase() + status.slice(1) : '+ Status'}<ChevronDown className="h-3 w-3" /></button>{openFilter === 'status' && <div className="activity-filter-menu activity-filter-menu--options"><strong>Payment status</strong>{(['processed', 'pending', 'failed'] as const).map((value) => <button type="button" key={value} onClick={() => { setStatus(value); setOpenFilter(null) }} aria-pressed={status === value}>{value[0].toUpperCase() + value.slice(1)}</button>)}<button type="button" className="activity-filter-reset" onClick={() => { setStatus(''); setOpenFilter(null) }}>All statuses</button></div>}</div>
        {hasFilters && <button type="button" className="activity-clear" onClick={clearFilters}>Clear all <X className="h-3 w-3" /></button>}
        <span className="activity-count" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'payment' : 'payments'}</span>
      </div>
    </div>

    <div className="activity-panel">
      {filtered.length === 0 ? <div className="activity-empty"><div className="activity-empty-icon" aria-hidden="true"><span /><Mail /><Mail /><Mail /></div><h2>{payments.length ? 'No payments match these filters.' : 'No payments yet'}</h2><p>{payments.length ? 'Try a wider date range or fewer filters.' : 'When a payment arrives, you can find it here and see how it was split.'}</p>{hasFilters && <button type="button" className="dashboard-secondary-button" onClick={clearFilters}>Clear filters</button>}</div> : <>
        <table className="activity-table"><colgroup><col className="activity-col-reference" /><col className="activity-col-received" /><col className="activity-col-amount" /><col className="activity-col-split" /><col className="activity-col-status" /><col className="activity-col-open" /></colgroup><thead><tr><th scope="col" aria-sort={sortField === 'reference' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined}>{sortHeader('reference', 'Reference')}</th><th scope="col" aria-sort={sortField === 'received' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined}>{sortHeader('received', 'Received')}</th><th scope="col" className="activity-amount-cell" aria-sort={sortField === 'amount' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined}>{sortHeader('amount', 'Amount (MAD)')}</th><th scope="col">Split</th><th scope="col" aria-sort={sortField === 'status' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined}>{sortHeader('status', 'Status')}</th><th scope="col"><span className="sr-only">Open payment</span></th></tr></thead><tbody>{groups.map(([key, items]) => <FragmentRows key={key} label={monthTitle(key)} items={items} onSelect={onSelect} />)}</tbody></table>
        <div className="activity-mobile-list">{groups.map(([key, items]) => <section key={key} className="activity-mobile-group" aria-label={monthTitle(key)}><div className="activity-mobile-month"><strong>{monthTitle(key)}</strong><span>{items.length} {items.length === 1 ? 'payment' : 'payments'} · {money.format(items.reduce((sum, payment) => sum + payment.amount, 0))}</span></div>{items.map((payment) => <button type="button" key={payment.id} className="activity-mobile-row" onClick={() => onSelect(payment)} aria-label={accessiblePaymentLabel(payment)}><span className="activity-mobile-row-top"><strong>{payment.reference}</strong><b>{money.format(payment.amount)}</b></span><span className="activity-mobile-row-bottom"><span>{paymentDate(payment.created_at) || 'Date unavailable'}</span><span className="activity-mobile-split"><PaymentSplitBar payment={payment} /></span><PaymentStatus status={payment.status} /></span></button>)}</section>)}</div>
      </>}
    </div>
  </section>
}

function FragmentRows({ label, items, onSelect }: { label: string; items: DashboardTransaction[]; onSelect: (payment: DashboardTransaction) => void }) {
  return <><tr className="activity-month-row"><th colSpan={3} scope="rowgroup">{label}</th><td colSpan={3}>{items.length} {items.length === 1 ? 'payment' : 'payments'} · {money.format(items.reduce((sum, payment) => sum + payment.amount, 0))}</td></tr>{items.map((payment) => <tr key={payment.id} className="activity-payment-row" onClick={() => onSelect(payment)}><td><button type="button" onClick={(event) => { event.stopPropagation(); onSelect(payment) }} aria-label={`View payment ${accessiblePaymentLabel(payment)}`}>{payment.reference}</button></td><td>{paymentDate(payment.created_at) || '—'}</td><td className="activity-amount-cell">{money.format(payment.amount)}</td><td><PaymentSplitBar payment={payment} /></td><td><PaymentStatus status={payment.status} /></td><td className="activity-open-cell"><ChevronRight className="h-4 w-4" aria-hidden="true" /></td></tr>)}</>
}

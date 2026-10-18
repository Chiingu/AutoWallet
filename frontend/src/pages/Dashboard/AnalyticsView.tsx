import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, BarChart3, ChevronDown, Download, House, Landmark, PiggyBank, RefreshCw, TrendingUp, X } from 'lucide-react'
import type { DashboardData, WalletType } from './dashboardApi'
import { envelopeChartColor as chartColor, envelopeMeta, envelopeTarget, money, walletOrder } from './envelopeDisplay'
import { AnalyticsApiError, analyticsQuery, analyticsRangeError, fetchAnalytics, fetchAnalyticsExport } from '../../api/analyticsApi'
import type { AnalyticsData, AnalyticsFilters, AnalyticsInterval } from '../../api/analyticsApi'

import { ReceivedChart, SplitChart, SplitPie } from './AnalyticsCharts'

type Row = (string | number)[]
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
function periodStart(period: string, today: string) {
  const date = new Date(`${today}T00:00:00Z`)
  if (period === '30') date.setUTCDate(date.getUTCDate() - 29)
  else { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - Number(period) + 1) }
  return date.toISOString().slice(0, 10)
}
function pointLabel(period: string, interval: AnalyticsInterval) {
  if (interval === 'week') return period.replace(/^(\d{4})-W(\d{2})$/, 'W$2 $1')
  return new Intl.DateTimeFormat('en-US', { month: 'short', ...(interval === 'day' ? { day: 'numeric' as const } : { year: '2-digit' as const }), timeZone: 'UTC' }).format(new Date(`${period}${interval === 'month' ? '-01' : ''}T12:00:00Z`))
}

function ChartCard({ title, description, headers, rows, children, unavailable }: { title: string; description: string; headers: string[]; rows: Row[]; children?: ReactNode; unavailable?: string }) {
  const [showData, setShowData] = useState(false)
  return <section className="workspace-card analytics-chart"><h3>{title}</h3><p>{description}</p>{unavailable ? <div className="analytics-chart-unavailable"><BarChart3 size={22} /><p>{unavailable}</p></div> : <><div className="analytics-chart-canvas">{children}</div><button className="analytics-data-toggle" onClick={() => setShowData(value => !value)} aria-expanded={showData}>{showData ? 'Hide data' : 'Show data'}<ChevronDown size={13} /></button>{showData && <div className="analytics-data-table"><table><caption className="sr-only">{title}</caption><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</>}</section>
}

interface Props {
  data: DashboardData; onRecord: () => void; recordDisabled: boolean; onAsk: (question: string) => void
  onRules: () => void; onRefresh: () => Promise<void>; onSessionEnded: () => void
}

export function AnalyticsView({ data, onRecord, recordDisabled, onAsk, onRules, onRefresh, onSessionEnded }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [period, setPeriod] = useState('30')
  const [customStart, setCustomStart] = useState(() => periodStart('30', today))
  const [customEnd, setCustomEnd] = useState(today)
  const [interval, setInterval] = useState<AnalyticsInterval>('day')
  const [envelope, setEnvelope] = useState<WalletType | ''>('')
  const [revision, setRevision] = useState(0)
  const filters = useMemo<AnalyticsFilters>(() => ({ start: period === 'custom' ? customStart : periodStart(period, today), end: period === 'custom' ? customEnd : today, envelope, interval }), [period, today, customStart, customEnd, envelope, interval])
  const key = analyticsQuery(filters, true)
  const invalid = analyticsRangeError(filters)
  const [request, setRequest] = useState<{ key: string; data: AnalyticsData | null; loading: boolean; error: string | null }>({ key: '', data: null, loading: true, error: null })
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null)
  const [exportNotice, setExportNotice] = useState<{ key: string; message: string; error: boolean } | null>(null)
  const exportController = useRef<AbortController | null>(null)
  const exportUrl = useRef<string | null>(null)
  const sessionEnded = useEffectEvent(onSessionEnded)

  useEffect(() => {
    if (invalid) return
    const controller = new AbortController()
    queueMicrotask(async () => {
      if (controller.signal.aborted) return
      setRequest(previous => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: null }))
      try {
        const result = await fetchAnalytics(filters, controller.signal)
        if (!controller.signal.aborted) setRequest({ key, data: result, loading: false, error: null })
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof AnalyticsApiError && reason.status === 401) { sessionEnded(); return }
        setRequest(previous => ({ key, data: previous.key === key ? previous.data : null, loading: false, error: reason instanceof Error ? reason.message : 'Could not load analytics.' }))
      }
    })
    return () => controller.abort()
  }, [filters, key, invalid, revision, data])

  useEffect(() => () => { exportController.current?.abort(); if (exportUrl.current) URL.revokeObjectURL(exportUrl.current) }, [])
  const report = !invalid && request.key === key ? request.data : null
  const error = request.key === key ? request.error : null
  const loading = !invalid && (request.key !== key || request.loading)
  const refresh = async () => { await onRefresh(); setRevision(value => value + 1) }
  const exportReport = async (format: 'csv' | 'pdf') => {
    if (invalid || exportController.current) return
    const controller = new AbortController()
    exportController.current = controller
    setExporting(format); setExportNotice(null)
    try {
      const blob = await fetchAnalyticsExport(filters, format, controller.signal)
      if (controller.signal.aborted) return
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current)
      exportUrl.current = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = exportUrl.current
      link.download = `autowallet-report-${filters.start}-to-${filters.end}${filters.envelope ? `-${filters.envelope}` : ''}.${format}`
      document.body.append(link); link.click(); link.remove()
      setExportNotice({ key, message: `Your ${format.toUpperCase()} report download has started.`, error: false })
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof AnalyticsApiError && reason.status === 401) { onSessionEnded(); return }
      setExportNotice({ key, message: reason instanceof Error ? reason.message : 'Could not download the report.', error: true })
    } finally { exportController.current = null; if (!controller.signal.aborted) setExporting(null) }
  }

  return <div className="workspace-page analytics-page">
    <header className="workspace-heading analytics-heading"><div><h1>Analytics</h1><p>{invalid ? 'Choose a date range to explore your income.' : `${dateLabel(filters.start)} – ${dateLabel(filters.end)}`}{report ? ` · ${report.summary.payments} processed ${report.summary.payments === 1 ? 'payment' : 'payments'}` : ''}</p></div><div className="analytics-actions"><button className="dashboard-secondary-button" disabled={loading} onClick={() => void refresh()} aria-label="Refresh analytics"><RefreshCw size={14} />Refresh</button><button className="dashboard-secondary-button" disabled={Boolean(invalid || exporting)} onClick={() => void exportReport('csv')}><Download size={14} />{exporting === 'csv' ? 'Preparing…' : 'Export CSV'}</button><button className="dashboard-secondary-button" disabled={Boolean(invalid || exporting)} onClick={() => void exportReport('pdf')}><Download size={14} />{exporting === 'pdf' ? 'Preparing…' : 'Export PDF'}</button></div></header>
    <fieldset className="analytics-filters" disabled={Boolean(exporting)}><legend className="sr-only">Analytics filters</legend>
      <label>Period<select aria-label="Analytics period" value={period} onChange={event => { if (event.target.value === 'custom') { setCustomStart(filters.start); setCustomEnd(filters.end) }; setPeriod(event.target.value) }}><option value="30">Last 30 days</option><option value="3">Last 3 calendar months</option><option value="6">Last 6 calendar months</option><option value="12">Last 12 calendar months</option><option value="custom">Custom dates</option></select></label>
      <label>From<input type="date" value={filters.start} max={filters.end || undefined} onChange={event => { setCustomStart(event.target.value); setCustomEnd(filters.end); setPeriod('custom') }} /></label>
      <label>To<input type="date" value={filters.end} min={filters.start || undefined} onChange={event => { setCustomEnd(event.target.value); setCustomStart(filters.start); setPeriod('custom') }} /></label>
      <label>Group by<select aria-label="Analytics interval" value={interval} onChange={event => setInterval(event.target.value as AnalyticsInterval)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
      <label>Envelope<select aria-label="Analytics envelope" value={envelope} onChange={event => setEnvelope(event.target.value as WalletType | '')}><option value="">All envelopes</option>{walletOrder.map(type => <option key={type} value={type}>{envelopeMeta[type].name}</option>)}</select></label>
    </fieldset>
    {invalid && <p className="workspace-field-error" role="alert">{invalid}</p>}
    {exportNotice?.key === key && <p className={exportNotice.error ? 'workspace-field-error' : 'workspace-note'} role={exportNotice.error ? 'alert' : 'status'}>{exportNotice.message}</p>}
    {!invalid && error && <div className="workspace-banner workspace-banner--error" role="alert"><span>{error}{report && ' The last loaded values are shown below.'}</span><button onClick={() => setRevision(value => value + 1)}>Retry analytics</button></div>}
    {loading && <p className="workspace-note" role="status">{report ? 'Updating analytics…' : 'Loading analytics…'}</p>}
    {report && <AnalyticsResults report={report} data={data} filters={filters} onRecord={onRecord} recordDisabled={recordDisabled} onAsk={onAsk} onRules={onRules} onRefresh={() => void refresh()} />}
  </div>
}

function AnalyticsResults({ report: { summary, timeseries }, data, filters, onRecord, recordDisabled, onAsk, onRules, onRefresh }: {
  report: AnalyticsData; data: DashboardData; filters: AnalyticsFilters; onRecord: () => void; recordDisabled: boolean
  onAsk: (question: string) => void; onRules: () => void; onRefresh: () => void
}) {
  const [dismissed, setDismissed] = useState<string[]>([])
  const types = filters.envelope ? [filters.envelope] : walletOrder
  const total = summary.received
  const average = summary.average_payment
  const allocations = summary.by_envelope
  const allocationTotal = types.reduce((sum, type) => sum + (allocations[type] ?? 0), 0)
  const missing = filters.envelope ? 0 : Math.max(0, total - allocationTotal)
  const points = timeseries.points.map(point => ({ ...point, label: pointLabel(point.period, filters.interval) }))
  const running: Partial<Record<WalletType, number>> = {}
  const cumulative = points.map(point => {
    for (const type of types) running[type] = (running[type] ?? 0) + (point.envelopes[type] ?? 0)
    return { ...point, values: { ...running } }
  })
  const maxAllocation = Math.max(1, ...types.map(type => allocations[type] ?? 0))
  const balances = Object.fromEntries(data.wallets.map(wallet => [wallet.wallet_type, wallet.balance]))
  const tax = summary.balances.tax ?? balances.tax ?? 0
  const savings = summary.balances.savings ?? balances.savings ?? 0
  const rent = data.rules.find(rule => rule.is_active && rule.target_wallet === 'rent' && rule.rule_type === 'lock_fixed')?.fixed_amount ?? 0
  const cap = envelopeTarget('savings', data.rules)
  const taxRate = data.rules.find(rule => rule.is_active && rule.target_wallet === 'tax' && rule.rule_type === 'percentage_remainder')?.percentage
  const expectedTax = taxRate === null || taxRate === undefined ? null : total * taxRate / 100
  const coverage = rent > 0 ? savings / rent : null
  const processed = data.transactions.filter(item => item.status === 'processed')
  const payments = processed.filter(item => item.created_at && item.created_at.slice(0, 10) >= filters.start && item.created_at.slice(0, 10) <= filters.end && (!filters.envelope || (item.allocations?.[filters.envelope] ?? 0) > 0))
  const detailed = processed.every(item => Boolean(item.created_at) && (!filters.envelope || item.allocations?.[filters.envelope] !== undefined)) && payments.length === summary.payments && Math.abs(payments.reduce((sum, item) => sum + item.amount, 0) - total) < 0.02
  const detailMissing = 'Dated payment details are needed for this chart. Your period totals and envelope charts are available above.'
  const deviation = detailed && payments.length ? Math.sqrt(payments.reduce((sum, item) => sum + (item.amount - average) ** 2, 0) / payments.length) : 0
  const incomeMax = Math.max(1, ...payments.map(item => item.amount))
  const minimum = payments.length ? Math.min(...payments.map(item => item.amount)) : 0
  const width = Math.max(1, incomeMax - minimum) / 5
  const histogram = Array.from({ length: 5 }, (_, i) => ({ lower: minimum + width * i, upper: minimum + width * (i + 1), count: payments.filter(item => item.amount >= minimum + width * i && (i === 4 ? item.amount <= minimum + width * (i + 1) : item.amount < minimum + width * (i + 1))).length }))
  const maxCount = Math.max(1, ...histogram.map(bin => bin.count))
  const suggestions = [
    { id: 'tax', icon: Landmark, title: 'Compare your Tax reserve', text: expectedTax !== null ? `${money.format(tax)} MAD is reserved. ${taxRate}% of the selected income would be ${money.format(expectedTax)} MAD. This is a comparison, not a tax bill.` : 'Add a Tax rule to compare your reserve with a percentage of income.', question: 'Explain my Tax reserve compared with my current Tax rule and payments.' },
    { id: 'cap', icon: PiggyBank, title: cap ? `${money.format(Math.max(0, cap - savings))} MAD to your Savings cap` : 'Give your Savings a target', text: cap ? `${money.format(savings)} of ${money.format(cap)} MAD is saved. Check the cap before your next payment.` : 'A Savings cap helps you see how close you are to your target.', question: 'Explain how my Savings cap works and what happens when it is reached.' },
    { id: 'rent', icon: House, title: coverage !== null ? `Savings covers ${coverage.toFixed(1)} rent payments` : 'See how much rent Savings covers', text: rent > 0 ? `At your current Rent rule of ${money.format(rent)} MAD, Savings covers ${coverage!.toFixed(1)} payments. This does not include other living costs.` : 'A fixed Rent rule is needed for this comparison.', question: 'Explain how my current Savings compares with my Rent rule.' },
    { id: 'largest', icon: TrendingUp, title: `${money.format(summary.largest_payment)} MAD largest payment`, text: `Your largest processed payment in the selected period. The average across ${summary.payments} payments is ${money.format(average)} MAD.`, question: 'Explain how larger payments affect my envelope allocations.' },
  ]
  if (!summary.payments) return <section className="workspace-empty workspace-card"><BarChart3 size={38} /><h2>No payments in this period</h2><p>{filters.envelope ? 'No processed payments with a saved allocation to this envelope were found. Try another envelope or period.' : 'Try another period, or record a payment to see where your income goes.'}</p><button className="dashboard-primary-button" onClick={onRecord} disabled={recordDisabled}>Record payment</button></section>

  return <>
    {missing > 0.02 && <p className="workspace-note">{money.format(missing)} MAD of this income has no saved split. Allocation charts show only the allocations that were recorded.</p>}
    <div className="analytics-overview"><section className="workspace-card analytics-health"><svg viewBox="0 0 220 130" role="img" aria-label="Health score unavailable"><path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#e7ecf2" strokeWidth="14" strokeLinecap="round" /><text x="110" y="100" textAnchor="middle" fill="#8693a6" fontSize="42">—</text></svg><h2>Not available right now</h2><p>A health score is not available yet. Your payment totals are shown alongside.</p><button className="workspace-text-button" onClick={onRefresh}><RefreshCw size={13} />Refresh data</button></section>
      <div className="analytics-overview-right"><div className="analytics-stats"><section className="workspace-card"><h2>Income in period</h2><strong>{money.format(total)} <small>MAD</small></strong><p>{summary.payments} processed payments</p></section><section className="workspace-card"><h2>Average payment</h2><strong>{money.format(average)} <small>MAD</small></strong><p>Across the selected period</p></section><section className="workspace-card"><h2>Largest payment</h2><strong>{money.format(summary.largest_payment)} <small>MAD</small></strong><p>Across the selected period</p></section></div>
      <section className="workspace-card analytics-income"><h2>Recorded allocations</h2>{allocationTotal > 0 ? <><div className="analytics-stacked-bar" role="img" aria-label="Recorded allocations by envelope">{types.map(type => (allocations[type] ?? 0) > 0 && <span key={type} style={{ width: `${(allocations[type] ?? 0) / allocationTotal * 100}%`, backgroundColor: chartColor(type) }} title={`${envelopeMeta[type].name}: ${money.format(allocations[type] ?? 0)} MAD`} />)}</div><div className="analytics-allocation-list">{types.map(type => <div key={type}><span><i style={{ backgroundColor: chartColor(type) }} />{envelopeMeta[type].name}</span><strong>{money.format(allocations[type] ?? 0)}</strong><small>{((allocations[type] ?? 0) / allocationTotal * 100).toFixed(1)}%</small></div>)}<p className="workspace-note">Shares of recorded allocations.</p></div></> : <p className="analytics-inline-unavailable">No saved allocations in this period.</p>}</section></div>
    </div>
    <header className="workspace-heading analytics-section-heading"><div><h2>Suggestions</h2><p>From your own numbers. Review your rules before making a change.</p></div>{dismissed.length > 0 && <button className="workspace-text-button" onClick={() => setDismissed([])}>Show dismissed</button>}</header>
    <div className="analytics-suggestions">{suggestions.filter(item => !dismissed.includes(item.id)).map(({ id, icon: Icon, title, text, question }) => <article key={id} className="workspace-card analytics-suggestion"><div className="analytics-suggestion-top"><Icon size={19} /><span className="workspace-tag">Local engine</span><button onClick={() => setDismissed(items => [...items, id])} aria-label={`Dismiss ${title}`}><X size={15} /></button></div><h3>{title}</h3><p>{text}</p><div><button className="workspace-text-button" onClick={() => onAsk(question)}>Ask why<ArrowRight size={14} /></button><button className="workspace-text-button" onClick={onRules}>Review rules</button></div></article>)}</div>
    <header className="workspace-heading analytics-section-heading"><div><h2>The details</h2><p>Explore chart values with a pointer or keyboard, or open a data table for all values.</p></div></header>
    <div className="analytics-charts">
      <ChartCard title="Income by envelope" description="Saved allocations in each period." headers={['Period', ...types.map(type => `${envelopeMeta[type].name} (MAD)`)]} rows={points.map(point => [point.label, ...types.map(type => money.format(point.envelopes[type] ?? 0))])}>
        <SplitChart points={points} envelopes={types} />
      </ChartCard>
      <ChartCard title="Income over time" description="Total processed income before splitting, including periods with no payments." headers={['Period', 'Income (MAD)']} rows={points.map(point => [point.label, money.format(point.received)])}>
        <ReceivedChart points={points} />
      </ChartCard>
      <ChartCard title="Allocation shares" description="Shares of saved allocations in the selected period. Income without a recorded split is excluded." headers={['Envelope', 'Allocated (MAD)']} rows={types.map(type => [envelopeMeta[type].name, money.format(allocations[type] ?? 0)])} unavailable={allocationTotal <= 0 ? 'No saved allocations in this period.' : undefined}>
        <SplitPie allocations={allocations} envelopes={types} />
      </ChartCard>
      <ChartCard title="How allocations built up" description="Cumulative recorded allocations within this period, not historical balances." headers={['Period', ...types.map(type => `${envelopeMeta[type].name} (MAD)`)]} rows={cumulative.map(point => [point.label, ...types.map(type => money.format(point.values[type] ?? 0))])}>
        <svg className="analytics-lines" viewBox="0 0 440 180" role="img" aria-label="Cumulative allocations by period">{[35, 80, 125, 170].map(y => <line key={y} x1="12" y1={y} x2="430" y2={y} stroke="#e6ebf1" />)}{types.map(type => { const coords = cumulative.map((point, i) => [12 + i / Math.max(1, cumulative.length - 1) * 418, 170 - (point.values[type] ?? 0) / maxAllocation * 150]); return <g key={type}><polyline points={coords.map(point => point.join(',')).join(' ')} fill="none" stroke={chartColor(type)} strokeWidth="2.5" />{coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={chartColor(type)} tabIndex={0} aria-label={`${envelopeMeta[type].name}, ${cumulative[i].label}: ${money.format(cumulative[i].values[type] ?? 0)} MAD`}><title>{envelopeMeta[type].name}: {money.format(cumulative[i].values[type] ?? 0)} MAD</title></circle>)}</g> })}</svg><ChartLegend types={types} />
      </ChartCard>
      <ChartCard title="Your usual payment size" description="The number of payments in each amount range." headers={['Amount range (MAD)', 'Payments']} rows={histogram.map(bin => [`${money.format(bin.lower)}–${money.format(bin.upper)}`, bin.count])} unavailable={!detailed ? detailMissing : undefined}>
        <div className="analytics-columns analytics-histogram">{histogram.map((bin, i) => <div key={i} className="analytics-column"><div tabIndex={0} className="analytics-column-fill" style={{ height: `${bin.count / maxCount * 100}%`, backgroundColor: '#7280bd' }} title={`${money.format(bin.lower)}–${money.format(bin.upper)} MAD: ${bin.count} payments`} aria-label={`${money.format(bin.lower)} to ${money.format(bin.upper)} MAD: ${bin.count} payments`} /><small>{Math.round(bin.lower).toLocaleString('en-US')}</small></div>)}</div>
      </ChartCard>
      <ChartCard title="How much payments swing" description={detailed ? `Average ${money.format(average)} MAD · standard deviation ${money.format(deviation)} MAD.` : 'Compare individual payments with their average.'} headers={['Reference', 'Amount (MAD)', 'Difference from average (MAD)']} rows={payments.map(item => [item.reference, money.format(item.amount), money.format(item.amount - average)])} unavailable={!detailed ? detailMissing : undefined}>
        <svg viewBox="0 0 440 150" className="analytics-swing" role="img" aria-label="Payment amounts around the average"><rect x={12 + Math.max(0, average - deviation) / incomeMax * 410} y="20" width={(Math.min(incomeMax, average + deviation) - Math.max(0, average - deviation)) / incomeMax * 410} height="90" rx="6" fill="#eff1fa" /><line x1="12" x2="422" y1="110" y2="110" stroke="#dce3eb" /><line x1={12 + average / incomeMax * 410} x2={12 + average / incomeMax * 410} y1="15" y2="115" stroke="#5963b6" strokeDasharray="4 4" />{payments.map((item, i) => <circle key={item.id} cx={12 + item.amount / incomeMax * 410} cy={40 + i % 3 * 25} r="4" fill="#5963b6" tabIndex={0} aria-label={`${item.reference}: ${money.format(item.amount)} MAD`}><title>{item.reference}: {money.format(item.amount)} MAD</title></circle>)}</svg>
      </ChartCard>
      <ChartCard title="Tax reserve vs income reference" description={expectedTax !== null ? `Reference: ${taxRate}% of selected gross income. Your rule applies to the remainder, so these can differ.` : 'An active percentage rule for Tax is needed.'} headers={['Measure', 'Amount (MAD)']} rows={expectedTax !== null ? [['Current Tax balance', money.format(tax)], [`${taxRate}% of selected income`, money.format(expectedTax)]] : []} unavailable={expectedTax === null ? 'No active percentage rule for Tax.' : undefined}>
        <div className="analytics-horizontal-bars">{[['Tax reserve', tax, '#EB6834'], ['Income reference', expectedTax ?? 0, '#aab5c6']].map(([label, value, color]) => <div key={String(label)}><div><span>{label}</span><strong>{money.format(Number(value))} MAD</strong></div><span className="analytics-horizontal-track"><i style={{ width: `${Number(value) / Math.max(1, tax, expectedTax ?? 0) * 100}%`, backgroundColor: String(color) }} /></span></div>)}</div>
      </ChartCard>
      <ChartCard title="How much rent Savings covers" description={coverage !== null ? `${money.format(savings)} MAD in Savings ÷ ${money.format(rent)} MAD per Rent payment.` : 'A fixed Rent rule is needed.'} headers={['Savings (MAD)', 'Rent per payment (MAD)', 'Rent payments covered']} rows={coverage !== null ? [[money.format(savings), money.format(rent), coverage.toFixed(2)]] : []} unavailable={coverage === null ? 'Set a fixed Rent rule to see this comparison.' : undefined}>
        <div className="analytics-coverage"><strong>{coverage?.toFixed(1)} <small>rent payments</small></strong><div>{Array.from({ length: 3 }, (_, i) => <span key={i}><i style={{ width: `${Math.max(0, Math.min(1, (coverage ?? 0) - i)) * 100}%` }} /></span>)}</div><p>Each segment represents one Rent payment. Other living costs are not included.</p></div>
      </ChartCard>
    </div>
  </>
}

function ChartLegend({ types }: { types: WalletType[] }) {
  return <div className="analytics-legend">{types.map(type => <span key={type}><i style={{ backgroundColor: chartColor(type) }} />{envelopeMeta[type].name}</span>)}</div>
}

import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalyticsPoint } from '../../api/analyticsApi'
import type { WalletType } from '../../api/walletTypes'
import { envelopeChartColor, envelopeMeta, money, walletOrder } from './envelopeDisplay'

type ChartPoint = AnalyticsPoint & { label: string }
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const AXIS_TICK = { fontSize: 11, fill: 'var(--aw-muted, #5E6B7E)' }
const GRID_COLOR = 'var(--aw-border, #E7ECF2)'
const TOOLTIP_STYLE = { borderRadius: 10, border: '1px solid var(--aw-border, #DDE3EA)', backgroundColor: 'var(--aw-surface, #fff)', color: 'var(--aw-ink, #1A2330)', fontSize: 13 }
const moneyTooltip = (value: unknown) => `${money.format(Number(value ?? 0))} MAD`

/** The PR's interactive charts share the dashboard's data, colors and accessible tables. */
export function ReceivedChart({ points }: { points: ChartPoint[] }) {
  return <div className="analytics-interactive-chart" role="group" aria-label="Income over time chart">
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_COLOR }} minTickGap={16} />
        <YAxis tickFormatter={value => compactNumber.format(value)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={moneyTooltip} contentStyle={TOOLTIP_STYLE} />
        <Line type="monotone" dataKey="received" name="Received" stroke="#5A64B4" strokeWidth={2.5} dot={points.length <= 40 ? { r: 3 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>
}

/** Envelope order matches onboarding; real buttons also support keyboard toggling. */
export function SplitChart({ points, envelopes }: { points: ChartPoint[]; envelopes: WalletType[] }) {
  const [hidden, setHidden] = useState<ReadonlySet<WalletType>>(new Set())
  const types = walletOrder.filter(type => envelopes.includes(type))
  const data = points.map(point => ({ label: point.label, ...point.envelopes }))
  const toggle = (type: WalletType) => setHidden(current => {
    const next = new Set(current)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    return next
  })

  return <div className="analytics-interactive-chart" role="group" aria-label="Income by envelope chart">
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_COLOR }} minTickGap={16} />
        <YAxis tickFormatter={value => compactNumber.format(value)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={moneyTooltip} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--aw-layer, #F3F6FA)' }} />
        {types.map(type => <Bar key={type} dataKey={type} name={envelopeMeta[type].name} stackId="split" fill={envelopeChartColor(type)} hide={hidden.has(type)} maxBarSize={48} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
    <div className="analytics-legend" role="group" aria-label="Visible envelopes">
      {types.map(type => <button key={type} type="button" aria-pressed={!hidden.has(type)} onClick={() => toggle(type)}><i aria-hidden="true" style={{ backgroundColor: envelopeChartColor(type) }} />{envelopeMeta[type].name}</button>)}
    </div>
  </div>
}

/** Only recorded allocations count toward shares; missing splits are never labeled as another envelope. */
export function SplitPie({ allocations, envelopes }: { allocations: Partial<Record<WalletType, number>>; envelopes: WalletType[] }) {
  const types = walletOrder.filter(type => envelopes.includes(type))
  const data = types.map(type => ({ name: envelopeMeta[type].name, value: allocations[type] ?? 0, fill: envelopeChartColor(type) })).filter(slice => slice.value > 0)
  const total = data.reduce((sum, slice) => sum + slice.value, 0)
  return <div className="analytics-interactive-chart" role="group" aria-label="Shares of recorded allocations chart">
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="var(--aw-surface, #fff)" isAnimationActive={false} />
        <Tooltip formatter={value => `${moneyTooltip(value)} (${total > 0 ? (Number(value ?? 0) / total * 100).toFixed(1) : '0.0'}%)`} contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
    <div className="analytics-legend">{data.map(slice => <span key={slice.name}><i aria-hidden="true" style={{ backgroundColor: slice.fill }} />{slice.name}</span>)}</div>
  </div>
}

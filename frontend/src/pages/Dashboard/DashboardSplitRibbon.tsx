import { Check, House, Landmark, PiggyBank, ShoppingBag } from 'lucide-react'
import type { ComponentType } from 'react'
import type { SplitAmounts } from './dashboardSplit'
import { money } from '../../utils/format'
const branches: { type: 'rent' | 'tax' | 'savings' | 'free'; label: string; color: string; icon: ComponentType<{ className?: string }> }[] = [
  { type: 'rent', label: 'Rent', color: '#2A78D6', icon: House },
  { type: 'tax', label: 'Tax', color: '#EB6834', icon: Landmark },
  { type: 'savings', label: 'Savings', color: '#1BAF7A', icon: PiggyBank },
  { type: 'free', label: 'Free to spend', color: '#EDA100', icon: ShoppingBag },
]
const branchX = [136, 288, 440, 592]
const height = 50
const top = 15
const end = 96
const bend = 13

export function DashboardSplitRibbon({ amount, allocations, reference, preview = false, previewLabel = 'Preview', branchNotes }: {
  amount: number
  allocations: SplitAmounts
  reference?: string
  preview?: boolean
  previewLabel?: string
  branchNotes?: Partial<Record<'rent' | 'tax' | 'savings' | 'free', string>>
}) {
  const remaining = branches.map((_, index) => amount - branches.slice(0, index + 1)
    .reduce((sum, item) => sum + allocations[item.type], 0))
  const remainingHeights = remaining.map((value) => amount > 0 ? Math.max(0, value / amount * height) : 0)
  const outline = [
    `M 48 ${top}`, `H ${branchX[3]}`, `V ${top + remainingHeights[2]}`,
    `H ${branchX[2]}`, `V ${top + remainingHeights[1]}`,
    `H ${branchX[1]}`, `V ${top + remainingHeights[0]}`,
    `H ${branchX[0]}`, `V ${top + height}`, `H 48`,
    `A ${height / 2} ${height / 2} 0 0 1 48 ${top}`, 'Z',
  ].join(' ')

  return (
    <div className="dashboard-ribbon">
      <div className="dashboard-ribbon-amount">
        <strong>{money.format(amount)} <small>MAD</small></strong>
        <span>{preview ? previewLabel : reference}</span>
      </div>
      <div className="dashboard-ribbon-graphic">
        <div className="dashboard-ribbon-remaining">
          {remaining.slice(0, 3).map((value, index) => <span key={index} style={{ left: `${(branchX[index] / 644) * 100}%` }}>{money.format(Math.max(0, value))} left</span>)}
        </div>
        <svg viewBox="0 0 644 108" role="img" aria-label={`${preview ? 'Preview' : 'Payment'} split: ${branches.map((item) => `${item.label} ${money.format(allocations[item.type])} MAD`).join(', ')}, Main ${money.format(allocations.main)} MAD`}>
          {branches.map((branch, index) => {
            const value = allocations[branch.type]
            if (value <= 0 || amount <= 0) return null
            const width = Math.max(0, value / amount * height)
            const x = branchX[index]
            const y = top + remainingHeights[index]
            const outer = bend + width
            const path = [
              `M ${x} ${y}`, `A ${outer} ${outer} 0 0 1 ${x + outer} ${y + outer}`,
              `V ${end}`, `H ${x + bend}`, `V ${y + width + bend}`,
              `A ${bend} ${bend} 0 0 0 ${x} ${y + width}`, 'Z',
            ].join(' ')
            return <path key={branch.type} d={path} fill={branch.color} />
          })}
          <path d={outline} fill="#8A95D2" />
          {branches.map((branch, index) => allocations[branch.type] <= 0 && index === 0
            ? <path key="rent-skipped" d={`M ${branchX[index] + 18} ${top + height} V ${end}`} stroke="#ABB8C9" strokeWidth="1.5" strokeDasharray="3 3" />
            : null)}
        </svg>
        <div className="dashboard-ribbon-labels">
          {branches.map((branch, index) => {
            const Icon = branch.icon
            return <div key={branch.type} style={{ left: `${(branchX[index] / 644) * 100}%` }}>
              <span className="flex items-center gap-1 font-semibold text-[#283447]"><span style={{ color: branch.color }}><Icon className="h-3.5 w-3.5 shrink-0" /></span><span className="truncate">{branch.label}</span></span>
              <strong>{allocations[branch.type] > 0 ? money.format(allocations[branch.type]) : 'Skipped'}</strong>
              {branchNotes?.[branch.type] && <small>{branchNotes[branch.type]}</small>}
            </div>
          })}
        </div>
      </div>
      <div className="dashboard-ribbon-total">
        <span>Leftover → Main</span>
        <strong>{money.format(allocations.main)}</strong>
        <b>= {money.format(amount)} <Check className="h-4 w-4 text-[#19854A]" aria-hidden="true" /></b>
      </div>
    </div>
  )
}

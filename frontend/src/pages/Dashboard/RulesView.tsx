import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, MoreVertical, Pause, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { DashboardData, DashboardRule } from './dashboardApi'
import { previewSplit } from './dashboardSplit'
import { DashboardSplitRibbon } from './DashboardSplitRibbon'
import { envelopeMeta, money, ruleDescription } from './envelopeDisplay'
import { Dialog } from '../../components/common/Dialog'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'
import { isValidRuleValue } from '../../utils/format'
import { apiFetch } from '../../api/request'
import { useRequestSignal } from '../../hooks/useRequestSignal'
import './rules.css'

const previewAmount = 8500
const starterNames = ['Rent lock', 'Tax', 'Savings (capped)'] as const

function previewExplanation(data: DashboardData, allocations: ReturnType<typeof previewSplit>) {
  const rent = data.rules.find((rule) => rule.target_wallet === 'rent')
  const savings = data.rules.find((rule) => rule.target_wallet === 'savings')
  const parts: string[] = []
  if (rent && !rent.is_active) parts.push('Rent is paused')
  else if (rent && allocations.rent === 0 && rent.condition_value !== null) {
    parts.push(`Rent is skipped because it already holds ${money.format(data.wallets.find((wallet) => wallet.wallet_type === 'rent')?.balance ?? 0)}`)
  } else if (allocations.rent > 0) parts.push(`Rent takes ${money.format(allocations.rent)}`)
  if (allocations.tax > 0) parts.push(`Tax takes ${money.format(allocations.tax)}`)
  if (savings && !savings.is_active) parts.push('Savings is paused')
  else if (allocations.savings > 0) parts.push(`Savings takes ${money.format(allocations.savings)}`)
  if (allocations.free > 0) parts.push(`${money.format(allocations.free)} is free to spend`)
  if (allocations.main > 0) parts.push(`${money.format(allocations.main)} goes to Main`)
  return `${parts.join('. ')}.`
}

interface RulesViewProps {
  data: DashboardData
  onSaved: () => Promise<void>
  onSessionEnded: () => void
}

export function RulesView({ data, onSaved, onSessionEnded }: RulesViewProps) {
  const requestSignal = useRequestSignal()
  const MainIcon = envelopeMeta.main.icon
  const rules = [...data.rules].sort((left, right) => left.priority - right.priority)
  const defaultRules = starterNames.map((name) => rules.find((rule) => rule.name === name))
  const canEditStarterRules = defaultRules.every(Boolean)
  const allocations = previewSplit(previewAmount, rules, data.wallets)
  const rentRule = rules.find((rule) => rule.target_wallet === 'rent')
  const savingsRule = rules.find((rule) => rule.target_wallet === 'savings')
  const branchNotes = {
    ...(rentRule && allocations.rent === 0 ? { rent: !rentRule.is_active ? 'Paused by you' : rentRule.condition_value !== null ? `Rent already holds ${money.format(data.wallets.find((wallet) => wallet.wallet_type === 'rent')?.balance ?? 0)}` : 'Skipped' } : {}),
    ...(savingsRule && allocations.savings === 0 && !savingsRule.is_active ? { savings: 'Paused by you' } : {}),
  }
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<DashboardRule | null>(null)
  const [value, setValue] = useState('')
  const [cap, setCap] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const menuRef = useDismissibleLayer(openMenu !== null, () => setOpenMenu(null))

  const openEditor = (rule: DashboardRule) => {
    setOpenMenu(null)
    setValue(String(rule.rule_type === 'lock_fixed' ? rule.fixed_amount ?? 0 : rule.percentage ?? 0))
    setCap(String(rule.condition_value ?? 0))
    setError(null)
    setNotice(null)
    setEditing(rule)
  }

  const saveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || saving || !canEditStarterRules) return
    const number = Number(value)
    const capNumber = Number(cap)
    if (!isValidRuleValue(value, editing.rule_type === 'percentage_remainder' ? 100 : Infinity) ||
        (editing.name === 'Savings (capped)' && !isValidRuleValue(cap))) {
      setError('Enter a valid amount. Percentages must be between 0 and 100.')
      return
    }
    const [rent, tax, savings] = defaultRules
    if (!rent || !tax || !savings) return
    const payload = {
      rent_amount: editing.name === 'Rent lock' ? number : rent.fixed_amount ?? 0,
      tax_percent: editing.name === 'Tax' ? number : tax.percentage ?? 0,
      savings_percent: editing.name === 'Savings (capped)' ? number : savings.percentage ?? 0,
      savings_cap: editing.name === 'Savings (capped)' ? capNumber : savings.condition_value ?? 0,
    }
    const token = localStorage.getItem('autowallet_token')
    if (!token) { onSessionEnded(); return }
    const signal = requestSignal()
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch('/api/rules/onboarding', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      if (response.status === 401) { onSessionEnded(); return }
      if (!response.ok) {
        setError('Could not save this rule. Please try again.')
        return
      }
      setEditing(null)
      setNotice('Rule saved. Future payments use the updated value.')
      await onSaved()
    } catch {
      if (!signal.aborted) setError('The rule update could not be confirmed. Close this editor and refresh Rules before trying again.')
    } finally {
      if (!signal.aborted) setSaving(false)
    }
  }

  return <section className="rules-view" aria-labelledby="rules-heading">
    <div className="rules-heading">
      <div><h1 id="rules-heading">Rules</h1><p>Every payment runs through these rules from top to bottom. What’s left goes to Main.</p></div>
      <button type="button" className="dashboard-primary-button" disabled title="Creating custom rules is coming soon"><Plus className="h-4 w-4" />New rule <span className="dashboard-soon-badge">Soon</span></button>
    </div>

    {notice && <p className="rules-notice" role="status">{notice}</p>}

    {rules.length > 0 ? <section className="rules-preview" aria-labelledby="rules-preview-heading">
      <div className="rules-preview-heading"><h2 id="rules-preview-heading">What an 8,500.00 payment would do today</h2><span>Uses your current balances</span></div>
      <p className="rules-preview-mobile-amount">8,500.00 <span>MAD</span><small>A client pays you</small></p>
      <DashboardSplitRibbon amount={previewAmount} allocations={allocations} preview previewLabel="A client pays you" branchNotes={branchNotes} />
      <p className="rules-preview-explanation">{previewExplanation(data, allocations)}</p>
    </section> : <div className="rules-empty"><div className="rules-empty-pipes" aria-hidden="true"><span /><span /><span /></div><strong>No rules yet</strong><p>Every payment goes to Main until you add one.</p></div>}

    {rules.length > 0 && <div className="rules-list" aria-label="Saved rules">
      {rules.map((rule) => {
        const meta = envelopeMeta[rule.target_wallet]
        const Icon = meta.icon
        const editable = canEditStarterRules && starterNames.some((name) => name === rule.name)
        return <article key={rule.id} className={`rules-card ${rule.is_active ? '' : 'rules-card--paused'}`}>
          <GripVertical className="rules-grip" strokeWidth={1.75} aria-hidden="true" />
          <span className="rules-priority">{rule.priority}</span>
          <span className="rules-envelope-icon" style={{ backgroundColor: meta.tint, color: meta.color }}><Icon className="h-4 w-4" aria-hidden="true" /></span>
          <div className="rules-card-copy"><div className="rules-card-title"><h3>{rule.name}</h3>{!rule.is_active && <span><Pause className="h-3 w-3" aria-hidden="true" />Paused</span>}</div><p>{ruleDescription(rule)}</p></div>
          <div className="rules-card-actions"><label className="rules-switch-label" title="Pausing rules is coming soon"><input type="checkbox" role="switch" checked={rule.is_active} disabled readOnly aria-label={`${rule.name} ${rule.is_active ? 'active' : 'paused'}`} /><span className="rules-switch" aria-hidden="true" /><span>{rule.is_active ? 'Active' : 'Paused'}</span></label>
            <div className="rules-menu-wrap" ref={openMenu === rule.id ? menuRef : undefined}><button type="button" className="rules-menu-trigger" aria-label={`More options for ${rule.name}`} aria-expanded={openMenu === rule.id} onClick={() => setOpenMenu(openMenu === rule.id ? null : rule.id)}><MoreVertical className="h-4 w-4" /></button>
              {openMenu === rule.id && <div className="rules-menu"><button type="button" disabled={!editable} onClick={() => openEditor(rule)}><Pencil className="h-4 w-4" />Edit rule {!editable && <small>Soon</small>}</button><button type="button" disabled><Copy className="h-4 w-4" />Duplicate <small>Soon</small></button><button type="button" disabled><ArrowUp className="h-4 w-4" />Move up <small>Soon</small></button><button type="button" disabled><ArrowDown className="h-4 w-4" />Move down <small>Soon</small></button><button type="button" disabled className="rules-menu-danger"><Trash2 className="h-4 w-4" />Delete rule <small>Soon</small></button></div>}
            </div>
          </div>
        </article>
      })}
    </div>}

    <div className="rules-main"><span className="rules-envelope-icon" style={{ backgroundColor: envelopeMeta.main.tint, color: envelopeMeta.main.color }}><MainIcon className="h-4 w-4" /></span><div><strong>Main</strong><p>Whatever is left after these rules goes to Main. It can’t be moved or turned off.</p></div></div>

    {editing && <Dialog labelledBy="edit-rule-title" onClose={() => setEditing(null)} dismissible={!saving} className="rules-drawer-backdrop" panelClassName="rules-drawer"><div className="rules-drawer-header"><h2 id="edit-rule-title">Edit rule</h2><button type="button" onClick={() => setEditing(null)} disabled={saving} aria-label="Close editor"><X className="h-5 w-5" /></button></div>
        <form onSubmit={(event) => void saveRule(event)} className="rules-drawer-form">
          <label>Rule name<input className="dashboard-input" value={editing.name} readOnly /></label>
          <label>Into envelope<div className="rules-readonly-envelope"><span className="rules-envelope-icon" style={{ backgroundColor: envelopeMeta[editing.target_wallet].tint, color: envelopeMeta[editing.target_wallet].color }}>{(() => { const Icon = envelopeMeta[editing.target_wallet].icon; return <Icon className="h-4 w-4" /> })()}</span>{envelopeMeta[editing.target_wallet].name}</div></label>
          <label>{editing.rule_type === 'lock_fixed' ? 'Fixed amount (MAD)' : "Percentage of what’s left"}<div className="rules-value-row"><input className="dashboard-input" type="number" min="0" max={editing.rule_type === 'lock_fixed' ? undefined : 100} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} required /><span>{editing.rule_type === 'lock_fixed' ? 'MAD' : '%'}</span>{editing.rule_type !== 'lock_fixed' && <input className="rules-range" type="range" min="0" max="100" step="1" value={Number(value) || 0} onChange={(event) => setValue(event.target.value)} aria-label="Percentage" />}</div></label>
          {editing.name === 'Savings (capped)' && <label>Savings cap (MAD)<input className="dashboard-input" type="number" min="0" step="0.01" value={cap} onChange={(event) => setCap(event.target.value)} required /></label>}
          <div className="rules-drawer-active"><span className={`rules-switch ${editing.is_active ? '' : 'rules-switch--off'}`} aria-hidden="true" />Rule is {editing.is_active ? 'active' : 'paused'}</div>
          <p className="rules-drawer-note">You can change this rule’s value here. Its name, envelope, and active state can’t be changed yet. Past payment splits stay as they were.</p>
          {error && <p role="alert" className="rules-form-error">{error}</p>}
          <div className="rules-drawer-footer"><button type="button" className="dashboard-secondary-button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button><button type="submit" className="dashboard-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button></div>
        </form>
    </Dialog>}
  </section>
}

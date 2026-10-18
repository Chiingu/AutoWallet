import { useState } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, MoreHorizontal, Pause, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Dialog } from '../../components/common/Dialog'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'
import type { DashboardData, DashboardRule, RuleDraft, WalletType } from './dashboardApi'
import { DashboardSplitRibbon } from './DashboardSplitRibbon'
import { envelopeMeta, money, ruleDescription } from './envelopeDisplay'
import { previewPayment } from './dashboardSplit'
import './rules.css'

const SAMPLE_AMOUNT = 10_000

const selectableWallets: WalletType[] = ['rent', 'tax', 'savings', 'free', 'main']

interface RulesViewProps {
  data: DashboardData
  busy: boolean
  onCreateRule: (rule: RuleDraft) => Promise<void>
  onUpdateRule?: (ruleId: string, updates: Partial<RuleDraft>) => Promise<void>
  onDeleteRule?: (ruleId: string) => Promise<void>
  onReorderRule?: (ruleId: string, direction: 'up' | 'down') => Promise<void>
}

function previewSubtexts(data: DashboardData) {
  const balances = new Map<WalletType, number>(data.wallets.map((wallet) => [wallet.wallet_type, wallet.balance]))
  const preview = previewPayment(SAMPLE_AMOUNT, data.rules, data.wallets)
  const subtexts: Partial<Record<'rent' | 'tax' | 'savings' | 'free', string>> = {}
  const activeByWallet = new Map<WalletType, DashboardRule>()
  for (const rule of [...data.rules].filter((item) => item.is_active).sort((a, b) => a.priority - b.priority)) {
    if (!activeByWallet.has(rule.target_wallet)) activeByWallet.set(rule.target_wallet, rule)
  }

  for (const type of ['rent', 'tax', 'savings', 'free'] as const) {
    const rule = activeByWallet.get(type)
    const step = preview.steps.find((item) => item.rule.id === rule?.id)
    const balance = balances.get(type) ?? 0
    if (!rule) {
      subtexts[type] = 'No active rule'
    } else if (step?.reason !== null && rule.condition_field === `${type}_balance` && rule.condition_value !== null) {
      subtexts[type] = `${envelopeMeta[type].name} is at ${money.format(balance)}`
    } else if (step?.reason !== null) {
      subtexts[type] = 'Condition not met'
    } else if (rule.rule_type === 'lock_fixed') {
      subtexts[type] = 'Locked first'
    } else if (rule.percentage === 100) {
      subtexts[type] = '100% of remainder'
    } else if (rule.percentage !== null) {
      subtexts[type] = `${rule.percentage}% of ${money.format(step ? step.remaining + step.allocated : SAMPLE_AMOUNT)}`
    }
  }
  return { allocations: preview.allocations, subtexts }
}

function previewExplanation(data: DashboardData, allocations: Record<WalletType, number>) {
  const rentRule = data.rules.find((rule) => rule.is_active && rule.target_wallet === 'rent' && rule.condition_value !== null)
  const rentBalance = data.wallets.find((wallet) => wallet.wallet_type === 'rent')?.balance ?? 0
  if (rentRule && rentRule.condition_value !== null && rentBalance >= rentRule.condition_value && allocations.rent === 0) {
    return `Rent is already at ${money.format(rentBalance)}, so rule 1 is skipped and the full ${money.format(SAMPLE_AMOUNT)} flows to Tax, Savings, and Free to spend.`
  }
  return `Based on your current envelope balances, ${money.format(SAMPLE_AMOUNT)} MAD splits across your active rules in priority order.`
}

export function RulesView({
  data,
  busy,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onReorderRule,
}: RulesViewProps) {
  const [menuRuleId, setMenuRuleId] = useState<string | null>(null)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)

  const [nameInput, setNameInput] = useState('Rent lock')
  const [targetWallet, setTargetWallet] = useState<WalletType>('rent')
  const [ruleType, setRuleType] = useState<'lock_fixed' | 'percentage_remainder'>('lock_fixed')
  const [valueInput, setValueInput] = useState('3500')
  const [hasCap, setHasCap] = useState(true)
  const [capInput, setCapInput] = useState('3500')
  const [isActiveInput, setIsActiveInput] = useState(true)

  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useDismissibleLayer(menuRuleId !== null, () => setMenuRuleId(null))

  const sortedRules = [...data.rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const { allocations, subtexts } = previewSubtexts(data)
  const mainMeta = envelopeMeta.main
  const MainIcon = mainMeta.icon

  const applyDefaultPresetForWallet = (wt: WalletType) => {
    setTargetWallet(wt)
    setFormError(null)
    if (wt === 'rent') {
      setNameInput('Rent lock')
      setRuleType('lock_fixed')
      setValueInput('3500')
      setHasCap(true)
      setCapInput('3500')
    } else if (wt === 'tax') {
      setNameInput('Tax')
      setRuleType('percentage_remainder')
      setValueInput('15')
      setHasCap(false)
      setCapInput('')
    } else if (wt === 'savings') {
      setNameInput('Savings (capped)')
      setRuleType('percentage_remainder')
      setValueInput('15')
      setHasCap(true)
      setCapInput('10000')
    } else if (wt === 'free') {
      setNameInput('Free to spend')
      setRuleType('percentage_remainder')
      setValueInput('100')
      setHasCap(false)
      setCapInput('')
    } else {
      setNameInput('Main reserve')
      setRuleType('percentage_remainder')
      setValueInput('10')
      setHasCap(false)
      setCapInput('')
    }
  }

  const openNewRule = () => {
    const existingTargets = new Set(sortedRules.map((r) => r.target_wallet))
    const firstMissing = selectableWallets.find((wt) => !existingTargets.has(wt)) ?? 'savings'
    setEditingRuleId(null)
    setIsActiveInput(true)
    applyDefaultPresetForWallet(firstMissing)
    setDrawerMode('create')
  }

  const openEditRule = (rule: DashboardRule) => {
    setMenuRuleId(null)
    setEditingRuleId(rule.id)
    setNameInput(rule.name)
    setTargetWallet(rule.target_wallet)
    setRuleType(rule.rule_type === 'lock_fixed' ? 'lock_fixed' : 'percentage_remainder')
    setValueInput(
      String(
        rule.rule_type === 'lock_fixed'
          ? (rule.fixed_amount ?? 0)
          : (rule.percentage ?? 0),
      ),
    )
    const hasCondition = Boolean(rule.condition_field && rule.condition_value !== null)
    setHasCap(hasCondition)
    setCapInput(rule.condition_value !== null ? String(rule.condition_value) : '')
    setIsActiveInput(rule.is_active)
    setFormError(null)
    setDrawerMode('edit')
  }

  const handleDuplicate = async (rule: DashboardRule) => {
    setMenuRuleId(null)
    try {
      await onCreateRule({
        name: `${rule.name} (copy)`,
        rule_type: rule.rule_type === 'lock_fixed' ? 'lock_fixed' : 'percentage_remainder',
        target_wallet: rule.target_wallet,
        priority: sortedRules.length + 1,
        fixed_amount: rule.fixed_amount,
        percentage: rule.percentage,
        condition_field: rule.condition_field,
        condition_operator: rule.condition_operator,
        condition_value: rule.condition_value,
        is_active: rule.is_active,
      })
      setNotice(`Duplicated "${rule.name}".`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not duplicate rule.')
    }
  }

  const handleToggleActive = async (rule: DashboardRule) => {
    if (!onUpdateRule) return
    try {
      await onUpdateRule(rule.id, { is_active: !rule.is_active })
      setNotice(`${rule.name} is now ${!rule.is_active ? 'active' : 'paused'}.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update rule status.')
    }
  }

  const handleMove = async (rule: DashboardRule, direction: 'up' | 'down') => {
    setMenuRuleId(null)
    if (!onReorderRule) return
    try {
      await onReorderRule(rule.id, direction)
      setNotice(`Moved "${rule.name}" ${direction}.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not reorder rule.')
    }
  }

  const handleDelete = async (rule: DashboardRule) => {
    setMenuRuleId(null)
    if (!onDeleteRule) return
    try {
      await onDeleteRule(rule.id)
      setNotice(`Deleted "${rule.name}".`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete rule.')
    }
  }

  const submitRule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = nameInput.trim() || envelopeMeta[targetWallet].name
    const numeric = Number(valueInput)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError('Enter an amount above 0.')
      return
    }
    if (ruleType === 'percentage_remainder' && numeric > 100) {
      setFormError('Enter a percentage between 1 and 100.')
      return
    }
    let conditionValue: number | null = null
    if (hasCap) {
      const parsedCap = Number(capInput)
      if (!Number.isFinite(parsedCap) || parsedCap <= 0) {
        setFormError('Enter a valid balance cap above 0 MAD, or uncheck the balance condition.')
        return
      }
      conditionValue = Math.round(parsedCap * 100) / 100
    }

    const payload: RuleDraft = {
      name: trimmedName,
      rule_type: ruleType,
      target_wallet: targetWallet,
      priority:
        drawerMode === 'edit' && editingRuleId
          ? (sortedRules.find((r) => r.id === editingRuleId)?.priority ?? sortedRules.length + 1)
          : sortedRules.length + 1,
      fixed_amount: ruleType === 'lock_fixed' ? Math.round(numeric * 100) / 100 : null,
      percentage: ruleType === 'percentage_remainder' ? Math.round(numeric * 100) / 100 : null,
      condition_field: hasCap ? `${targetWallet}_balance` : null,
      condition_operator: hasCap ? '<' : null,
      condition_value: conditionValue,
      is_active: isActiveInput,
    }

    setSubmitting(true)
    setFormError(null)
    try {
      if (drawerMode === 'edit' && editingRuleId && onUpdateRule) {
        await onUpdateRule(editingRuleId, payload)
        setNotice(`Updated "${trimmedName}".`)
      } else {
        await onCreateRule(payload)
        setNotice(`Saved "${trimmedName}".`)
      }
      setDrawerMode(null)
      setEditingRuleId(null)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save this rule.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rules-view" aria-labelledby="rules-heading">
      <div className="rules-heading">
        <div>
          <h1 id="rules-heading">Rules</h1>
          <p>Every payment runs through these rules from top to bottom.</p>
        </div>
        <button
          type="button"
          className="dashboard-primary-button"
          onClick={openNewRule}
          disabled={busy}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New rule
        </button>
      </div>

      {notice && (
        <p className="rules-notice" role="status">
          {notice}
        </p>
      )}

      <section className="rules-preview" aria-labelledby="rules-preview-heading">
        <div className="rules-preview-heading">
          <h2 id="rules-preview-heading">How a {money.format(SAMPLE_AMOUNT)} MAD payment splits right now</h2>
          <span>Updates as you edit</span>
        </div>
        <div className="rules-preview-mobile-amount">
          <strong>
            {money.format(SAMPLE_AMOUNT)} <span>MAD</span>
          </strong>
          <small>Sample payment</small>
        </div>
        <DashboardSplitRibbon
          amount={SAMPLE_AMOUNT}
          allocations={allocations}
          preview
          previewLabel="Sample payment"
          branchNotes={subtexts}
        />
        <p className="rules-preview-explanation">{previewExplanation(data, allocations)}</p>
      </section>

      <div className="rules-list" ref={menuRef}>
        {sortedRules.length > 0 ? (
          sortedRules.map((rule, index) => {
            const meta = envelopeMeta[rule.target_wallet]
            const Icon = meta.icon
            const menuOpen = menuRuleId === rule.id
            const isFirst = index === 0
            const isLast = index === sortedRules.length - 1
            return (
              <article key={rule.id} className={`rules-card ${rule.is_active ? '' : 'rules-card--paused'}`}>
                <GripVertical className="rules-grip" aria-hidden="true" />
                <span className="rules-priority">{index + 1}</span>
                <span className="rules-envelope-icon" style={{ backgroundColor: meta.tint, color: meta.color }} aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="rules-card-copy">
                  <div className="rules-card-title">
                    <h3>{rule.name}</h3>
                    {!rule.is_active && (
                      <span>
                        <Pause className="h-2.5 w-2.5" aria-hidden="true" />
                        Paused
                      </span>
                    )}
                  </div>
                  <p>{ruleDescription(rule)}</p>
                </div>

                <div className="rules-card-actions">
                  <label className="rules-switch-label" title={rule.is_active ? 'Pause rule' : 'Activate rule'}>
                    <span>{rule.is_active ? 'Active' : 'Paused'}</span>
                    <input
                      type="checkbox"
                      checked={rule.is_active}
                      disabled={busy || !onUpdateRule}
                      onChange={() => void handleToggleActive(rule)}
                      aria-label={`${rule.name} active`}
                    />
                    <span className="rules-switch" aria-hidden="true" />
                  </label>
                  <div className="rules-menu-wrap">
                    <button
                      type="button"
                      className="rules-menu-trigger"
                      aria-label={`More actions for ${rule.name}`}
                      aria-expanded={menuOpen}
                      onClick={() => setMenuRuleId(menuOpen ? null : rule.id)}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {menuOpen && (
                      <div className="rules-menu" role="menu" aria-label={`${rule.name} actions`}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openEditRule(rule)}
                          disabled={busy}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit rule
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleDuplicate(rule)}
                          disabled={busy}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleMove(rule, 'up')}
                          disabled={busy || isFirst || !onReorderRule}
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          Move up
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleMove(rule, 'down')}
                          disabled={busy || isLast || !onReorderRule}
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          Move down
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="rules-menu-danger"
                          onClick={() => void handleDelete(rule)}
                          disabled={busy || !onDeleteRule}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete rule
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )
          })
        ) : (
          <div className="rules-empty">
            <div className="rules-empty-pipes" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <strong>No rules yet — payments will stay in Main.</strong>
            <p>Add a rule to start splitting payments into your envelopes automatically.</p>
          </div>
        )}

        <div className="rules-main">
          <span className="rules-envelope-icon" style={{ backgroundColor: mainMeta.tint, color: mainMeta.color }} aria-hidden="true">
            <MainIcon className="h-4 w-4" />
          </span>
          <div>
            <strong>Main</strong>
            <p>Anything the rules above don&apos;t take stays in Main. Currently 0% because Free to spend takes 100% of what&apos;s left.</p>
          </div>
        </div>
      </div>

      {drawerMode !== null && (
        <Dialog
          onClose={() => {
            if (!submitting) {
              setDrawerMode(null)
              setEditingRuleId(null)
            }
          }}
          dismissible={!submitting}
          labelledBy="new-rule-title"
          className="rules-drawer-backdrop"
          panelClassName="rules-drawer"
        >
          <div className="rules-drawer-header">
            <h2 id="new-rule-title">{drawerMode === 'edit' ? 'Edit rule' : 'New rule'}</h2>
            <button
              type="button"
              onClick={() => {
                setDrawerMode(null)
                setEditingRuleId(null)
              }}
              disabled={submitting}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={(event) => void submitRule(event)} className="rules-drawer-form" noValidate>
            <label htmlFor="rule-envelope">
              Envelope
              <select
                id="rule-envelope"
                className="dashboard-input"
                value={targetWallet}
                onChange={(event) => {
                  const nextWallet = event.target.value as WalletType
                  if (drawerMode === 'create') {
                    applyDefaultPresetForWallet(nextWallet)
                  } else {
                    setTargetWallet(nextWallet)
                  }
                }}
                disabled={submitting}
              >
                {selectableWallets.map((wt) => (
                  <option key={wt} value={wt}>
                    {envelopeMeta[wt].name}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="rule-name">
              Rule name
              <input
                id="rule-name"
                className="dashboard-input"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder={envelopeMeta[targetWallet].name}
                maxLength={80}
                disabled={submitting}
              />
            </label>

            <label htmlFor="rule-type-select">
              Rule type
              <select
                id="rule-type-select"
                className="dashboard-input"
                value={ruleType}
                onChange={(event) => {
                  const nextType = event.target.value as 'lock_fixed' | 'percentage_remainder'
                  setRuleType(nextType)
                  if (nextType === 'percentage_remainder' && Number(valueInput) > 100) {
                    setValueInput('15')
                  }
                  setFormError(null)
                }}
                disabled={submitting}
              >
                <option value="lock_fixed">Lock a fixed amount (MAD)</option>
                <option value="percentage_remainder">Percentage of what&apos;s left (%)</option>
              </select>
            </label>

            <label htmlFor="rule-value">
              {ruleType === 'lock_fixed' ? 'Amount to lock (MAD)' : "Share of what's left (%)"}
              <div className="rules-value-row">
                <input
                  id="rule-value"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max={ruleType === 'percentage_remainder' ? '100' : undefined}
                  step="0.01"
                  value={valueInput}
                  onChange={(event) => {
                    setValueInput(event.target.value)
                    setFormError(null)
                  }}
                  className="dashboard-input"
                  disabled={submitting}
                />
                <span>{ruleType === 'lock_fixed' ? 'MAD' : '%'}</span>
                {ruleType === 'percentage_remainder' && (
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={Math.min(100, Math.max(1, Number(valueInput) || 1))}
                    onChange={(event) => setValueInput(event.target.value)}
                    aria-label="Share percentage slider"
                    className="rules-range"
                    disabled={submitting}
                  />
                )}
              </div>
            </label>

            <label className="rules-drawer-active">
              <input
                type="checkbox"
                checked={hasCap}
                onChange={(event) => {
                  setHasCap(event.target.checked)
                  if (event.target.checked && !capInput) {
                    setCapInput(targetWallet === 'rent' ? '3500' : '10000')
                  }
                }}
                disabled={submitting}
              />
              <span>Only run while {envelopeMeta[targetWallet].name} balance is below a cap</span>
            </label>

            {hasCap && (
              <label htmlFor="rule-cap-value">
                Balance target / cap (MAD)
                <input
                  id="rule-cap-value"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={capInput}
                  onChange={(event) => {
                    setCapInput(event.target.value)
                    setFormError(null)
                  }}
                  className="dashboard-input"
                  placeholder="10000"
                  disabled={submitting}
                />
              </label>
            )}

            <div className="rules-drawer-active">
              <button
                type="button"
                role="switch"
                aria-checked={isActiveInput}
                className=" inline-flex items-center gap-2"
                onClick={() => setIsActiveInput((prev) => !prev)}
                disabled={submitting}
              >
                <span className={`rules-switch ${isActiveInput ? '' : 'rules-switch--off'}`} aria-hidden="true" />
                <span>{isActiveInput ? 'Active immediately' : 'Start paused'}</span>
              </button>
            </div>

            <p className="rules-drawer-note">
              Rules run from top to bottom on every incoming payment. You can reorder or pause rules anytime.
            </p>

            {formError && (
              <p className="rules-form-error" role="alert">
                {formError}
              </p>
            )}

            <div className="rules-drawer-footer">
              <button
                type="button"
                className="dashboard-secondary-button"
                onClick={() => {
                  setDrawerMode(null)
                  setEditingRuleId(null)
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="dashboard-primary-button" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save rule'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}

import type { DashboardRule, DashboardWallet, WalletType } from './dashboardApi'
import { money } from '../../utils/format'
import { walletTypes } from '../../api/walletTypes'

export type SplitAmounts = Record<WalletType, number>

const comparisonLabels = new Map([
  ['<', 'below'], ['<=', 'at or below'], ['>', 'above'],
  ['>=', 'at or above'], ['==', 'equal to'],
])

export function ruleComparisonLabel(operator: string | null) {
  return comparisonLabels.get(operator ?? '')
}

export interface PreviewStep {
  rule: DashboardRule
  allocated: number
  remaining: number
  reason: string | null
}

export function previewPayment(amount: number, rules: DashboardRule[], wallets: DashboardWallet[]) {
  const allocations = Object.fromEntries(walletTypes.map((type) => [type, 0])) as SplitAmounts
  const steps: PreviewStep[] = []
  if (!Number.isFinite(amount) || amount <= 0) return { allocations, steps }

  const balances = new Map(wallets.map((wallet) => [`${wallet.wallet_type}_balance`, wallet.balance]))
  let remaining = amount
  for (const rule of [...rules].filter((item) => item.is_active).sort((a, b) => a.priority - b.priority)) {
    const skip = (reason: string) => steps.push({ rule, allocated: 0, remaining, reason })
    if (remaining <= 0) { skip('No money remaining'); continue }
    if (rule.condition_field !== null) {
      const balance = balances.get(rule.condition_field)
      const threshold = rule.condition_value
      if (balance === undefined || threshold === null) { skip('Condition data unavailable'); continue }
      const matches = rule.condition_operator === '<' ? balance < threshold
        : rule.condition_operator === '<=' ? balance <= threshold
          : rule.condition_operator === '>' ? balance > threshold
            : rule.condition_operator === '>=' ? balance >= threshold
              : rule.condition_operator === '==' ? balance === threshold : false
      if (!matches) {
        const comparison = ruleComparisonLabel(rule.condition_operator)
        skip(comparison ? `Current ${rule.condition_field.replaceAll('_', ' ')} is ${money.format(balance)}; this rule requires ${comparison} ${money.format(threshold)}.` : 'Balance condition not met')
        continue
      }
    }

    let take = rule.rule_type === 'lock_fixed'
      ? Math.min(rule.fixed_amount ?? 0, remaining)
      : remaining * ((rule.percentage ?? 0) / 100)
    const ownBalanceField = `${rule.target_wallet}_balance`
    if (rule.rule_type === 'percentage_remainder' &&
        rule.condition_field === ownBalanceField &&
        (rule.condition_operator === '<' || rule.condition_operator === '<=') &&
        rule.condition_value !== null) {
      take = Math.min(take, Math.max(0, rule.condition_value - (balances.get(ownBalanceField) ?? 0)))
    }
    const safeTake = Math.max(0, Math.min(remaining, take))
    allocations[rule.target_wallet] += safeTake
    remaining -= safeTake
    steps.push({ rule, allocated: safeTake, remaining, reason: safeTake === 0 ? 'Nothing to allocate' : null })
  }
  allocations.main += Math.max(0, remaining)
  return { allocations, steps }
}

export function previewSplit(amount: number, rules: DashboardRule[], wallets: DashboardWallet[]): SplitAmounts {
  return previewPayment(amount, rules, wallets).allocations
}

import type { ComponentType } from 'react'
import { House, Landmark, PiggyBank, ShoppingBag, Wallet } from 'lucide-react'
import type { DashboardRule, WalletType } from './dashboardApi'
import { money } from '../../utils/format'
import { ruleComparisonLabel } from './dashboardSplit'
export { money } from '../../utils/format'

export const envelopeOrder: WalletType[] = ['rent', 'tax', 'savings', 'main']
export const walletOrder: WalletType[] = ['rent', 'tax', 'savings', 'free', 'main']

export const envelopeMeta: Record<WalletType, {
  name: string
  icon: ComponentType<{ className?: string }>
  color: string
  tint: string
}> = {
  rent: { name: 'Rent', icon: House, color: '#2A78D6', tint: '#EAF2FC' },
  tax: { name: 'Tax', icon: Landmark, color: '#EB6834', tint: '#FDEEE8' },
  savings: { name: 'Savings', icon: PiggyBank, color: '#1BAF7A', tint: '#E3F5EE' },
  free: { name: 'Free to spend', icon: ShoppingBag, color: '#A57400', tint: '#FBF1D7' },
  main: { name: 'Main', icon: Wallet, color: '#526176', tint: '#E9EDF2' },
}

export const envelopeChartColor = (type: WalletType) => type === 'free' ? '#EDA100' : type === 'main' ? '#8A95D2' : envelopeMeta[type].color

export function envelopeTarget(type: WalletType, rules: DashboardRule[]) {
  return rules.find((rule) => rule.is_active && rule.target_wallet === type &&
    rule.condition_field === `${type}_balance` && (rule.condition_operator === '<' || rule.condition_operator === '<=') &&
    rule.condition_value !== null && rule.condition_value > 0)?.condition_value ?? null
}

export function ruleDescription(rule: DashboardRule) {
  const target = envelopeMeta[rule.target_wallet].name
  const allocation = rule.rule_type === 'lock_fixed'
    ? `Lock ${money.format(rule.fixed_amount ?? 0)} MAD into ${target}`
    : `Put ${rule.percentage ?? 0}% of what's left into ${target}`
  if (rule.condition_field === null) return allocation
  const conditionWallet = walletOrder.find(type => rule.condition_field === `${type}_balance`)
  const comparison = ruleComparisonLabel(rule.condition_operator)
  return conditionWallet && rule.condition_value !== null && comparison
    ? `${allocation}, only while ${envelopeMeta[conditionWallet].name} is ${comparison} ${money.format(rule.condition_value)}`
    : `${allocation}, only when its saved condition is met`
}

export function envelopeDescription(type: WalletType, rules: DashboardRule[]): string {
  const rule = rules.find((item) => item.is_active && item.target_wallet === type)
  if (!rule) return type === 'main' ? "Anything the rules don't take" : 'No active rule'
  // The compact starter-rule copy below describes an own-wallet "below"
  // condition. Other conditions need the actual saved comparison and wallet.
  if (rule.condition_field !== null &&
      (rule.condition_field !== `${type}_balance` || rule.condition_operator !== '<' || rule.condition_value === null)) {
    return ruleDescription(rule)
  }
  const previous = rules.filter((item) => item.is_active && item.priority < rule.priority).at(-1)
  const after = previous ? ` after ${envelopeMeta[previous.target_wallet].name}` : ''
  if (rule.rule_type === 'lock_fixed' && rule.fixed_amount !== null) {
    return rule.condition_field === `${type}_balance` && rule.condition_value !== null
      ? `Gets ${money.format(rule.fixed_amount)} first whenever it's below ${money.format(rule.condition_value)}`
      : `Gets ${money.format(rule.fixed_amount)} first`
  }
  if (rule.rule_type === 'percentage_remainder' && rule.percentage !== null) {
    if (rule.condition_field === `${type}_balance` && rule.condition_value !== null) {
      return `${rule.percentage}% of what's left, until ${money.format(rule.condition_value)}`
    }
    return rule.percentage === 100 ? `Everything left${after}` : `${rule.percentage}% of what's left${after}`
  }
  return 'Rule details unavailable'
}

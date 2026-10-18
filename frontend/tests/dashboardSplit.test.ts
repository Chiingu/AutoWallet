import { describe, expect, it } from 'vitest'
import { previewSplit } from '../src/pages/Dashboard/dashboardSplit'
import type { DashboardRule, DashboardWallet } from '../src/pages/Dashboard/dashboardApi'

const rules: DashboardRule[] = [
  { id: 'rent', name: 'Rent lock', rule_type: 'lock_fixed', target_wallet: 'rent', priority: 1, fixed_amount: 3500, percentage: null, condition_field: 'rent_balance', condition_operator: '<', condition_value: 3500, is_active: true },
  { id: 'tax', name: 'Tax', rule_type: 'percentage_remainder', target_wallet: 'tax', priority: 2, fixed_amount: null, percentage: 15, condition_field: null, condition_operator: null, condition_value: null, is_active: true },
  { id: 'savings', name: 'Savings', rule_type: 'percentage_remainder', target_wallet: 'savings', priority: 3, fixed_amount: null, percentage: 15, condition_field: 'savings_balance', condition_operator: '<', condition_value: 10000, is_active: true },
  { id: 'free', name: 'Free to spend', rule_type: 'percentage_remainder', target_wallet: 'free', priority: 4, fixed_amount: null, percentage: 100, condition_field: null, condition_operator: null, condition_value: null, is_active: true },
]

describe('dashboard split preview', () => {
  it('follows the backend rule order for a first payment', () => {
    const wallets: DashboardWallet[] = [
      { id: 'rent-wallet', wallet_type: 'rent', balance: 0 },
      { id: 'savings-wallet', wallet_type: 'savings', balance: 0 },
    ]
    expect(previewSplit(8500, rules, wallets)).toEqual({ main: 0, rent: 3500, tax: 750, savings: 637.5, free: 3612.5 })
  })

  it('skips rent when its target is met', () => {
    const wallets: DashboardWallet[] = [
      { id: 'rent-wallet', wallet_type: 'rent', balance: 3500 },
      { id: 'savings-wallet', wallet_type: 'savings', balance: 5508 },
    ]
    expect(previewSplit(2400, rules, wallets)).toEqual({ main: 0, rent: 0, tax: 360, savings: 306, free: 1734 })
  })

  it('limits savings to the remaining room below its cap', () => {
    const wallets: DashboardWallet[] = [
      { id: 'rent-wallet', wallet_type: 'rent', balance: 3500 },
      { id: 'savings-wallet', wallet_type: 'savings', balance: 9750 },
    ]
    expect(previewSplit(5000, rules, wallets)).toEqual({ main: 0, rent: 0, tax: 750, savings: 250, free: 4000 })
  })
})

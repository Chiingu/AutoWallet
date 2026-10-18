import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from '../src/pages/Dashboard/DashboardPage'

const account = {
  id: 'user-1',
  full_name: 'Maya Idrissi',
  email: 'maya@example.com',
  bank_account_id: 'MA00001234567890',
}

const wallets = [
  { id: 'wallet-rent', wallet_type: 'rent', balance: 3500 },
  { id: 'wallet-tax', wallet_type: 'tax', balance: 750 },
  { id: 'wallet-savings', wallet_type: 'savings', balance: 637.5 },
  { id: 'wallet-free', wallet_type: 'free', balance: 3612.5 },
  { id: 'wallet-main', wallet_type: 'main', balance: 0 },
]

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderDashboard(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/app/envelopes" element={<DashboardPage />} />
        <Route path="/app/envelopes/:walletType" element={<DashboardPage />} />
        <Route path="/app/rules" element={<DashboardPage />} />
        <Route path="/app/activity" element={<DashboardPage />} />
        <Route path="/app/activity/:paymentId" element={<DashboardPage />} />
        <Route path="/session-ended" element={<p>Session ended</p>} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('autowallet_token', 'test-token')
})

afterEach(() => vi.unstubAllGlobals())

describe('DashboardPage', () => {
  it('opens the D2 Envelopes route with live wallet balances and navigates to D3', async () => {
    const user = userEvent.setup()
    const envelopeWallets = [
      { id: 'rent', wallet_type: 'rent', balance: 3500 },
      { id: 'tax', wallet_type: 'tax', balance: 6480 },
      { id: 'savings', wallet_type: 'savings', balance: 5508 },
      { id: 'free', wallet_type: 'free', balance: 31212 },
      { id: 'main', wallet_type: 'main', balance: 0 },
    ]
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, envelopeWallets)
      if (url === '/api/transactions/') return response(200, [])
      if (url === '/api/rules/') return response(200, [
        { id: 'rent-rule', name: 'Rent lock', rule_type: 'lock_fixed', target_wallet: 'rent', priority: 1, fixed_amount: 3500, percentage: null, condition_field: 'rent_balance', condition_operator: '<', condition_value: 3500, is_active: true },
        { id: 'savings-rule', name: 'Savings (capped)', rule_type: 'percentage_remainder', target_wallet: 'savings', priority: 3, fixed_amount: null, percentage: 15, condition_field: 'savings_balance', condition_operator: '<', condition_value: 10000, is_active: true },
      ])
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard('/app/envelopes')

    expect(await screen.findByRole('heading', { name: 'Envelopes' })).toBeInTheDocument()
    expect(screen.getByText('46,700.00')).toBeInTheDocument()
    expect(screen.getByText(/Set aside 15,488.00 · Free to spend 31,212.00/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Balance allocation by envelope' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Savings target progress' })).toHaveAttribute('aria-valuenow', '55')

    await user.click(screen.getByRole('button', { name: 'Open Savings envelope, 5,508.00 MAD' }))
    expect(await screen.findByRole('heading', { name: 'Savings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to Envelopes' }))
    expect(await screen.findByRole('heading', { name: 'Envelopes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move money Soon' })).toBeDisabled()
  })

  it('shows a reconciled D3 Tax history and opens a payment', async () => {
    const user = userEvent.setup()
    const detailWallets = [
      { id: 'rent', wallet_type: 'rent', balance: 3500 },
      { id: 'tax', wallet_type: 'tax', balance: 6480 },
      { id: 'savings', wallet_type: 'savings', balance: 5508 },
      { id: 'free', wallet_type: 'free', balance: 31212 },
      { id: 'main', wallet_type: 'main', balance: 0 },
    ]
    const detailPayments = [
      { id: 'new', reference: 'INV-2026-047', amount: 11700, status: 'processed', created_at: '2026-09-21T12:00:00Z', allocations: { rent: 0, tax: 1980, savings: 1508, free: 8212, main: 0 } },
      { id: 'old', reference: 'INV-2026-031', amount: 35000, status: 'processed', created_at: '2026-09-01T12:00:00Z', allocations: { rent: 3500, tax: 4500, savings: 4000, free: 23000, main: 0 } },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, detailWallets)
      if (url === '/api/transactions/') return response(200, detailPayments)
      if (url === '/api/rules/') return response(200, [
        { id: 'tax-rule', name: 'Tax', rule_type: 'percentage_remainder', target_wallet: 'tax', priority: 2, fixed_amount: null, percentage: 15, condition_field: null, condition_operator: null, condition_value: null, is_active: true },
      ])
      throw new Error(`Unexpected URL: ${url}`)
    }))

    renderDashboard('/app/envelopes/tax')

    expect(await screen.findByRole('heading', { name: 'Tax' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The rule that fills it' })).toBeInTheDocument()
    expect(screen.getByText('13.9%')).toBeInTheDocument()
    const history = screen.getByRole('table', { name: 'Payments that changed the Tax envelope' })
    expect(within(history).getByRole('button', { name: 'View payment INV-2026-047' })).toBeInTheDocument()
    expect(within(history).getByText('+1,980.00')).toBeInTheDocument()
    await user.click(within(history).getByRole('button', { name: 'View payment INV-2026-047' }))
    expect(await screen.findByRole('heading', { name: 'INV-2026-047', level: 1 })).toBeInTheDocument()
  })

  it('shows the D3 Rent target and the payment that filled it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, wallets)
      if (url === '/api/transactions/') return response(200, [
        { id: 'later', reference: 'INV-LATER', amount: 5000, status: 'processed', created_at: '2026-09-21T12:00:00Z', allocations: { rent: 0 } },
        { id: 'first', reference: 'INV-FIRST', amount: 8500, status: 'processed', created_at: '2026-09-01T12:00:00Z', allocations: { rent: 3500 } },
      ])
      if (url === '/api/rules/') return response(200, [
        { id: 'rent-rule', name: 'Rent lock', rule_type: 'lock_fixed', target_wallet: 'rent', priority: 1, fixed_amount: 3500, percentage: null, condition_field: 'rent_balance', condition_operator: '<', condition_value: 3500, is_active: true },
      ])
      throw new Error(`Unexpected URL: ${url}`)
    }))

    renderDashboard('/app/envelopes/rent')

    expect(await screen.findByRole('heading', { name: 'Rent' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Rent target progress' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText(/Target met/)).toBeInTheDocument()
    expect(screen.getByText('Skipped by')).toBeInTheDocument()
    expect(screen.getByText('1 later payment')).toBeInTheDocument()
    const history = screen.getByRole('table', { name: 'Payments that changed the Rent envelope' })
    expect(within(history).getByRole('button', { name: 'View payment INV-FIRST' })).toBeInTheDocument()
    expect(within(history).queryByText('INV-LATER')).not.toBeInTheDocument()
  })

  it('does not invent envelope history when the backend omits allocations', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, wallets)
      if (url === '/api/transactions/') return response(200, [
        { id: 'payment-1', reference: 'INV-NO-SPLIT', amount: 8500, status: 'processed' },
      ])
      if (url === '/api/rules/') return response(200, [])
      throw new Error(`Unexpected URL: ${url}`)
    }))

    renderDashboard('/app/envelopes/rent')

    expect(await screen.findByRole('heading', { name: 'Rent' })).toBeInTheDocument()
    expect(screen.getByText(/backend does not yet provide the per-payment allocations/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('loads and renders actual wallets, payments, and saved rules', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, wallets)
      if (url === '/api/transactions/') return response(200, [
        { id: 'payment-1', reference: 'INV-2026-047', amount: 8500, status: 'processed', created_at: '2026-09-21T12:00:00Z', allocations: { rent: 3500, tax: 750, savings: 637.5, free: 3612.5 } },
      ])
      if (url === '/api/rules/') return response(200, [
        { id: 'rule-1', name: 'Rent lock', rule_type: 'lock_fixed', target_wallet: 'rent', priority: 1, fixed_amount: 3500, percentage: null, condition_field: 'rent_balance', condition_operator: '<', condition_value: 3500, is_active: true },
      ])
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()

    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Maya/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Free to spend' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Set aside' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Last payment split' })).toBeInTheDocument()
    expect(screen.getAllByText('INV-2026-047')).toHaveLength(3)
    expect(screen.getByText('Target met')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Rent target progress' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getAllByRole('img', { name: 'Payment split by envelope' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sep 21').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('navigation', { name: 'Main navigation' }).querySelector('[title="Rules"]') as HTMLElement)
    expect(await screen.findByText('Rent lock')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/wallets/', expect.objectContaining({
      headers: { Authorization: 'Bearer test-token', Accept: 'application/json' },
    }))
  })

  it('clears an expired token and returns to the session-ended route', async () => {
    const fetchMock = vi.fn(async () => response(401, { detail: 'Invalid or expired token' }))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()

    expect(await screen.findByText('Session ended')).toBeInTheDocument()
    expect(localStorage.getItem('autowallet_token')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lets an unlinked account link an ID before loading the dashboard data', async () => {
    const user = userEvent.setup()
    let linked = false
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/auth/me') return response(200, { ...account, bank_account_id: linked ? account.bank_account_id : null })
      if (url === '/api/auth/link-bank-account') {
        expect(options?.method).toBe('POST')
        expect(JSON.parse(String(options?.body))).toEqual({ bank_account_id: '1234567890123' })
        linked = true
        return response(200, account)
      }
      if (url === '/api/wallets/') return response(200, wallets)
      if (url === '/api/transactions/') return response(200, [])
      if (url === '/api/rules/') return response(200, [])
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Link your bank account ID' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/wallets/', expect.anything())
    await user.type(screen.getByRole('textbox', { name: 'Bank account ID' }), '1234567890123')
    await user.click(screen.getByRole('button', { name: 'Link account' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Free to spend' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'No payments yet' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What your next payment will do' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/wallets/', expect.anything())
  })

  it('records a payment through the backend and refreshes the dashboard', async () => {
    const user = userEvent.setup()
    let transactions: unknown[] = []
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, wallets)
      if (url === '/api/rules/') return response(200, [])
      if (url === '/api/transactions/' && options?.method === 'POST') {
        expect(options.headers).toEqual({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' })
        expect(JSON.parse(String(options.body))).toEqual({ reference: 'INV-NEW', amount: 2400 })
        transactions = [{ id: 'payment-new', reference: 'INV-NEW', amount: 2400, status: 'processed' }]
        return response(201, transactions[0])
      }
      if (url === '/api/transactions/') return response(200, transactions)
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'No payments yet' })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Record payment' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Record a payment' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Reference' }), 'INV-NEW')
    await user.type(within(dialog).getByRole('textbox', { name: 'Amount (MAD)' }), '2400')
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Recent payments' })).toBeInTheDocument())
    expect(screen.getAllByText('INV-NEW').length).toBeGreaterThan(0)
    expect(screen.getByText('Your envelope balances have been refreshed.')).toBeInTheDocument()
  })

  it('shows the full payment list in Activity after View all', async () => {
    const payments = Array.from({ length: 6 }, (_, index) => ({
      id: `payment-${index + 1}`,
      reference: `INV-${index + 1}`,
      amount: 1000,
      status: 'processed',
    }))
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return response(200, account)
      if (url === '/api/wallets/') return response(200, wallets)
      if (url === '/api/transactions/') return response(200, payments)
      if (url === '/api/rules/') return response(200, [])
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Recent payments' })).toBeInTheDocument()
    expect(screen.queryByText('INV-6')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /View all/ }))
    expect(screen.getAllByText('INV-6').length).toBeGreaterThan(0)
  })
})

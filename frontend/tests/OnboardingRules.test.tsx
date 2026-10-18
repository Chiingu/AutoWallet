import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSignupCredentials, setSignupCredentials } from '../src/auth/pendingCredentials'
import { OnboardingPage } from '../src/pages/Onboarding/OnboardingPage'

const email = 'maya@example.com'
const password = 'example-password-123'

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderRulesStep() {
  return render(
    <MemoryRouter initialEntries={['/welcome/rules']}>
      <Routes>
        <Route path="/welcome/rules" element={<OnboardingPage />} />
        <Route path="/welcome/try" element={<p>Payment preview</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  setSignupCredentials({ email, password })
  sessionStorage.setItem('autowallet_signup_draft', JSON.stringify({
    email, firstName: 'Maya', lastName: 'Idrissi', bankAccount: 'MA00001234567890',
    registered: true, rentAmount: '4200', taxPercent: '12', savingsPercent: '20', savingsCap: '9000',
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearSignupCredentials()
  sessionStorage.clear()
})

describe('onboarding rules', () => {
  it('signs in and saves the edited rules before showing the payment preview', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/login') return response(200, { access_token: 'new-account-token' })
      if (url === '/api/rules/onboarding') return response(200, [])
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRulesStep()
    await userEvent.click(document.getElementById('onboarding-continue-step4') as HTMLButtonElement)

    expect(await screen.findByText('Payment preview')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/login', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/rules/onboarding', expect.objectContaining({
      method: 'PATCH',
      headers: { Authorization: 'Bearer new-account-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rent_amount: 4200, tax_percent: 12, savings_percent: 20, savings_cap: 9000 }),
    }))
    expect(sessionStorage.getItem('autowallet_signup_draft')).not.toContain(password)
  })

  it('keeps the user on the rules step when the backend cannot save them', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/login') return response(200, { access_token: 'new-account-token' })
      if (url === '/api/rules/onboarding') return response(503, { detail: 'Unavailable' })
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRulesStep()
    await userEvent.click(document.getElementById('onboarding-continue-step4') as HTMLButtonElement)

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not save your rules. Please try again.')
    expect(screen.getByRole('heading', { name: 'Your starter rules' })).toBeInTheDocument()
    await waitFor(() => expect(document.getElementById('onboarding-continue-step4')).not.toBeDisabled())
  })
})

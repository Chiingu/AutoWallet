/**
 * Onboarding input surfaces — the RIB field, the payment amount, the rules gate.
 *
 * What this suite pins:
 *   RIB (Step2Account)       digits are the only legal content of a RIB —
 *                            FINDING #22, now FIXED (shared
 *                            auth/validation.ts + `inputMode="numeric"`;
 *                            the submit gate rejects too). Pinned here as
 *                            plain tests: the field rejects letters, and
 *                            the register payload never carries them.
 *   PAYMENT AMOUNT (Step5)   strict money grammar: digits + thousands
 *                            commas + max 2 decimals. Letters, negatives and
 *                            3-decimal values must disable the simulate
 *                            button. (green pins — already correct today)
 *   RULES GATE (Step 4)      percent fields capped at 100, letters rejected,
 *                            the offending input gets focus. (green pins —
 *                            already correct today)
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { Step2Account } from '../src/pages/Onboarding/steps/Step2Account'
import { Step5TryPayment } from '../src/pages/Onboarding/steps/Step5TryPayment'
import { OnboardingPage } from '../src/pages/Onboarding/OnboardingPage'
import { translations as t } from '../src/i18n'
import {
  clearSignupCredentials,
  setSignupCredentials,
} from '../src/auth/pendingCredentials'

// ---------------------------------------------------------------------------
// Harnesses: the step components are controlled — wrap them in local state so
// typing in the test rerenders exactly like the real onboarding page does.
// ---------------------------------------------------------------------------

function Step2Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <Step2Account bankAccount={value} setBankAccount={setValue} t={t} />
}

function Step5Harness({ initial = '8,500.00' }: { initial?: string }) {
  const [amount, setAmount] = useState(initial)
  return (
    <Step5TryPayment
      simulatedAmount={amount}
      setSimulatedAmount={setAmount}
      rentAmount="3500"
      taxPercent="15"
      savingsPercent="15"
      savingsCap="10000"
      hasSimulated={false}
      isSimulating={false}
      onSimulate={() => {}}
      t={t}
    />
  )
}

const ONBOARDING_ROUTES = [
  '/welcome/about',
  '/welcome/account',
  '/welcome/envelopes',
  '/welcome/rules',
  '/welcome/try',
]

function renderOnboardingAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {ONBOARDING_ROUTES.map((p) => (
          <Route key={p} path={p} element={<OnboardingPage />} />
        ))}
        <Route path="*" element={<div>left-onboarding</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const EMAIL = 'qa-frontend@autowallet.dev'
const PASSWORD = 'SuperSecret1337!'

// ---------------------------------------------------------------------------
// RIB — Step2Account
// ---------------------------------------------------------------------------

describe('PIN: RIB field (Step 2)', () => {
  it('an all-digits RIB passes validation', async () => {
    // SCENARIO: the user TYPES a digits-only account number and leaves the field.
    // EXPECTED: no invalid message — the hint stays visible.
    render(<Step2Harness />)
    const user = userEvent.setup()
    const input = screen.getByLabelText(t.accountNumberLabel)
    await user.type(input, '00100000042')
    await user.tab()
    expect(screen.queryByText(t.bankAccountInvalid)).not.toBeInTheDocument()
  })

  it('a too-short RIB is rejected', async () => {
    // SCENARIO: "12" typed — under the 3-character minimum.
    // EXPECTED: the invalid message (length leg of the validation works).
    render(<Step2Harness />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(t.accountNumberLabel), '12')
    await user.tab()
    expect(screen.getByText(t.bankAccountInvalid)).toBeInTheDocument()
  })

  it('finding #22 (FIXED): a letters-only RIB is never accepted', async () => {
    // SCENARIO: the user TYPES "abcdefghij" into the RIB field (char by
    //           char, so input filtering is exercised too) and leaves it.
    // EXPECTED: the field rejects it — the invalid message shows and/or no
    //           letters remain in the value. Was an it.fails tripwire until
    //           the digits-only validation landed; now a plain pin.
    render(<Step2Harness />)
    const user = userEvent.setup()
    const input = screen.getByLabelText(t.accountNumberLabel) as HTMLInputElement
    await user.type(input, 'abcdefghij')
    await user.tab()
    const rejected =
      screen.queryByText(t.bankAccountInvalid) !== null || !/[a-z]/i.test(input.value)
    expect(rejected).toBe(true)
  })

  it('finding #22 (FIXED): even ONE letter among digits is rejected (no MA-prefix IDs)', async () => {
    // SCENARIO: "MA64000100000042" typed — the simulator-style ID: digits
    //           with a two-letter prefix. PRODUCT RULE (decided by Zakaria):
    //           the RIB is ALL NUMBERS, not a single letter anywhere.
    // EXPECTED: rejected — the message shows or the letters were filtered
    //           out of the value. MA-prefix IDs are not legal input.
    render(<Step2Harness />)
    const user = userEvent.setup()
    const input = screen.getByLabelText(t.accountNumberLabel) as HTMLInputElement
    await user.type(input, 'MA64000100000042')
    await user.tab()
    const rejected =
      screen.queryByText(t.bankAccountInvalid) !== null || !/[a-z]/i.test(input.value)
    expect(rejected).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Payment amount — Step5TryPayment (already correct: strict money grammar)
// ---------------------------------------------------------------------------

describe('PIN: payment amount (Step 5)', () => {
  const simulateButton = () =>
    screen.getByRole('button', { name: t.simulatePaymentButton })

  it('a well-formed amount enables the simulate button', () => {
    // SCENARIO: "8,500.00" — thousands comma + two decimals.
    // EXPECTED: the simulation can run.
    render(<Step5Harness initial="8,500.00" />)
    expect(simulateButton()).toBeEnabled()
  })

  it('letters disable the simulate button', async () => {
    // SCENARIO: "abcdefgh" pasted into the amount.
    // EXPECTED: no simulation with a non-numeric amount.
    render(<Step5Harness />)
    const input = screen.getByLabelText(t.amountInputLabel)
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, 'abcdefgh')
    expect(simulateButton()).toBeDisabled()
  })

  it('a negative amount disables the simulate button', async () => {
    // SCENARIO: "-50" — the payment preview must never go below zero.
    render(<Step5Harness />)
    const input = screen.getByLabelText(t.amountInputLabel)
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, '-50')
    expect(simulateButton()).toBeDisabled()
  })

  it('three decimals disable the simulate button', async () => {
    // SCENARIO: "8500.999" — money has at most two decimals.
    render(<Step5Harness />)
    const input = screen.getByLabelText(t.amountInputLabel)
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, '8500.999')
    expect(simulateButton()).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Rules gate — Step 4 (already correct: capped percentages, focused offender)
// ---------------------------------------------------------------------------

describe('PIN: rules gate (Step 4)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearSignupCredentials()
    setSignupCredentials({ email: EMAIL, password: PASSWORD })
    sessionStorage.setItem(
      'autowallet_signup_draft',
      JSON.stringify({
        email: EMAIL,
        firstName: 'Qa',
        lastName: 'Frontend',
        bankAccount: '00100000042',
        registered: true,
      }),
    )
  })

  it('tax above 100% is blocked, messaged, and focused', async () => {
    // SCENARIO: the user sets the tax rule to 150% and clicks Continue.
    // EXPECTED: the invalid message shows, the flow stays on the rules step,
    //           and the offending input received focus.
    renderOnboardingAt('/welcome/rules')
    const user = userEvent.setup()
    const taxInput = screen.getByLabelText(t.rule2Title)
    await user.clear(taxInput)
    await user.type(taxInput, '150')
    await user.click(screen.getByRole('button', { name: t.continueButton }))

    expect(screen.getByText(t.ruleValueInvalid)).toBeInTheDocument()
    expect(taxInput).toHaveFocus()
  })

  it('letters in a rule value are blocked', async () => {
    // SCENARIO: "abc" typed as the rent lock amount.
    // EXPECTED: blocked with the same invalid message.
    renderOnboardingAt('/welcome/rules')
    const user = userEvent.setup()
    const rentInput = screen.getByLabelText(t.rule1Title)
    await user.clear(rentInput)
    await user.type(rentInput, 'abc')
    await user.click(screen.getByRole('button', { name: t.continueButton }))

    expect(screen.getByText(t.ruleValueInvalid)).toBeInTheDocument()
  })

  it('valid rule values continue to the payment preview', async () => {
    // SCENARIO: the defaults (3500 / 15% / 15% / 10000) are valid. Step 4
    //           now SAVES the rules before the preview (login ->
    //           PATCH /api/rules/onboarding), so the network is stubbed.
    // EXPECTED: Continue crosses both calls and lands on the payment preview.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'qa-token' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    renderOnboardingAt('/welcome/rules')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.continueButton }))

    await waitFor(() => expect(screen.getByLabelText(t.amountInputLabel)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rules/onboarding',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer qa-token' }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Register payload — Step 2 end-to-end: the wire contract.
// Whatever the fix mechanism is (error message OR input filtering), the
// guarantee that matters is on the NETWORK: a letters-containing RIB must
// never reach POST /api/auth/register, and a digits RIB must arrive intact.
// ---------------------------------------------------------------------------

describe('PIN: register payload (Step 2 -> POST /api/auth/register)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearSignupCredentials()
    setSignupCredentials({ email: EMAIL, password: PASSWORD })
    sessionStorage.setItem(
      'autowallet_signup_draft',
      JSON.stringify({
        email: EMAIL,
        firstName: 'Qa',
        lastName: 'Frontend',
        registered: false,
        // no bankAccount: the user types it in this test
      }),
    )
  })

  function stubRegisterFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('finding #22 (FIXED, end-to-end): neither a letters RIB nor an MA-prefix RIB is sent to the API', async () => {
    // SCENARIO: full onboarding at Step 2. For EACH illegal RIB the user can
    //           type, clicking Create account must end in a REJECTION at the
    //           client — an error message on screen — and NEVER a network
    //           call carrying the junk value. Was an it.fails tripwire until
    //           the submit gate learned the digits rule; now a plain pin.
    for (const rib of ['abcdefghij', 'MA64000100000042']) {
      const fetchMock = stubRegisterFetch()
      const { unmount } = renderOnboardingAt('/welcome/account')
      const user = userEvent.setup()

      await user.type(screen.getByLabelText(t.accountNumberLabel), rib)
      // step 2's submit button is "Create account" — it triggers the register call
      await user.click(screen.getByRole('button', { name: t.signupButton }))

      // the app must reach a DECISION point: either it sent something (the
      // bug) or it blocked with a message on screen. Waiting for
      // "one of the two" avoids racing the async handler.
      await waitFor(() => {
        const sent = fetchMock.mock.calls.length > 0
        // the same message renders BOTH on the field and in the page alert —
        // queryAllByText, or the query itself throws on the duplicate.
        const blocked = [t.bankAccountInvalid, t.bankAccountRequired].some(
          (message) => screen.queryAllByText(message).length > 0,
        )
        expect(sent || blocked).toBe(true)
      })

      // the decision must be "blocked" — nothing left the browser.
      expect(fetchMock).not.toHaveBeenCalled()

      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('a digits-only RIB is sent to the register API, exactly as typed', async () => {
    // SCENARIO: full onboarding at Step 2, digits-only RIB typed, Create account.
    // EXPECTED: exactly one POST to /api/auth/register, carrying the RIB
    //           verbatim — the fix must never block legitimate input.
    const fetchMock = stubRegisterFetch()
    renderOnboardingAt('/welcome/account')
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(t.accountNumberLabel), '00100000042')
    await user.click(screen.getByRole('button', { name: t.signupButton }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/register')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.bank_account_id).toBe('00100000042')
    expect(body.email).toBe(EMAIL)
  })
})

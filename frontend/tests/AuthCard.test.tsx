/**
 * AuthCard — the login/signup contract with the backend (Mortada's epoch).
 *
 * What this suite pins (the FRONTEND side of the auth contract):
 *   LOGIN   POST /api/auth/login  {email, password}
 *           -> 200 {access_token}  : token stored in
 *              localStorage["autowallet_token"]
 *           -> 401 "2FA code required" : credentials parked in the
 *              in-memory pending store (auth/pendingCredentials, never
 *              sessionStorage), routed to /login/2fa
 *           -> 401 anything else       : the uniform wrongCredentials message
 *           -> 503                     : serviceUnavailable message
 *           -> empty fields            : no fetch AT ALL
 *   SIGNUP  client-side only: validate email/password/terms -> on success
 *           store the email-only draft in
 *           sessionStorage["autowallet_signup_draft"], keep the password in
 *           the in-memory pending store, and navigate to onboarding —
 *           NO backend call happens here
 *           (the register call happens later, in onboarding Step5).
 *           Unchecked terms are rejected at submit-time with the
 *           termsRequired message (the button stays enabled).
 *
 * fetch is stubbed globally per test: the component's URL, method, headers
 * and body are asserted exactly — this is the contract the vite proxy
 * forwards to the backend.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCard } from '../src/pages/Auth/AuthCard'
import { translations as t } from '../src/i18n'
import {
  clearSignupCredentials,
  clearTwoFactorCredentials,
  getSignupPassword,
  getTwoFactorCredentials,
} from '../src/auth/pendingCredentials'

function renderCard(mode: 'login' | 'signup' = 'login') {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="*" element={<AuthCard mode={mode} t={t} />} />
      </Routes>
    </MemoryRouter>,
  )
}

function fetchReturning(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(screen.getByPlaceholderText(t.emailPlaceholder), email)
  await user.type(screen.getByPlaceholderText(t.passwordPlaceholder), password)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearSignupCredentials()
  clearTwoFactorCredentials()
})
afterEach(() => {
  // (component cleanup lives in tests/setup.ts)
  vi.unstubAllGlobals()
})

describe('PIN: login flow', () => {
  it('PIN: valid credentials -> POST /api/auth/login with exact payload, token stored', async () => {
    // SCENARIO: user logs in with correct credentials; backend answers 200.
    // EXPECTED: fetch called with EXACTLY the URL/method/body the backend
    //           expects, and the token lands in localStorage.
    const user = userEvent.setup()
    const fetchMock = fetchReturning(200, { access_token: 'jwt-token-abc' })
    renderCard('login')
    await fillCredentials(user, 'user@autowallet.dev', 'SuperSecret1337!')
    await user.click(screen.getByRole('button', { name: t.loginButton }))

    await waitFor(() => expect(localStorage.getItem('autowallet_token')).toBe('jwt-token-abc'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@autowallet.dev', password: 'SuperSecret1337!' }),
      }),
    )
  })

  it('PIN: wrong password (401) -> the uniform wrongCredentials message, NO token', async () => {
    // SCENARIO: backend rejects with a plain 401 (any detail).
    // EXPECTED: the uniform error message (anti-enumeration contract),
    //           and no token stored.
    const user = userEvent.setup()
    fetchReturning(401, { detail: 'Invalid credentials' })
    renderCard('login')
    await fillCredentials(user, 'user@autowallet.dev', 'WrongPassword999!')
    await user.click(screen.getByRole('button', { name: t.loginButton }))

    await waitFor(() => expect(screen.getByText(t.wrongCredentials)).toBeInTheDocument())
    expect(localStorage.getItem('autowallet_token')).toBeNull()
  })

  it('PIN: 401 "2FA code required" -> credentials in the in-memory pending store, routed onward', async () => {
    // SCENARIO: the account has 2FA enabled; backend answers the exact
    //           "2FA code required" detail (the backend's own contract).
    // EXPECTED: credentials parked in the in-memory pending store
    //           (auth/pendingCredentials) so the /login/2fa screen can
    //           continue the flow — and NOTHING secret in sessionStorage.
    const user = userEvent.setup()
    fetchReturning(401, { detail: '2FA code required' })
    renderCard('login')
    await fillCredentials(user, 'user@autowallet.dev', 'SuperSecret1337!')
    await user.click(screen.getByRole('button', { name: t.loginButton }))

    await waitFor(() =>
      expect(getTwoFactorCredentials()).toEqual({
        email: 'user@autowallet.dev',
        password: 'SuperSecret1337!',
      }),
    )
    expect(sessionStorage.getItem('autowallet_2fa_pending')).toBeNull()
  })

  it('PIN: backend outage (503) -> serviceUnavailable message', async () => {
    // SCENARIO: backend (or the auth hop) is down; login answers 503.
    // EXPECTED: the service-unavailable message — not a crash, not the
    //           wrong-credentials message (the user must not be blamed
    //           for an outage).
    const user = userEvent.setup()
    fetchReturning(503, { detail: 'x' })
    renderCard('login')
    await fillCredentials(user, 'user@autowallet.dev', 'SuperSecret1337!')
    await user.click(screen.getByRole('button', { name: t.loginButton }))

    await waitFor(() => expect(screen.getByText(t.serviceUnavailable)).toBeInTheDocument())
  })

  it('PIN: empty fields -> submit button DISABLED, fetch NEVER called', async () => {
    // SCENARIO: user has not typed anything and clicks Log in.
    // EXPECTED: the button is DISABLED (line 534: login disabled while
    //           email/password empty) — no message, no network request.
    //           (Asserting the a11y state is the correct test: the
    //           disabled button is WHY no message ever shows here.)
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderCard('login')
    await user.click(screen.getByRole('button', { name: t.loginButton }))

    expect(screen.getByRole('button', { name: t.loginButton })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PIN: signup flow (client-side, no backend call)', () => {
  it('PIN: valid signup -> email-only draft in sessionStorage, password in memory, NO fetch', async () => {
    // SCENARIO: user fills valid email + strong password + accepts terms.
    // EXPECTED: the email-only draft parked for the onboarding flow
    //           ("/welcome/about" next), the password kept in the in-memory
    //           pending store (never in storage), and NO network call —
    //           this card does not register; onboarding Step5 does.
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderCard('signup')
    await fillCredentials(user, 'new.user@autowallet.dev', 'SuperSecret1337!')
    await user.click(screen.getByRole('checkbox')) // agree to terms
    await user.click(screen.getByRole('button', { name: t.signupButton }))

    await waitFor(() =>
      expect(sessionStorage.getItem('autowallet_signup_draft')).toBe(
        JSON.stringify({ email: 'new.user@autowallet.dev' }),
      ),
    )
    expect(getSignupPassword('new.user@autowallet.dev')).toBe('SuperSecret1337!')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PIN: short password (signup) -> submit DISABLED, nothing stored', async () => {
    // SCENARIO: signup with a 5-char password (terms accepted, email ok).
    // EXPECTED: the submit button is DISABLED (line 534: signup disabled
    //           while password < 8) — no draft, no navigation.
    const user = userEvent.setup()
    renderCard('signup')
    await fillCredentials(user, 'new.user@autowallet.dev', 'short')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: t.signupButton }))

    expect(screen.getByRole('button', { name: t.signupButton })).toBeDisabled()
    expect(sessionStorage.getItem('autowallet_signup_draft')).toBeNull()
  })

  it('PIN: terms not accepted -> submit rejected with termsRequired, nothing stored', async () => {
    // SCENARIO: valid fields but the terms checkbox is left unchecked.
    // EXPECTED: submit is rejected at submit-time with the termsRequired
    //           message (the button stays enabled) — no draft, no password
    //           kept, no navigation.
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderCard('signup')
    await fillCredentials(user, 'new.user@autowallet.dev', 'SuperSecret1337!')
    await user.click(screen.getByRole('button', { name: t.signupButton }))

    await waitFor(() => expect(screen.getByText(t.termsRequired)).toBeInTheDocument())
    expect(sessionStorage.getItem('autowallet_signup_draft')).toBeNull()
    expect(getSignupPassword('new.user@autowallet.dev')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

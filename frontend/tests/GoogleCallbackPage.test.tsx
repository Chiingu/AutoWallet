import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleCallbackPage } from '../src/pages/Auth/GoogleCallbackPage'

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderCallback() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/auth/google/callback?code=one-time-code']}>
        <Routes>
          <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
          <Route path="/dashboard" element={<p>Dashboard route</p>} />
          <Route path="/login" element={<p>Login route</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('Google callback', () => {
  it('exchanges a one-time code once and opens the dashboard', async () => {
    const fetchMock = vi.fn(async () => response(200, { access_token: 'app-token' }))
    vi.stubGlobal('fetch', fetchMock)

    renderCallback()

    expect(await screen.findByText('Dashboard route')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/oauth/google/exchange', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'one-time-code' }),
    }))
    expect(localStorage.getItem('autowallet_token')).toBe('app-token')
  })

  it('shows an error when the one-time code has expired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(400, { detail: 'Invalid or expired OAuth exchange code' })))

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in could not be completed.')
    expect(localStorage.getItem('autowallet_token')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Login route')).toBeInTheDocument()
  })
})

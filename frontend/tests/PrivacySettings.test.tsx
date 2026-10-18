import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivacySettings } from '../src/pages/Settings/PrivacySettings'

// GDPR settings flow (export + double-confirm delete) — QA pin.
// These endpoints ARE the account-destruction path: the frontend must keep
// gating it behind an explicit DELETE confirmation plus a 6-digit email code.

const exportBody = {
  profile: { two_factor_enabled: true, signs_in_with: 'password', role: 'user' },
  payments: [{}, {}],
  rules: [{}],
  envelopes: [{}],
}

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    blob: async () => new Blob([JSON.stringify(body)], { type: contentType }),
    json: async () => body,
  }
}

function renderPrivacy(onDeleted = vi.fn()) {
  return render(
    <MemoryRouter>
      <PrivacySettings
        email="maya@example.com"
        online
        onSecurityInfo={vi.fn()}
        onSessionEnded={vi.fn()}
        onDeleted={onDeleted}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('autowallet_token', 'test-token')
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('PrivacySettings — GDPR export', () => {
  it('requests the JSON export and shows what it contains', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/gdpr/export?format=json') return jsonResponse(200, exportBody)
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPrivacy()
    await user.click(screen.getByRole('button', { name: 'Request export' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your export is ready. It includes 2 payments, 1 rules and 1 envelopes.',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/gdpr/export?format=json', expect.objectContaining({}))
  })

  it('refuses an export that is not the promised file type', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {}, 'text/html')))

    renderPrivacy()
    await user.click(screen.getByRole('button', { name: 'Request export' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The service did not return a valid export file.')
  })
})

describe('PrivacySettings — account deletion', () => {
  it('requires the DELETE confirmation before sending any code', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderPrivacy()
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send confirmation code' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('walks the full delete flow: DELETE + code request + 6-digit confirm', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/gdpr/delete-request') return jsonResponse(200, { message: 'code sent' })
      if (url === '/api/gdpr/delete-confirm') {
        expect(String(options?.body)).toContain('123456')
        return jsonResponse(200, { message: 'deleted' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPrivacy(onDeleted)
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    const dialog = screen.getByRole('alertdialog')
    await user.type(within(dialog).getByRole('textbox'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Send confirmation code' }))

    expect(await screen.findByRole('status')).toHaveTextContent('A 6-digit code was sent to maya@example.com.')

    await user.type(screen.getByLabelText('Email confirmation code'), '123456')
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the delete dialog open with an error when the code is wrong', async () => {
    const user = userEvent.setup()
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/gdpr/delete-request') return jsonResponse(200, { message: 'code sent' })
      if (url === '/api/gdpr/delete-confirm') {
        attempts += 1
        return jsonResponse(400, { detail: 'Invalid or expired confirmation code' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }))

    renderPrivacy()
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    const dialog = screen.getByRole('alertdialog')
    await user.type(within(dialog).getByRole('textbox'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Send confirmation code' }))

    await screen.findByLabelText('Email confirmation code')
    await user.type(screen.getByLabelText('Email confirmation code'), '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired confirmation code')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(attempts).toBe(1)
  })
})

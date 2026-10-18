/**
 * LegalPage — the Privacy Policy (/privacy) and Terms of Service (/terms).
 *
 * The subject makes these pages MANDATORY: reachable from the app, with
 * relevant content, never a placeholder (otherwise the project is rejected).
 * This suite pins:
 *   PRIVACY  the key sections exist (what we collect, the AI provider,
 *            how long we keep data, the user's rights) + a "Last updated" date
 *   TERMS    AutoWallet is not a bank, the AI is not financial advice
 *   BOTH     the contact email is a real mailto link, no "prototype" placeholder
 *            note, and each page links to the other one and back to login
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LegalPage } from '../src/pages/Legal/LegalPage'

const CONTACT = 'mohamedamintarza@gmail.com'

function renderPage(document: 'privacy' | 'terms') {
  return render(
    <MemoryRouter>
      <LegalPage document={document} />
    </MemoryRouter>,
  )
}

describe('LegalPage', () => {
  it('privacy: has the sections the subject expects and a Last updated date', () => {
    renderPage('privacy')

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    for (const section of [
      'What we collect',
      'The AI assistant and Google Gemini',
      'How long we keep it',
      'Your rights',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    }
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument()
  })

  it('privacy: tells the user what the AI assistant sends to Google', () => {
    renderPage('privacy')

    expect(screen.getByText(/sends it to Gemini, an AI service run by Google/)).toBeInTheDocument()
    expect(screen.getByText(/We do not send your name, email address, password or bank account ID/)).toBeInTheDocument()
  })

  it('terms: says AutoWallet is not a bank and the AI is not financial advice', () => {
    renderPage('terms')

    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
    expect(screen.getByText(/not a bank/)).toBeInTheDocument()
    expect(screen.getByText(/not financial, tax or legal advice/)).toBeInTheDocument()
  })

  it.each(['privacy', 'terms'] as const)('%s: the contact is a mailto link and nothing is a placeholder', (document) => {
    renderPage(document)

    const links = screen.getAllByRole('link', { name: CONTACT })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', `mailto:${CONTACT}`)
    }
    expect(screen.queryByText(/prototype/i)).not.toBeInTheDocument()
  })

  it('the pages link to each other and back to login', () => {
    renderPage('privacy')
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login')
  })

  it('the terms page links to the privacy policy', () => {
    renderPage('terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  })
})

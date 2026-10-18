export interface SignupDraft {
  email?: string
  firstName?: string
  lastName?: string
  bankAccount?: string
  rentAmount?: string
  taxPercent?: string
  savingsPercent?: string
  savingsCap?: string
  registered?: boolean
  bankAccountError?: string
}

const storageKey = 'autowallet_signup_draft'
const stringFields = ['email', 'firstName', 'lastName', 'bankAccount', 'rentAmount', 'taxPercent', 'savingsPercent', 'savingsCap', 'bankAccountError'] as const

export function parseSignupDraft(value: unknown): SignupDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const draft: SignupDraft = {}
  for (const field of stringFields) {
    if (typeof record[field] === 'string') draft[field] = record[field]
  }
  if (typeof record.registered === 'boolean') draft.registered = record.registered
  return draft
}

export function readSignupDraft(): SignupDraft {
  try { return parseSignupDraft(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')) } catch { return {} }
}

export function writeSignupDraft(draft: SignupDraft) {
  // Allow only known, non-secret fields in browser storage.
  try { sessionStorage.setItem(storageKey, JSON.stringify(parseSignupDraft(draft))) } catch { /* The flow still works in memory. */ }
}

export function clearSignupDraft() {
  try { sessionStorage.removeItem(storageKey) } catch { /* Browser storage may be unavailable. */ }
}

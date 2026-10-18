import { clearSignupDraft, readSignupDraft, writeSignupDraft } from './signupDraft'

interface Credentials {
  email: string
  password: string
}

let signupCredentials: Credentials | null = null
let twoFactorCredentials: Credentials | null = null

export function setSignupCredentials(credentials: Credentials) {
  signupCredentials = credentials
}

export function getSignupPassword(email: string) {
  return signupCredentials?.email === email ? signupCredentials.password : null
}

export function clearSignupCredentials() {
  signupCredentials = null
}

export function setTwoFactorCredentials(credentials: Credentials) {
  twoFactorCredentials = credentials
}

export function getTwoFactorCredentials() {
  return twoFactorCredentials
}

export function clearTwoFactorCredentials() {
  twoFactorCredentials = null
}

// Remove passwords left in session storage by older versions of the frontend.
export function clearStoredPasswords() {
  try {
    sessionStorage.removeItem('autowallet_2fa_pending')
    if (sessionStorage.getItem('autowallet_signup_draft')) writeSignupDraft(readSignupDraft())
  } catch {
    clearSignupDraft()
  }
}

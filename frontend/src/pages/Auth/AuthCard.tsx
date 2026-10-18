import { LegalFooter } from '../../components/common/LegalFooter'
import { PasswordStrength } from '../../components/common/PasswordStrength'
import { useState, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react'
import { GoogleIcon } from '../../components/icons'
import { SessionEndedCard } from './SessionEndedCard'
import { translations } from '../../i18n'
import { writeSignupDraft } from '../../auth/signupDraft'
import { clearGoogleReturnPath, rememberGoogleReturnPath, safeReturnPath } from '../../auth/returnPath'
import { apiFetch } from '../../api/request'
import { apiErrorDetail } from '../../api/errors'
import { useRequestSignal } from '../../hooks/useRequestSignal'
import { isValidEmail } from '../../auth/validation'
import {
  clearSignupCredentials,
  clearTwoFactorCredentials,
  setSignupCredentials,
  setTwoFactorCredentials,
} from '../../auth/pendingCredentials'

interface AuthCardProps {
  mode: 'login' | 'signup'
}

export function AuthCard({
  mode,
}: AuthCardProps) {
  const t = translations
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const statusFromQuery = searchParams.get('google_status')
  const emailFromQuery = searchParams.get('email')
  const reasonFromQuery = searchParams.get('reason')

  // Session ended state per Figma A5 (#115:878)
  const [sessionExpired, setSessionExpired] = useState(reasonFromQuery === 'expired')

  // Google OAuth flow state per Figma A3 (#114:695)
  const [googleStatus, setGoogleStatus] = useState<
    'idle' | 'redirecting' | 'cancelled' | 'existing_password'
  >(
    statusFromQuery === 'cancelled'
      ? 'cancelled'
      : statusFromQuery === 'existing_password'
      ? 'existing_password'
      : statusFromQuery === 'redirecting'
      ? 'redirecting'
      : 'idle'
  )

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  // Form States
  const [email, setEmail] = useState(emailFromQuery || '')
  const [password, setPassword] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const requestSignal = useRequestSignal()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [termsError, setTermsError] = useState(false)

  // Adjust state during render if query params change
  const [prevQueryStatus, setPrevQueryStatus] = useState(statusFromQuery)
  if (statusFromQuery !== prevQueryStatus) {
    setPrevQueryStatus(statusFromQuery)
    if (statusFromQuery === 'cancelled') setGoogleStatus('cancelled')
    else if (statusFromQuery === 'existing_password') setGoogleStatus('existing_password')
    else if (statusFromQuery === 'redirecting') setGoogleStatus('redirecting')
    else if (!statusFromQuery) setGoogleStatus('idle')
  }

  const [prevQueryEmail, setPrevQueryEmail] = useState(emailFromQuery)
  if (emailFromQuery !== prevQueryEmail) {
    setPrevQueryEmail(emailFromQuery)
    if (emailFromQuery) setEmail(emailFromQuery)
  }

  const [prevReasonQuery, setPrevReasonQuery] = useState(reasonFromQuery)
  if (reasonFromQuery !== prevReasonQuery) {
    setPrevReasonQuery(reasonFromQuery)
    setSessionExpired(reasonFromQuery === 'expired')
  }

  // Auto-focus relevant field according to query status
  useEffect(() => {
    if (statusFromQuery === 'existing_password') {
      passwordInputRef.current?.focus()
    } else if (statusFromQuery === 'cancelled') {
      emailInputRef.current?.focus()
    }
  }, [statusFromQuery])

  // Cleanup redirect timer on unmount
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (mode === 'login') {
      clearSignupCredentials()
      clearTwoFactorCredentials()
    }
  }, [mode])

  const validateEmail = (val: string): string | null => {
    const trimmed = val.trim()
    if (!trimmed) return t.emailRequired
    if (!isValidEmail(trimmed)) return t.emailInvalid
    return null
  }

  const validatePassword = (val: string): string | null => {
    if (mode === 'signup' && val.length < 8) return t.pwTooShort
    return null
  }

  // Handle Form Submission
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setErrorMessage(null)

    if (mode === 'signup') {
      const errEmail = validateEmail(email)
      const errPassword = validatePassword(password)
      const errTerms = !agreeTerms

      setEmailError(errEmail)
      setPasswordError(errPassword)
      setTermsError(errTerms)

      if (errEmail || errPassword || errTerms) {
        if (errEmail) {
          setErrorMessage(errEmail)
        } else if (errPassword) {
          setErrorMessage(t.pwRequirement)
        } else if (errTerms) {
          setErrorMessage(t.termsRequired)
        }
        return
      }

      // Keep the password in memory while non-secret draft details survive route changes.
      const draft = { email: email.trim() }
      setSignupCredentials({ ...draft, password })
      writeSignupDraft(draft)
      navigate('/welcome/about', { state: draft })
      return
    }

    if (!email.trim() || !password) {
      setErrorMessage(t.wrongCredentials)
      return
    }

    const signal = requestSignal()
    setLoading(true)

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        signal,
      })

      if (res.ok) {
        const data = await res.json()
        if (typeof data.access_token !== 'string') throw new Error('Missing access token')
        localStorage.setItem('autowallet_token', data.access_token)
        navigate(safeReturnPath(searchParams.get('redirect') || searchParams.get('return_to')))
      } else if (res.status === 401) {
        const errData = await res.json().catch(() => ({}))
        if (apiErrorDetail(errData, '').message === '2FA code required') {
          setTwoFactorCredentials({ email: email.trim(), password })
          navigate(`/login/2fa?redirect=${encodeURIComponent(safeReturnPath(searchParams.get('redirect') || searchParams.get('return_to')))}`)
          return
        } else {
          setErrorMessage(t.wrongCredentials)
        }
      } else if (res.status === 503) {
        setErrorMessage(t.serviceUnavailable)
      } else {
        setErrorMessage(t.wrongCredentials)
      }
    } catch {
      if (!signal.aborted) setErrorMessage(t.serviceUnavailable)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  // Handle Google OAuth per Figma A3 (#114:695)
  const handleGoogleLogin = () => {
    setErrorMessage(null)
    setGoogleStatus('redirecting')
    const newParams = new URLSearchParams(searchParams)
    newParams.set('google_status', 'redirecting')
    setSearchParams(newParams, { replace: true })

    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current)
    }

    // Give user brief moment to see the Figma Opening Google state, then redirect
    redirectTimerRef.current = setTimeout(() => {
      rememberGoogleReturnPath(searchParams.get('redirect') || searchParams.get('return_to'))
      window.location.href = '/api/auth/oauth/google/login'
    }, 1800)
  }

  // Handle Cancel from Google Redirecting Card (Figma #114:696 -> #114:734)
  const handleCancelGoogle = () => {
    clearGoogleReturnPath()
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
    }
    setGoogleStatus('cancelled')
    const newParams = new URLSearchParams(searchParams)
    newParams.set('google_status', 'cancelled')
    setSearchParams(newParams, { replace: true })
    setTimeout(() => {
      emailInputRef.current?.focus()
    }, 100)
  }

  // Figma A5 #115:879 & #115:914: Auth / Session ended / Default
  if (sessionExpired) {
    return (
      <SessionEndedCard
        onLogInAgain={() => {
          setSessionExpired(false)
          const newParams = new URLSearchParams(searchParams)
          newParams.delete('reason')
          setSearchParams(newParams, { replace: true })
          setTimeout(() => {
            emailInputRef.current?.focus()
          }, 100)
        }}
      />
    )
  }

  // Figma #114:696: Auth / Google / Redirecting / Desktop
  if (googleStatus === 'redirecting') {
    return (
      <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10 animate-in fade-in duration-200">
        {/* 440px Centered White Card per Figma #114:696 */}
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-8 sm:p-10 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] text-center flex flex-col items-center"
        >
          {/* Animated Spinner (28-32px, #5A64B4) */}
          <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center mb-5">
            <Loader2 className="w-6 h-6 text-[#5A64B4] animate-spin" />
          </div>

          {/* Title: Opening Google… */}
          <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight mb-2">
            {t.googleOpeningTitle}
          </h1>

          {/* Subtitle */}
          <p className="text-[15px] text-[#5E6B7E] leading-relaxed max-w-[340px]">
            {t.googleOpeningSubtitle}
          </p>

          {/* Ghost Cancel Button */}
          <button
            type="button"
            onClick={handleCancelGoogle}
            className="mt-7 px-5 py-2.5 rounded-[10px] text-sm font-medium text-[#3B495D] hover:text-[#1A2330] hover:bg-[#F3F6FA] active:bg-[#EDF0F4] transition cursor-pointer"
          >
            {t.googleCancel}
          </button>
        </div>

        {/* Legal Footer */}
        <LegalFooter t={t} />
      </main>
    )
  }

  return (
    <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10">
      {/* 440px Centered White Card per Figma layout_bd7b430b */}
      <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] transition-all">
        {/* Card Heading */}
        <div className="mb-5 space-y-1">
          <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
            {mode === 'login' ? t.loginTitle : t.signupTitle}
          </h1>
          <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
            {mode === 'login' ? t.loginSubtitle : t.signupSubtitle}
          </p>
        </div>

        {/* Figma A3: Cancelled Alert Banner (#114:734 & Mobile #114:896) */}
        {googleStatus === 'cancelled' && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] text-[#9A3412] text-sm flex items-start gap-3 animate-in fade-in"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 text-[#EB6834] mt-0.5" />
            <div className="flex-1 leading-snug">
              {t.googleCancelledAlert}
            </div>
            <button
              type="button"
              onClick={() => {
                setGoogleStatus('idle')
                const newParams = new URLSearchParams(searchParams)
                newParams.delete('google_status')
                setSearchParams(newParams, { replace: true })
              }}
              className="text-[#9A3412]/60 hover:text-[#9A3412] p-0.5 text-xs font-semibold cursor-pointer"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Figma A3: Existing Password Alert Banner (#114:815) */}
        {googleStatus === 'existing_password' && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#ECEEFA] border border-[#D0D6F5] text-[#3B495D] text-sm flex items-start gap-3 animate-in fade-in"
          >
            <Info className="w-5 h-5 shrink-0 text-[#5A64B4] mt-0.5" />
            <div className="flex-1 leading-snug">
              {t.googleExistingPasswordAlert}
            </div>
            <button
              type="button"
              onClick={() => {
                setGoogleStatus('idle')
                const newParams = new URLSearchParams(searchParams)
                newParams.delete('google_status')
                setSearchParams(newParams, { replace: true })
              }}
              className="text-[#3B495D]/60 hover:text-[#3B495D] p-0.5 text-xs font-semibold cursor-pointer"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error / Feedback Alert Banner (Figma Alert component: EL-bf9e5c13) */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#FFF5F5] border border-[#FFD2D2] text-[#C62F31] text-sm flex items-start gap-3 animate-in fade-in"
          >
            <AlertCircle className="w-5 h-5 shrink-0 text-[#C62F31] mt-0.5" />
            <div className="flex-1 leading-snug">{errorMessage}</div>
          </div>
        )}

        {/* Main Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Field */}
          <div className="space-y-1.5">
            <label htmlFor="email-input" className="block text-sm font-medium text-[#1A2330]">
              {t.emailLabel}
            </label>
            <input
              id="email-input"
              ref={emailInputRef}
              type="email"
              autoComplete="email"
              required
              autoFocus={!statusFromQuery}
              value={email}
              onBlur={() => {
                if (mode === 'signup') {
                  setEmailError(validateEmail(email))
                }
              }}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) {
                  setEmailError(validateEmail(e.target.value))
                }
                if (googleStatus !== 'idle') {
                  setGoogleStatus('idle')
                }
              }}
              placeholder={t.emailPlaceholder}
              className={`w-full h-11 px-3.5 rounded-[10px] border bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none transition ${
                emailError
                  ? 'border-[#FFD2D2] focus:border-[#C62F31] focus:ring-2 focus:ring-[#C62F31]/20'
                  : 'border-[#DDE3EA] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
              }`}
            />
            {emailError && (
              <p className="text-xs text-[#C62F31] flex items-center gap-1.5 mt-1 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{emailError}</span>
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password-input" className="block text-sm font-medium text-[#1A2330]">
                {t.passwordLabel}
              </label>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="text-xs font-medium text-[#5A64B4] hover:text-[#4A53A0] hover:underline cursor-pointer"
                >
                  {t.forgotPassword}
                </button>
              )}
            </div>

            <div className="relative">
              <input
                id="password-input"
                ref={passwordInputRef}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onBlur={() => {
                  if (mode === 'signup') {
                    setPasswordError(validatePassword(password))
                  }
                }}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (passwordError) {
                    setPasswordError(validatePassword(e.target.value))
                  }
                  if (googleStatus !== 'idle') {
                    setGoogleStatus('idle')
                  }
                }}
                placeholder={t.passwordPlaceholder}
                className={`w-full h-11 pl-3.5 pr-10 rounded-[10px] border bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none transition ${
                  passwordError
                    ? 'border-[#FFD2D2] focus:border-[#C62F31] focus:ring-2 focus:ring-[#C62F31]/20'
                    : 'border-[#DDE3EA] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5E6B7E] hover:text-[#1A2330] p-1 cursor-pointer transition"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passwordError && (
              <p className="text-xs text-[#C62F31] flex items-center gap-1.5 mt-1 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{passwordError}</span>
              </p>
            )}

            {/* Password Strength Meter & Requirement (Figma A2 Signup) */}
            {mode === 'signup' && (
              <PasswordStrength password={password} t={t} />
            )}
          </div>

          {/* Terms Checkbox (Figma A2 component EL-d12cf65d) */}
          {mode === 'signup' && (
            <div className="pt-1">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="terms-checkbox"
                  checked={agreeTerms}
                  onChange={(e) => {
                    setAgreeTerms(e.target.checked)
                    if (termsError && e.target.checked) setTermsError(false)
                  }}
                  className={`mt-1 w-4 h-4 rounded text-[#5A64B4] focus:ring-[#5A64B4] cursor-pointer ${
                    termsError ? 'border-[#C62F31] ring-1 ring-[#C62F31]' : 'border-[#DDE3EA]'
                  }`}
                />
                <span className="text-xs text-[#3B495D] leading-snug">
                  I have read the{' '}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Terms (opens in a new tab)"
                    onClick={(event) => event.stopPropagation()}
                    className="underline text-[#5A64B4] hover:text-[#4A53A0]"
                  >
                    Terms
                  </a>{' '}
                  and{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Privacy (opens in a new tab)"
                    onClick={(event) => event.stopPropagation()}
                    className="underline text-[#5A64B4] hover:text-[#4A53A0]"
                  >
                    Privacy
                  </a>
                  {' '}pages.
                </span>
              </label>
            </div>
          )}

          {/* Submit Button (Figma Button: Primary 44px, radius 10px, #5A64B4) */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={
                loading ||
                (mode === 'signup' && (password.length < 8 || !email.trim())) ||
                (mode === 'login' && (!email.trim() || !password))
              }
              className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{mode === 'login' ? t.loggingIn : t.signingUp}</span>
                </>
              ) : mode === 'login' ? (
                t.loginButton
              ) : (
                t.signupButton
              )}
            </button>
          </div>

          {/* Divider: or */}
          <div className="relative py-2 flex items-center justify-center">
            <div className="w-full border-t border-[#DDE3EA]" />
            <span className="absolute bg-white px-3 text-xs text-[#5E6B7E]">{t.or}</span>
          </div>

          {/* Social Google Login Button (Figma Button EL-6c8defc7) */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full h-11 sm:h-12 px-4 rounded-[10px] border border-[#DDE3EA] bg-white hover:bg-[#F3F6FA] active:bg-[#EDF0F4] text-[#1A2330] font-medium text-sm transition flex items-center justify-center gap-2.5 cursor-pointer shadow-2xs"
          >
            <GoogleIcon className="w-4.5 h-4.5 shrink-0" />
            <span>{t.googleButton}</span>
          </button>
        </form>

        {/* Switch Mode Prompt (Figma frame EL-6b7e32fb) */}
        <div className="mt-6 text-center text-sm text-[#3B495D] flex items-center justify-center gap-1.5">
          <span>{mode === 'login' ? t.newToAutoWallet : t.alreadyHaveAccount}</span>
          <button
            type="button"
            onClick={() => {
              setErrorMessage(null)
              navigate(mode === 'login' ? '/signup' : '/login')
            }}
            className="font-semibold text-[#5A64B4] hover:text-[#4A53A0] hover:underline cursor-pointer"
          >
            {mode === 'login' ? t.signUpLink : t.logInLink}
          </button>
        </div>
      </div>

      {/* Legal Footer (Figma frame EL-0b7a78e5) */}
      <LegalFooter t={t} />
    </main>
  )
}

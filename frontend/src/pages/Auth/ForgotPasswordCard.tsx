import { useCountdown } from '../../hooks/useCountdown'
import { LegalFooter } from '../../components/common/LegalFooter'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, MailCheck, ArrowLeft, Loader2 } from 'lucide-react'
import { translations } from '../../i18n'
import { isValidEmail } from '../../auth/validation'
import { apiFetch } from '../../api/request'
import { useRequestSignal } from '../../hooks/useRequestSignal'

export function ForgotPasswordCard() {
  const t = translations
  const navigate = useNavigate()
  const requestSignal = useRequestSignal()

  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [emailTouched, setEmailTouched] = useState(false)
  const { countdown, startCountdown } = useCountdown()

  const sendResetLink = async () => {
    if (loading) return
    setEmailTouched(true)
    if (!isValidEmail(email)) return

    const signal = requestSignal()
    setLoading(true)
    setErrorMessage(null)
    try {
      const response = await apiFetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
        signal,
      })
      if (response.status === 404) {
        setErrorMessage(t.passwordRecoveryUnavailable)
        return
      }
      if (!response.ok) throw new Error('Reset request failed')
      setSubmitted(true)
      startCountdown(60)
    } catch {
      if (!signal.aborted) setErrorMessage(t.serviceUnavailable)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void sendResetLink()
  }

  const handleResend = () => {
    if (countdown === 0) void sendResetLink()
  }

  return (
    <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10 animate-in fade-in duration-200">
      {/* 440px Centered Card per Figma #116:816 & #116:868 */}
      <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] transition-all">
        {errorMessage && <p role="alert" className="mb-4 text-sm text-[#C62F31]">{errorMessage}</p>}
        {submitted ? (
          /* Screen 2: Link sent / Check your inbox (#116:868) */
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center text-[#5A64B4]">
              <MailCheck className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
                {t.checkInboxTitle}
              </h1>
              <p className="text-[15px] text-[#5E6B7E] leading-relaxed max-w-[340px]">
                {t.resetLinkSentSubtitle.replace('{email}', email)}
              </p>
            </div>

            {/* Resend button with 60s cooldown per Note #116:904 */}
            <div className="w-full pt-2">
              <button
                type="button"
                onClick={handleResend}
                disabled={countdown > 0}
                className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#EDF0F4] hover:bg-[#E2E7ED] disabled:opacity-60 disabled:hover:bg-[#EDF0F4] text-[#1A2330] font-medium text-sm transition cursor-pointer"
              >
                {countdown > 0
                  ? `${t.sendLinkAgainIn} (${countdown}s)`
                  : t.sendLinkAgain}
              </button>
            </div>


            {/* Back to log in link */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#4A53A0] hover:text-[#3B495D] hover:underline cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t.backToLogIn}</span>
              </button>
            </div>
          </div>
        ) : (
          /* Screen 1: Reset your password form (#116:816 & #116:1037) */
          <div>
            <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center mb-5 text-[#5A64B4]">
              <KeyRound className="w-6 h-6" />
            </div>

            <div className="mb-6 space-y-1">
              <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
                {t.forgotPasswordTitle}
              </h1>
              <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
                {t.forgotPasswordSubtitle}
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-email" className="block text-sm font-medium text-[#1A2330]">
                  {t.emailLabel}
                </label>
                <input
                  id="reset-email"
                  type="email" autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  aria-invalid={emailTouched && !isValidEmail(email)}
                  aria-describedby={emailTouched && !isValidEmail(email) ? 'reset-email-error' : undefined}
                  placeholder="name@example.com"
                  className="w-full h-11 px-3.5 rounded-[10px] border border-[#DDE3EA] bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20 transition"
                />
                {emailTouched && !isValidEmail(email) && <p id="reset-email-error" role="alert" className="text-xs text-[#C62F31]">{email.trim() ? t.emailInvalid : t.emailRequired}</p>}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending…</span>
                    </>
                  ) : (
                    t.sendResetLink
                  )}
                </button>
              </div>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#4A53A0] hover:text-[#3B495D] hover:underline cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t.backToLogIn}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legal Footer */}
      <LegalFooter t={t} />
    </main>
  )
}

import { LegalFooter } from '../../components/common/LegalFooter'
import { PasswordStrength } from '../../components/common/PasswordStrength'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  LockKeyhole,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react'
import { translations } from '../../i18n'
import { apiFetch } from '../../api/request'
import { useRequestSignal } from '../../hooks/useRequestSignal'

export function ResetPasswordCard() {
  const t = translations
  const navigate = useNavigate()
  const requestSignal = useRequestSignal()
  const [searchParams] = useSearchParams()

  const isExpired = searchParams.get('status') === 'expired' || !searchParams.get('token')

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8 || loading) return

    const signal = requestSignal()
    setLoading(true)

    setErrorMessage(null)
    try {
      const response = await apiFetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, token: searchParams.get('token') }),
        signal,
      })
      if (response.status === 404) {
        setErrorMessage(t.passwordRecoveryUnavailable)
        return
      }
      if (!response.ok) throw new Error('Password reset failed')
      setIsSuccess(true)
    } catch {
      if (!signal.aborted) setErrorMessage(t.serviceUnavailable)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  return (
    <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10 animate-in fade-in duration-200">
      {/* 440px Centered White Card per Figma #116:908 & #116:960 */}
      <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] transition-all">
        {isExpired ? (
          /* Expired Link State per Figma Note #116:956 */
          <div className="space-y-5 text-center flex flex-col items-center">
            <div
              role="alert"
              className="w-full p-4 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] text-[#9A3412] text-sm flex items-start gap-3 text-left"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 text-[#EB6834] mt-0.5" />
              <div className="flex-1 leading-snug">
                <span>{t.resetLinkExpired}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] text-white font-medium text-sm transition flex items-center justify-center cursor-pointer shadow-xs"
            >
              {t.askForNewLink}
            </button>
          </div>
        ) : isSuccess ? (
          /* Screen 4: Password changed (#116:960) */
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="w-12 h-12 rounded-full bg-[#E3F5EE] flex items-center justify-center text-[#1BAF7A]">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
                {t.passwordChangedTitle}
              </h1>
              <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
                {t.passwordChangedSubtitle}
              </p>
            </div>

            <div className="w-full pt-2">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] text-white font-medium text-sm transition flex items-center justify-center cursor-pointer shadow-xs"
              >
                {t.loginButton}
              </button>
            </div>
          </div>
        ) : (
          /* Screen 3: Choose a new password (#116:908) */
          <div>
            <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center mb-5 text-[#5A64B4]">
              <LockKeyhole className="w-6 h-6" />
            </div>

            <div className="mb-6 space-y-1">
              <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
                {t.chooseNewPasswordTitle}
              </h1>
              <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
                {t.chooseNewPasswordSubtitle}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMessage && <p role="alert" className="text-sm text-[#C62F31]">{errorMessage}</p>}
              <div className="space-y-1.5">
                <label htmlFor="new-password-input" className="block text-sm font-medium text-[#1A2330]">
                  {t.newPasswordLabel}
                </label>

                <div className="relative">
                  <input
                    id="new-password-input"
                    autoComplete="new-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.passwordPlaceholder}
                    className="w-full h-11 pl-3.5 pr-10 rounded-[10px] border border-[#DDE3EA] bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20 transition"
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

                {/* 4-segment strength meter (matching A2 Sign up & A6) */}
                <PasswordStrength password={password} t={t} className="pt-2" />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={password.length < 8 || loading}
                  className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t.savingPassword}</span>
                    </>
                  ) : (
                    t.savePassword
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Legal Footer */}
      <LegalFooter t={t} />
    </main>
  )
}

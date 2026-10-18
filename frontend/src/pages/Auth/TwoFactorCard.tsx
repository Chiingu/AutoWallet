import { isRecoveryCode, normalizeRecoveryCode } from '../../auth/recoveryCodes'
import { apiErrorDetail } from '../../api/errors'
import { Dialog } from '../../components/common/Dialog'
import { LegalFooter } from '../../components/common/LegalFooter'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck, AlertCircle, Loader2, KeyRound } from 'lucide-react'
import { OTPInput } from '../../components/common/OTPInput'
import { loginPath, safeReturnPath } from '../../auth/returnPath'
import { apiFetch } from '../../api/request'
import { useRequestSignal } from '../../hooks/useRequestSignal'
import { translations } from '../../i18n'
import { clearTwoFactorCredentials, getTwoFactorCredentials } from '../../auth/pendingCredentials'

export function TwoFactorCard() {
  const t = translations
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [pendingData] = useState(() => getTwoFactorCredentials() ?? { email: '', password: '' })
  const requestSignal = useRequestSignal()
  const returnTo = safeReturnPath(searchParams.get('redirect') || searchParams.get('return_to'))

  useEffect(() => {
    if (!pendingData.email || !pendingData.password) navigate(loginPath(returnTo), { replace: true })
  }, [navigate, pendingData.email, pendingData.password, returnTo])

  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [wrongCode, setWrongCode] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const [backupError, setBackupError] = useState(false)

  const inFlight = useRef(false)
  const cleanCode = code.replace(/\s/g, '')
  const isComplete = /^\d{6}$/.test(cleanCode)

  const signIn = async (method: 'totp_code' | 'recovery_code', value: string) => {
    if (inFlight.current || !pendingData.email || !pendingData.password) return
    if (method === 'totp_code' ? !/^\d{6}$/.test(value) : !isRecoveryCode(value)) return
    inFlight.current = true
    const signal = requestSignal()
    setVerifying(true); setWrongCode(false); setBackupError(false); setServiceError(null)
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingData.email, password: pendingData.password, [method]: value }), signal,
      })
      if (signal.aborted) return
      if (res.ok) {
        const data = await res.json()
        if (signal.aborted) return
        if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Missing access token')
        localStorage.setItem('autowallet_token', data.access_token)
        clearTwoFactorCredentials(); setBackupCode(''); navigate(returnTo, { replace: true })
      } else if (res.status === 401) {
        if (method === 'totp_code') setWrongCode(true)
        else setServiceError('That recovery code or your sign-in details could not be verified. Each recovery code can only be used once.')
      } else {
        const detail = await res.json().catch(() => null)
        setServiceError(apiErrorDetail(detail, t.serviceUnavailable).message)
      }
    } catch {
      if (!signal.aborted) setServiceError(method === 'recovery_code'
        ? 'Sign-in could not be confirmed. If this code was consumed, try another saved code or your authenticator app.'
        : t.serviceUnavailable)
    } finally { inFlight.current = false; if (!signal.aborted) setVerifying(false) }
  }

  const handleVerify = (value = code) => signIn('totp_code', value.replace(/\s/g, ''))
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void handleVerify() }
  const handleLogout = () => { clearTwoFactorCredentials(); navigate(loginPath(returnTo)) }
  const closeBackup = () => { setShowBackupModal(false); setBackupCode(''); setServiceError(null); setBackupError(false) }
  const handleBackupSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = normalizeRecoveryCode(backupCode)
    setBackupError(!isRecoveryCode(value))
    if (isRecoveryCode(value)) void signIn('recovery_code', value)
  }

  if (!pendingData.email || !pendingData.password) return null

  return (
    <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10">
      {/* 440px Centered White Card per Figma A4 (#115:658) */}
      <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] transition-all">
        {/* Shield Icon container (Figma EL-f775418e) */}
        <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center mb-5 text-[#5A64B4]">
          <ShieldCheck className="w-6 h-6" />
        </div>

        {/* Card Heading */}
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
            {t.twoFactorTitle}
          </h1>
          <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
            {t.twoFactorSubtitle}
          </p>
        </div>

        {/* Backend service down notice (if applicable) */}
        {serviceError && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#FFF5F5] border border-[#FFD2D2] text-[#C62F31] text-sm flex items-start gap-3 animate-in fade-in"
          >
            <AlertCircle className="w-5 h-5 shrink-0 text-[#C62F31] mt-0.5" />
            <div className="flex-1 leading-snug">
              <span>{serviceError}</span>
            </div>
          </div>
        )}

        {/* 2FA Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-[#1A2330]">
              {t.twoFactorCodeLabel}
            </label>

            {/* 6-cell OTP Input */}
            <OTPInput
              value={code}
              onChange={(val) => {
                setCode(val)
                if (wrongCode) setWrongCode(false)
              }}
              disabled={verifying}
              hasError={wrongCode}
              onComplete={(completedCode) => handleVerify(completedCode)}
              autoFocus
            />

            {/* Wrong Code Error Banner per Figma EL-df39dd6a */}
            {wrongCode && (
              <div
                role="alert"
                className="flex items-start gap-2 text-xs text-[#B42325] mt-2 animate-in fade-in"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-[#B42325] mt-0.5" />
                <span className="leading-snug">{t.twoFactorWrongCode}</span>
              </div>
            )}
          </div>

          {/* Continue / Checking Button */}
          <button
            type="submit"
            disabled={!isComplete || verifying}
            className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t.twoFactorChecking}</span>
              </>
            ) : (
              t.continueButton
            )}
          </button>
        </form>

        {/* Secondary Links ("other" frame #115:702 / #115:761) */}
        <div className="mt-6 flex items-center justify-between text-sm text-[#4A53A0] pt-2">
          <button
            type="button"
            disabled={verifying}
            onClick={() => { setServiceError(null); setShowBackupModal(true) }}
            className="text-[#4A53A0] hover:text-[#3B495D] hover:underline font-medium cursor-pointer"
          >
            {t.twoFactorCantUseApp}
          </button>
          <button
            type="button"
            disabled={verifying}
            onClick={handleLogout}
            className="text-[#4A53A0] hover:text-[#3B495D] hover:underline font-medium cursor-pointer"
          >
            {t.twoFactorLogOut}
          </button>
        </div>
      </div>

      {/* Backup Code Modal */}
      {showBackupModal && (
        <Dialog labelledBy="backup-code-title" dismissible={!verifying} onClose={closeBackup} panelClassName="w-full max-w-[420px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-8 shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-[#ECEEFA] flex items-center justify-center text-[#5A64B4]">
              <KeyRound className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <h2 id="backup-code-title" className="text-xl font-semibold text-[#1A2330]">
                {t.twoFactorBackupTitle}
              </h2>
              <p className="text-xs sm:text-sm text-[#5E6B7E] leading-relaxed">
                {t.twoFactorBackupSubtitle}
              </p>
            </div>

            <form onSubmit={handleBackupSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                {serviceError && <p role="alert" className="text-xs text-[#C62F31]">{serviceError}</p>}
                <input
                  type="text"
                  autoFocus
                  aria-label="Recovery code"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={verifying}
                  placeholder={t.twoFactorBackupPlaceholder}
                  value={backupCode}
                  onChange={(e) => {
                    setBackupCode(normalizeRecoveryCode(e.target.value))
                    if (backupError) setBackupError(false)
                    setServiceError(null)
                  }}
                  className={`w-full h-11 px-3.5 rounded-[10px] border font-mono text-center text-base tracking-widest bg-white text-[#1A2330] placeholder:text-[#8C9BAE] focus:outline-none transition ${
                    backupError
                      ? 'border-[#B42325] text-[#B42325] focus:ring-2 focus:ring-[#B42325]/20'
                      : 'border-[#DDE3EA] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
                  }`}
                />
                {backupError && (
                  <p className="text-xs text-[#B42325] flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Please enter a valid 32-character recovery code.</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="submit"
                  disabled={verifying || !isRecoveryCode(backupCode)}
                  className="w-full h-11 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] disabled:opacity-50 text-white font-medium text-sm transition cursor-pointer"
                >
                  {verifying ? t.twoFactorChecking : t.twoFactorBackupSubmit}
                </button>
                <button
                  type="button"
                  disabled={verifying}
                  onClick={closeBackup}
                  className="w-full h-10 rounded-[10px] text-sm text-[#5E6B7E] hover:text-[#1A2330] transition cursor-pointer"
                >
                  {t.twoFactorBackToCode}
                </button>
              </div>
            </form>
        </Dialog>
      )}

      {/* Legal Footer (Figma EL-0b7a78e5) */}
      <LegalFooter t={t} />
    </main>
  )
}

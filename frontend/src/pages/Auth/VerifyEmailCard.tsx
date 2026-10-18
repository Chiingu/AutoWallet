import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Mail } from 'lucide-react'
import { LegalFooter } from '../../components/common/LegalFooter'
import { apiFetch } from '../../api/request'
import { apiErrorDetail } from '../../api/errors'
import { readSignupDraft } from '../../auth/signupDraft'
import { isValidEmail } from '../../auth/validation'
import { useCountdown } from '../../hooks/useCountdown'
import { useRequestSignal } from '../../hooks/useRequestSignal'
import { translations } from '../../i18n'

export function VerifyEmailCard() {
  const [params] = useSearchParams()
  return <EmailVerification key={params.get('token') || 'request-link'} token={params.get('token')} initialEmail={params.get('email') || readSignupDraft().email || ''} />
}

function EmailVerification({ token, initialEmail }: { token: string | null; initialEmail: string }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState(initialEmail)
  const [verification, setVerification] = useState<'idle' | 'checking' | 'success' | 'error'>(token ? 'checking' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const pending = useRef(false)
  const verificationRequest = useRef<Promise<void> | null>(null)
  const requestSignal = useRequestSignal()
  const { countdown, startCountdown } = useCountdown()

  useEffect(() => {
    if (!token) return
    let active = true
    // A token is consumed once. Reuse the promise during StrictMode's effect
    // replay, and let an already-submitted verification finish on navigation.
    verificationRequest.current ??= apiFetch('/api/auth/email/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }).then(async response => {
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(apiErrorDetail(payload, 'Could not verify this link. Request a new link below.').message)
      }
    })
    verificationRequest.current.then(() => {
      if (active) { setVerification('success'); setError(null) }
    }).catch((reason: unknown) => {
      if (active) {
        setVerification('error')
        setError(reason instanceof Error ? reason.message : 'Verification could not be confirmed. Request a new link below.')
      }
    })
    return () => { active = false }
  }, [token])

  const resend = async () => {
    if (pending.current || countdown > 0 || !isValidEmail(email)) return
    pending.current = true
    const signal = requestSignal()
    setSending(true); setError(null); setNotice(null)
    try {
      const response = await apiFetch('/api/auth/email/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }), signal,
      })
      if (signal.aborted) return
      if (!response.ok) {
        if (response.status === 429) {
          const retry = Number(response.headers.get('Retry-After'))
          startCountdown(Number.isFinite(retry) && retry > 0 ? Math.min(900, retry) : 60)
        }
        const payload = await response.json().catch(() => null)
        throw new Error(apiErrorDetail(payload, 'Could not request a verification email. Please try again.').message)
      }
      setNotice('If this account needs verification, a verification email will be sent. Check your inbox and spam folder.')
      startCountdown(60)
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : 'Email service is unavailable. Please try again.')
    } finally { pending.current = false; if (!signal.aborted) setSending(false) }
  }

  return <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10">
    <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-sm space-y-5">
      <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center text-[#5A64B4]">{verification === 'success' ? <CheckCircle2 /> : <Mail />}</div>
      <h1 className="text-2xl font-semibold text-[#1A2330]">{verification === 'success' ? 'Email verified' : 'Verify your email'}</h1>
      {verification === 'checking' ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={16} />Verifying your email…</p> : verification === 'success' ? <p role="status" className="text-sm text-[#1F7A3A]">Your email address is verified. You can continue to your account.</p> : <p className="text-sm text-[#5E6B7E]">{token ? 'This verification could not be completed. You can request another link.' : translations.verifyEmailSubtitle.replace('{email}', email || 'your inbox')}</p>}
      {error && <p role="alert" className="text-sm text-[#B42325]">{error}</p>}
      {notice && <p role="status" className="text-sm text-[#1F7A3A]">{notice}</p>}
      {verification !== 'success' && <form onSubmit={event => { event.preventDefault(); void resend() }} className="space-y-3">
        <label className="block text-sm text-[#3B495D]">Email address<input type="email" autoComplete="email" required value={email} disabled={sending || verification === 'checking'} onChange={event => setEmail(event.target.value)} className="mt-1 w-full h-11 px-3 rounded-[10px] border border-[#DDE3EA]" /></label>
        <button disabled={sending || verification === 'checking' || countdown > 0 || !isValidEmail(email)} className="w-full min-h-11 px-3 rounded-[10px] border border-[#DDE3EA] text-sm disabled:opacity-50">{sending ? 'Requesting…' : countdown > 0 ? `Request another link in ${countdown}s` : 'Send verification link'}</button>
      </form>}
      <button onClick={() => navigate('/dashboard', { replace: true })} disabled={verification === 'checking'} className="w-full min-h-11 px-3 rounded-[10px] bg-[#5A64B4] text-white text-sm disabled:opacity-50">Continue to account</button>
    </div>
    <LegalFooter t={translations} />
  </main>
}

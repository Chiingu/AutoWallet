import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { OTPInput } from '../../components/common/OTPInput'
import { RecoveryCodes } from './RecoveryCodes'
import { parseRecoveryCodes } from '../../auth/recoveryCodes'
import { AuthenticatorCode } from './AuthenticatorCode'
import { SettingsApiError, settingsRequest } from '../../api/settingsApi'
import type { SecurityInfo } from '../../api/settingsApi'

export function SecuritySettings({ email, info, onEnabled, onSessionEnded, online }: {
  email: string; info: SecurityInfo; onEnabled: (enabled: boolean) => void; onSessionEnded: () => void; online: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [showKey, setShowKey] = useState(true)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [success, setSuccess] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const setupHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (setup) setupHeadingRef.current?.focus() }, [setup])

  const startSetup = async () => {
    if (inFlight.current || !online || info.twoFactorEnabled === true) return
    if (info.signInMethod !== 'google' && !password) { setError('Enter your current password to continue.'); return }
    if (info.signInMethod === 'google' && info.twoFactorEnabled !== false) { setError('Download your JSON data export in Privacy and data to check your security status first.'); return }
    inFlight.current = true
    const next = new AbortController()
    controller.current = next
    setBusy(true); setError(null)
    try {
      // /me does not expose 2FA status. Password sign-in without a code succeeds
      // only when 2FA is off; never replace an already-active authenticator key.
      if (info.signInMethod !== 'google') {
        try {
          const login = await settingsRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), signal: next.signal })
          const credentials = await login.json()
          if (typeof credentials.access_token !== 'string' || !credentials.access_token) throw new Error('Could not confirm your sign-in. Your authenticator key has not been changed.')
          onEnabled(false)
        } catch (reason) {
          if (reason instanceof SettingsApiError && reason.status === 401) {
            if (reason.message === '2FA code required' || reason.message === 'Invalid 2FA code') {
              onEnabled(true)
              setConfirming(false)
              setError('Two-factor login is already on. Your existing authenticator key has not been changed.')
            } else setError('Could not confirm your password. Google accounts can check their security status using a JSON export in Privacy and data.')
            return
          }
          throw reason
        }
      }
      const response = await settingsRequest('/api/auth/2fa/setup', { method: 'POST', signal: next.signal })
      const payload = await response.json()
      if (typeof payload.secret !== 'string' || !/^[A-Z2-7]+$/.test(payload.secret) || typeof payload.provisioning_uri !== 'string') throw new Error('The service did not return a valid authenticator key.')
      const uri = new URL(payload.provisioning_uri)
      if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp' || uri.searchParams.get('secret') !== payload.secret) throw new Error('The service did not return a valid authenticator QR code.')
      setSetup({ secret: payload.secret, uri: payload.provisioning_uri })
      setConfirming(false); setCode(''); setShowKey(true); setCopied(false)
    } catch (reason) {
      if (next.signal.aborted) return
      if (reason instanceof SettingsApiError && reason.status === 401) { onSessionEnded(); return }
      if (reason instanceof SettingsApiError && reason.status === 409) { onEnabled(true); setConfirming(false) }
      setError(reason instanceof Error ? reason.message : 'Could not start two-factor setup. Please try again.')
    } finally { inFlight.current = false; setBusy(false); setPassword(''); setShowPassword(false) }
  }

  const verify = async () => {
    if (inFlight.current || !online || !/^\d{6}$/.test(code)) return
    inFlight.current = true
    const next = new AbortController()
    controller.current = next
    setBusy(true); setError(null)
    try {
      const response = await settingsRequest('/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }), signal: next.signal })
      if (next.signal.aborted) return
      onEnabled(true); setSetup(null); setCode(''); setSuccess(true)
      const codes = parseRecoveryCodes(await response.json())
      if (!next.signal.aborted) setRecoveryCodes(codes)
    } catch (reason) {
      if (next.signal.aborted) return
      if (reason instanceof SettingsApiError && reason.status === 401) { onSessionEnded(); return }
      if (reason instanceof SettingsApiError && reason.status === 409) { onEnabled(true); setSetup(null); setCode('') }
      setError(reason instanceof SettingsApiError && reason.status === 400 ? 'That code didn’t work. Codes change every 30 seconds. Try the latest code from your app.' : 'The result could not be confirmed. Use your authenticator app and generate recovery codes below if setup was enabled.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <>
    <section className="workspace-card settings-card"><h2>Password</h2><p>Use at least 8 characters. A longer password is stronger than a complicated one.</p>
      <div className="settings-form settings-form--unavailable"><label>Current password<input className="dashboard-input" type="password" disabled autoComplete="current-password" aria-describedby="password-unavailable" /></label><label>New password<input className="dashboard-input" type="password" disabled autoComplete="new-password" aria-describedby="password-unavailable" /></label><button className="settings-outline-button" disabled>Change password</button></div>
      <p id="password-unavailable" className="settings-availability">Password changes are not available from the account service yet.</p>
    </section>
    <section className="workspace-card settings-card settings-security" aria-labelledby="two-factor-title"><h2 id="two-factor-title">Two-factor login</h2>
      <span className={`settings-status ${info.twoFactorEnabled === true ? 'settings-status--on' : ''}`}>{info.twoFactorEnabled === true && <Check size={13} />}{info.twoFactorEnabled === true ? 'On' : info.twoFactorEnabled === false || setup ? 'Off' : 'Status not provided'}</span>
      {success && <div className="workspace-banner workspace-banner--success" role="status"><Check size={16} />Two-factor login is on. Use your authenticator app the next time you sign in.</div>}
      {!setup && !confirming && <><p>{info.twoFactorEnabled === true ? 'You’ll need a code from your app each time you log in.' : 'Add a 6-digit code from an authenticator app each time you log in, so a stolen password is not enough.'}</p>{info.twoFactorEnabled === true ? <><button className="settings-danger-outline" disabled>Turn off two-factor login</button><p className="settings-availability">Turning off two-factor login is not supported by the account service yet.</p></> : <button className="dashboard-primary-button" onClick={() => { setConfirming(true); setError(null) }} disabled={!online}><ShieldCheck size={16} />Turn on two-factor login</button>}</>}
      {confirming && <form className="settings-form" noValidate onSubmit={event => { event.preventDefault(); void startSetup() }}><p>Confirm your current sign-in before creating an authenticator key. An existing two-factor login will be preserved.</p>{info.signInMethod !== 'google' && <label>Confirm current password<span className="settings-secret-input"><input className="dashboard-input" type={showPassword ? 'text' : 'password'} aria-label="Confirm current password" value={password} onChange={event => { setPassword(event.target.value); setError(null) }} autoComplete="current-password" disabled={busy} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>}<div className="settings-actions"><button className="dashboard-primary-button" disabled={busy || !online} type="submit">{busy ? 'Checking…' : 'Continue'}</button><button type="button" className="settings-text-button" disabled={busy} onClick={() => { setConfirming(false); setPassword(''); setError(null) }}>Cancel</button></div></form>}
      {setup && <form className="settings-setup" onSubmit={event => { event.preventDefault(); void verify() }}>
        <h3 ref={setupHeadingRef} tabIndex={-1}>1. Scan this code with your authenticator app</h3><AuthenticatorCode uri={setup.uri} /><p>Can’t scan it? Enter this key in your authenticator app instead.</p>
        <label className="settings-key-label">Setup key<span className="settings-setup-key"><input className="dashboard-input" type={showKey ? 'text' : 'password'} aria-label="Setup key" readOnly value={showKey ? setup.secret.match(/.{1,4}/g)?.join(' ') : setup.secret} autoComplete="off" spellCheck={false} /><button type="button" onClick={() => setShowKey(value => !value)} aria-label={showKey ? 'Hide setup key' : 'Show setup key'}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button><button type="button" onClick={() => { if (!navigator.clipboard) { setError('Could not copy the key. Select and copy it manually.'); return }; void navigator.clipboard.writeText(setup.secret).then(() => setCopied(true)).catch(() => setError('Could not copy the key. Select and copy it manually.')) }} aria-label={copied ? 'Setup key copied' : 'Copy setup key'}>{copied ? <Check size={17} /> : <Copy size={17} />}</button></span></label>
        <h3>2. Enter the 6-digit code it shows</h3><span className="settings-code-label">6-digit code</span><div className="settings-otp"><OTPInput value={code} onChange={value => { setCode(value); setError(null) }} autoFocus={false} disabled={busy} hasError={Boolean(error)} /></div>
        <div className="settings-actions"><button className="dashboard-primary-button" type="submit" disabled={busy || !online || !/^\d{6}$/.test(code)}>{busy ? 'Verifying…' : 'Verify and turn on'}</button><button type="button" className="settings-text-button" disabled={busy} onClick={() => { setSetup(null); setCode(''); setError(null) }}>Cancel</button></div>
      </form>}
      {error && <p role="alert" className="workspace-field-error">{error}</p>}
      {info.signInMethod === null && info.twoFactorEnabled === null && !setup && <p className="settings-availability">Sign in with Google? Request a JSON export in <Link className="workspace-text-button" to="/app/settings/privacy">Privacy and data</Link> first to check your security status.</p>}
    </section>
    {!setup && !confirming && info.twoFactorEnabled !== false && <RecoveryCodes codes={recoveryCodes} onCodes={setRecoveryCodes} onEnabled={() => onEnabled(true)} online={online && !busy} googleAccount={info.signInMethod === 'google'} onSessionEnded={onSessionEnded} />}
  </>
}

import { useEffect, useRef, useState } from 'react'
import { Copy, Download, RefreshCw } from 'lucide-react'
import { parseRecoveryCodes } from '../../auth/recoveryCodes'
import { SettingsApiError, settingsRequest } from '../../api/settingsApi'

interface Props {
  codes: string[]
  onCodes: (codes: string[]) => void
  onEnabled: () => void
  online: boolean
  googleAccount: boolean
  onSessionEnded: () => void
}

export function RecoveryCodes({ codes, onCodes, onEnabled, online, googleAccount, onSessionEnded }: Props) {
  const [editing, setEditing] = useState(false)
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const downloadUrl = useRef<string | null>(null)
  const hasCodes = codes.length > 0
  useEffect(() => () => { active.current?.abort(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current) }, [])
  useEffect(() => {
    if (!hasCodes) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasCodes])

  const text = `AutoWallet recovery codes\nEach code can be used once. Keep these somewhere private.\n\n${codes.join('\n')}\n`
  const download = () => {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    downloadUrl.current = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = downloadUrl.current; link.download = 'autowallet-recovery-codes.txt'
    document.body.append(link); link.click(); link.remove()
    setNotice('Download started. Check that you saved the file before closing these codes.')
  }
  const regenerate = async () => {
    if (active.current || !online || !password || !/^\d{6}$/.test(totp)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setError(null); setNotice(null)
    try {
      const response = await settingsRequest('/api/auth/2fa/recovery-codes/regenerate', {
        method: 'POST', body: JSON.stringify({ password, totp_code: totp }), signal: controller.signal,
      })
      if (controller.signal.aborted) return
      // A successful replacement invalidates every old code even if its response cannot be read.
      onCodes([]); onEnabled()
      const nextCodes = parseRecoveryCodes(await response.json())
      if (controller.signal.aborted) return
      onCodes(nextCodes); setEditing(false)
      setNotice('New recovery codes created. Your previous codes no longer work.')
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof SettingsApiError && reason.status === 401) {
        if (reason.message === 'Invalid credentials') setError('Check your current password and latest authenticator code.')
        else onSessionEnded()
      } else if (reason instanceof SettingsApiError) setError(reason.message)
      else {
        onCodes([])
        setError('The replacement result could not be confirmed. Your old codes may no longer work. Use your authenticator app and generate another set.')
      }
    } finally {
      active.current = null
      if (!controller.signal.aborted) { setBusy(false); setPassword(''); setTotp('') }
    }
  }

  return <section className="workspace-card settings-card" aria-labelledby="recovery-codes-title">
    <h2 id="recovery-codes-title">Recovery codes</h2>
    <p>Use a recovery code to sign in if you lose access to your authenticator. Each code works once.</p>
    {hasCodes ? <>
      <p className="workspace-note">Save these now. They stay only on this screen and cannot be displayed again after you leave.</p>
      <ul className="settings-recovery-codes" aria-label="Your recovery codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
      <div className="settings-actions">
        <button className="settings-outline-button" onClick={() => {
          if (!navigator.clipboard) { setError('Could not copy. Download the codes or select and copy them manually.'); return }
          void navigator.clipboard.writeText(text).then(() => { setNotice('Recovery codes copied. Save them somewhere private.'); setError(null) }).catch(() => setError('Could not copy. Download the codes or select and copy them manually.'))
        }}><Copy size={16} />Copy codes</button>
        <button className="settings-outline-button" onClick={download}><Download size={16} />Download codes</button>
        <button className="dashboard-primary-button" onClick={() => {
          onCodes([]); setNotice('Recovery codes hidden. Use your saved copy when needed.'); setError(null)
          if (downloadUrl.current) { URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null }
        }}>I’ve saved these codes</button>
      </div>
    </> : !editing && <>
      <button className="settings-outline-button" disabled={!online || googleAccount} onClick={() => { setEditing(true); setError(null); setNotice(null) }}><RefreshCw size={16} />Generate new recovery codes</button>
      <p className="workspace-note">Requires two-factor login, your current password and an authenticator code. This replaces all previous recovery codes.</p>
      {googleAccount && <p className="settings-availability">The account service requires a password to replace recovery codes. Replacement is unavailable for Google-only accounts.</p>}
    </>}
    {editing && <form className="settings-form" onSubmit={event => { event.preventDefault(); void regenerate() }}>
      <label>Current password<input className="dashboard-input" type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      <label>Authenticator code<input className="dashboard-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} disabled={busy} onChange={event => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <div className="settings-actions"><button className="dashboard-primary-button" disabled={busy || !online || !password || !/^\d{6}$/.test(totp)}>{busy ? 'Generating…' : 'Replace recovery codes'}</button><button type="button" className="settings-text-button" disabled={busy} onClick={() => { setEditing(false); setPassword(''); setTotp(''); setError(null) }}>Cancel</button></div>
    </form>}
    {notice && <p className="workspace-note" role="status">{notice}</p>}
    {error && <p className="workspace-field-error" role="alert">{error}</p>}
  </section>
}

import { useEffect, useRef, useState } from 'react'
import { Check, Download, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Dialog } from '../../components/common/Dialog'
import { SettingsApiError, securityFromExport, settingsRequest } from '../../api/settingsApi'
import type { SecurityInfo } from '../../api/settingsApi'

interface Props {
  email: string
  online: boolean
  onSecurityInfo: (info: SecurityInfo) => void
  onSessionEnded: () => void
  onDeleted: () => void
}

export function PrivacySettings({ email, online, onSecurityInfo, onSessionEnded, onDeleted }: Props) {
  const [format, setFormat] = useState<'json' | 'csv'>('json')
  const [prepared, setPrepared] = useState<{ url: string; format: string; message: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const exportUrl = useRef<string | null>(null)
  const inFlight = useRef(false)
  useEffect(() => () => { controller.current?.abort(); if (exportUrl.current) URL.revokeObjectURL(exportUrl.current) }, [])

  const prepareExport = async () => {
    if (inFlight.current || !online) return
    inFlight.current = true
    const next = new AbortController()
    controller.current = next
    setExporting(true); setError(null)
    try {
      const response = await settingsRequest(`/api/gdpr/export?format=${format}`, { signal: next.signal })
      const type = response.headers.get('Content-Type') || ''
      if (!(format === 'json' ? type.includes('application/json') : type.includes('application/zip'))) throw new Error('The service did not return a valid export file.')
      const blob = await response.blob()
      if (!blob.size) throw new Error('The service returned an empty export. Please try again.')
      let message = 'Your CSV tables are ready in a ZIP file.'
      if (format === 'json') {
        const data = await blob.text().then(text => { try { return JSON.parse(text) } catch { throw new Error('The service did not return a valid JSON export.') } })
        const security = securityFromExport(data)
        if (!security || !Array.isArray(data.payments) || !Array.isArray(data.rules) || !Array.isArray(data.envelopes)) throw new Error('The service returned an incomplete export. Please try again.')
        onSecurityInfo(security)
        message = `Your export is ready. It includes ${data.payments.length} payments, ${data.rules.length} rules and ${data.envelopes.length} envelopes.`
      }
      if (next.signal.aborted) return
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current)
      exportUrl.current = URL.createObjectURL(blob)
      setPrepared({ url: exportUrl.current, format, message })
    } catch (reason) {
      if (next.signal.aborted) return
      if (reason instanceof SettingsApiError && reason.status === 401) { onSessionEnded(); return }
      setError(reason instanceof Error ? reason.message : 'Could not prepare your export. Please try again.')
    } finally { inFlight.current = false; setExporting(false) }
  }

  return <>
    <section className="workspace-card settings-card"><h2>Download your data</h2><p>A file with your profile, envelopes, rules and payments.</p>
      {prepared && <div className="workspace-banner workspace-banner--success" role="status"><Check size={16} /><span>{prepared.message}</span></div>}
      <div className="settings-export-actions"><label><span className="sr-only">Export format</span><select aria-label="Export format" value={format} disabled={exporting} onChange={event => { setFormat(event.target.value as 'json' | 'csv'); setPrepared(null); setError(null); if (exportUrl.current) { URL.revokeObjectURL(exportUrl.current); exportUrl.current = null } }}><option value="json">JSON</option><option value="csv">CSV (ZIP)</option></select></label>{prepared ? <a className="dashboard-primary-button" href={prepared.url} download={`autowallet-my-data.${prepared.format === 'csv' ? 'zip' : 'json'}`}><Download size={16} />Download export ({prepared.format === 'csv' ? 'ZIP' : 'JSON'})</a> : <button className="dashboard-primary-button" onClick={() => void prepareExport()} disabled={exporting || !online}><Download size={16} />{exporting ? 'Preparing…' : 'Request export'}</button>}</div>
      <p className="workspace-note">The file is prepared here for download. The account service may also email you a confirmation.</p>{error && <p className="workspace-field-error" role="alert">{error}</p>}
    </section>
    <section className="workspace-card settings-card"><h2>What we keep</h2><dl className="settings-data-list"><div><dt>Profile</dt><dd>Name, email and linked account ID</dd></div><div><dt>Money</dt><dd>Envelopes, rules and payments</dd></div><div><dt>In your browser</dt><dd>Sign-in token, theme and notification preferences</dd></div><div><dt>Read status</dt><dd>Which payment notifications you’ve read</dd></div></dl><Link className="workspace-text-button" to="/privacy">Read our privacy notice</Link></section>
    <section className="workspace-card settings-card"><h2>Delete your account</h2><p>Deletes your envelopes, rules and payment history for good. This can’t be undone.</p><button className="settings-danger-button" onClick={() => setDeleteOpen(true)} disabled={!online}><Trash2 size={16} />Delete account</button></section>
    {deleteOpen && <DeleteAccountDialog email={email} online={online} onClose={() => setDeleteOpen(false)} onExport={() => { setDeleteOpen(false); document.getElementById('settings-content')?.scrollIntoView({ behavior: 'smooth' }) }} onSessionEnded={onSessionEnded} onDeleted={onDeleted} />}
  </>
}

function DeleteAccountDialog({ email, online, onClose, onExport, onSessionEnded, onDeleted }: {
  email: string; online: boolean; onClose: () => void; onExport: () => void; onSessionEnded: () => void; onDeleted: () => void
}) {
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  useEffect(() => { if (sent) codeRef.current?.focus() }, [sent])

  const submit = async (confirmDelete: boolean) => {
    if (inFlight.current || !online || confirmation !== 'DELETE' || (confirmDelete && !/^\d{6}$/.test(code)) || (!confirmDelete && cooldown > 0)) return
    inFlight.current = true
    const next = new AbortController()
    controller.current = next
    setBusy(true); setError(null); setStatus(null)
    try {
      await settingsRequest(`/api/gdpr/${confirmDelete ? 'delete-confirm' : 'delete-request'}`, { method: 'POST', ...(confirmDelete ? { body: JSON.stringify({ code }) } : {}), signal: next.signal })
      if (confirmDelete) { onDeleted(); return }
      setSent(true); setCode(''); setCooldown(60)
      setStatus(`A 6-digit code was sent to ${email}. It is valid for 15 minutes.`)
    } catch (reason) {
      if (next.signal.aborted) return
      if (reason instanceof SettingsApiError && reason.status === 401) { onSessionEnded(); return }
      if (reason instanceof SettingsApiError && reason.retryAfter > 0) setCooldown(reason.retryAfter)
      if (!confirmDelete && reason instanceof SettingsApiError && reason.code === 'wait') {
        setSent(true)
        setStatus('A confirmation code was recently requested. Use the latest code from your email, or wait to resend it.')
      }
      setError(reason instanceof SettingsApiError ? reason.message : confirmDelete ? 'The deletion result could not be confirmed. Check whether you can still sign in before trying again.' : 'Could not send a confirmation code. Please try again.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <Dialog labelledBy="delete-account-title" role="alertdialog" initialFocusRef={cancelRef} dismissible={!busy} onClose={onClose} panelClassName="dashboard-modal settings-delete-dialog"><button className="dashboard-modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X size={20} /></button><h2 id="delete-account-title">Delete your account?</h2><p>This deletes your envelopes, rules and payment history for good. Download your data first if you want a copy.</p><button className="workspace-text-button" onClick={onExport} disabled={busy}>Download your data</button>
    <form noValidate className="settings-form" onSubmit={event => { event.preventDefault(); void submit(sent) }}>
      <label>Type DELETE to confirm<input className="dashboard-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} /></label>
      {sent && <label>Email confirmation code<input aria-label="Email confirmation code" ref={codeRef} className="dashboard-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }} maxLength={6} disabled={busy} aria-describedby="delete-code-help" /><span id="delete-code-help" className="workspace-note">Use the latest 6-digit code from your email.</span></label>}
      {status && <p className="workspace-note" role="status">{status}</p>}{error && <p className="workspace-field-error" role="alert">{error}</p>}
      {!sent && <p className="workspace-note">Next, we’ll send a code to your account email. Nothing is deleted until you confirm that code.</p>}
      {sent && <button type="button" className="settings-text-button" disabled={busy || cooldown > 0 || !online} onClick={() => void submit(false)}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button>}
      <footer className="settings-actions"><button ref={cancelRef} type="button" className="dashboard-secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="settings-danger-button" disabled={busy || !online || confirmation !== 'DELETE' || (sent ? !/^\d{6}$/.test(code) : cooldown > 0)}>{busy ? sent ? 'Deleting…' : 'Sending…' : sent ? 'Delete account' : 'Send confirmation code'}</button></footer>
    </form>
  </Dialog>
}

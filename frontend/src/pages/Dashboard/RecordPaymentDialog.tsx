import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from '../../components/common/Dialog'
import { parseAmount } from '../../utils/format'
import { apiFetch } from '../../api/request'
import { apiErrorDetail } from '../../api/errors'
import { useRequestSignal } from '../../hooks/useRequestSignal'

export function RecordPaymentDialog({ onClose, onRecorded, onSessionEnded, available }: { onClose: () => void; onRecorded: (reference: string) => void; onSessionEnded: () => void; available: boolean }) {
  const requestSignal = useRequestSignal()
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const referenceRef = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const value = parseAmount(amount)
  const invalidAmount = submitted && (!Number.isFinite(value) || value <= 0)
  const invalidReference = submitted && !reference.trim()

  const submit = async () => {
    if (inFlight.current || !available) return
    setSubmitted(true)
    if (!Number.isFinite(value) || value <= 0) { amountRef.current?.focus(); return }
    if (!reference.trim()) { referenceRef.current?.focus(); return }
    const token = localStorage.getItem('autowallet_token')
    if (!token) { onSessionEnded(); return }
    const signal = requestSignal()
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch('/api/transactions/', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: reference.trim(), amount: value }),
        signal,
      }, 60000)
      if (response.status === 401) { onSessionEnded(); return }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(response.status === 409 ? 'Another payment is processing. Wait a moment, then try again with this same reference.' : apiErrorDetail(payload, 'Could not record this payment. Please try again.').message)
        return
      }
      onRecorded(reference.trim())
    } catch { if (!signal.aborted) setError('The payment result could not be confirmed. Check Activity before trying again, and keep the same reference to avoid a duplicate.') }
    finally { inFlight.current = false; if (!signal.aborted) setSaving(false) }
  }

  return <Dialog labelledBy="record-title" onClose={onClose} dismissible={!saving} panelClassName="dashboard-modal record-payment-dialog">
    <button type="button" onClick={onClose} disabled={saving} className="dashboard-modal-close" aria-label="Close"><X size={20} /></button>
    <h2 id="record-title">Record a payment</h2><p>It splits with your rules as soon as you record it.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>Amount<span className="workspace-amount-input"><input ref={amountRef} className="dashboard-input" inputMode="decimal" aria-label="Amount (MAD)" value={amount} onChange={event => setAmount(event.target.value)} placeholder="12,000.00" disabled={saving} aria-invalid={invalidAmount} aria-describedby={invalidAmount ? 'record-amount-error' : undefined} /><span>MAD</span></span>{invalidAmount && <span id="record-amount-error" className="workspace-field-error" role="alert">Enter an amount above 0.00.</span>}</label>
      <label>Reference<input aria-label="Reference" ref={referenceRef} className="dashboard-input" value={reference} onChange={event => setReference(event.target.value)} maxLength={100} placeholder="INV-2026-048" disabled={saving} aria-invalid={invalidReference} aria-describedby={invalidReference ? 'record-reference-error' : undefined} />{invalidReference && <span id="record-reference-error" className="workspace-field-error" role="alert">Enter a payment reference.</span>}</label>
      {error && <p className="workspace-field-error" role="alert">{error}</p>}
      {!available && <p className="workspace-field-error" role="alert">Recording is unavailable while the payment service is disconnected.</p>}
      <footer><button type="button" className="dashboard-secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" disabled={saving || !available} className="dashboard-primary-button">{saving ? 'Recording…' : 'Record payment'}</button></footer>
    </form>
  </Dialog>
}

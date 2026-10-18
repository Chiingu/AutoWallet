import { useEffect, useRef, useState } from 'react'
import { Check, FlaskConical } from 'lucide-react'
import type { DashboardData } from './dashboardApi'
import { DashboardSplitRibbon } from './DashboardSplitRibbon'
import { PaymentReceipt } from './PaymentReceipt'
import { previewPayment } from './dashboardSplit'
import { money, parseAmount } from '../../utils/format'

export function SandboxView({ data }: { data: DashboardData }) {
  const [amount, setAmount] = useState('12,000.00')
  const [reference, setReference] = useState('TEST-001')
  const [settled, setSettled] = useState(amount)
  const [simulated, setSimulated] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const timer = setTimeout(() => setSettled(amount), 500); return () => clearTimeout(timer) }, [amount])
  const value = parseAmount(settled)
  const valid = Number.isFinite(value) && value > 0
  const result = previewPayment(value, data.rules, data.wallets)
  const updating = settled !== amount
  const enteredAmount = parseAmount(amount)
  const inputValid = Number.isFinite(enteredAmount) && enteredAmount > 0
  const inputInvalid = submitted && !inputValid
  return <div className="workspace-page sandbox-page"><header className="workspace-heading"><div><h1>Sandbox</h1><p>Try a payment with your current rules. Your real balances stay unchanged.</p></div></header>
    <section className="workspace-card sandbox-form"><div className="workspace-title-row"><h2>Simulate a client payment</h2><span className="workspace-tag"><FlaskConical size={13} />Test money</span></div>
      <form noValidate onSubmit={event => { event.preventDefault(); setSubmitted(true); setSettled(amount); setSimulated(inputValid); if (!inputValid) amountRef.current?.focus() }}>
        <div className="sandbox-fields"><label>Amount<span className="workspace-amount-input"><input ref={amountRef} id="sandbox-amount" className="dashboard-input" inputMode="decimal" aria-label="Amount (MAD)" value={amount} onChange={event => { setAmount(event.target.value); setSimulated(false) }} aria-invalid={inputInvalid} aria-describedby={inputInvalid ? 'sandbox-amount-error' : undefined} /><span>MAD</span></span>{inputInvalid && <span id="sandbox-amount-error" className="workspace-field-error" role="alert">Enter an amount above 0.00.</span>}</label><label>Reference <span className="workspace-optional">(optional)</span><input className="dashboard-input" value={reference} onChange={event => setReference(event.target.value)} maxLength={100} placeholder="TEST-001" /></label></div>
        <button className="dashboard-primary-button" type="submit"><FlaskConical size={16} />Simulate payment</button><p className="workspace-note">Local simulation only. Test payments are not saved in Activity.</p>
      </form>
    </section>
    {simulated && <div className="workspace-banner workspace-banner--success" role="status"><Check size={17} />Simulation complete. Your balances have not changed.</div>}
    <section className="sandbox-preview" aria-busy={updating}><header className="workspace-heading"><div><h2>{valid ? `What ${money.format(value)} would do now` : 'Your payment preview'}</h2><p>Using your saved rules and current envelope balances.</p></div>{updating && <span className="workspace-note">Updating…</span>}</header>
      {valid ? <><div className="payment-detail-ribbon"><DashboardSplitRibbon amount={value} allocations={result.allocations} preview previewLabel="Test payment" /></div><PaymentReceipt amount={value} allocations={result.allocations} reference={reference.trim() || 'Test payment'} steps={result.steps} /></> : <div className="workspace-empty workspace-card"><FlaskConical /><h3>Try an amount</h3><p>Enter an amount above 0.00 to see where it would go.</p></div>}
    </section>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BarChart3, Check, ChevronDown, Copy, RefreshCw, Sparkles, Square, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import type { DashboardData, WalletType } from './dashboardApi'
import { AssistantApiError, streamAssistant } from '../../api/assistantApi'
import { envelopeMeta, money, walletOrder } from './envelopeDisplay'
import { previewSplit } from './dashboardSplit'
import { FormattedAnswer } from './FormattedAnswer'
import { DashboardSplitRibbon } from './DashboardSplitRibbon'
import { hasCompleteSplit } from './paymentUtils'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  source?: 'Local engine' | 'External model'
  chart?: Partial<Record<WalletType, number>>
  preview?: number
  stopped?: boolean
}

export function AssistantView({ data, online, onSessionEnded }: { data: DashboardData; online: boolean; onSessionEnded: () => void }) {
  const location = useLocation()
  const initialQuestion = typeof location.state?.question === 'string' ? location.state.question.slice(0, 2000) : ''
  const [draft, setDraft] = useState(initialQuestion)
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chartOpen, setChartOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const chartRef = useDismissibleLayer(chartOpen, () => setChartOpen(false))
  const active = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)
  const latestQuestion = useRef('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort() } }, [])
  useEffect(() => {
    const thread = scrollRef.current
    if (thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 220) thread.scrollTop = thread.scrollHeight
  }, [messages, busy])

  const ask = async (question: string, regenerate = false) => {
    const trimmed = question.trim()
    if (!trimmed || trimmed.length > 2000 || active.current || !online) return
    const token = localStorage.getItem('autowallet_token')
    if (!token) { onSessionEnded(); return }
    const controller = new AbortController()
    active.current = controller
    latestQuestion.current = trimmed
    setBusy(true); setError(null); setDraft('')
    const id = crypto.randomUUID()
    const answer: Message = { id, role: 'assistant', text: '', source: 'External model' }
    const history = regenerate ? messages.slice(0, messages.findLastIndex(item => item.role === 'user')) : messages
    setMessages([...history, { id: crypto.randomUUID(), role: 'user', text: trimmed }, answer])
    // The API accepts one message. Include recent text only when it fits its 2,000 character limit.
    const prefix = 'Recent conversation:\n'
    const suffix = `\nCurrent question: ${trimmed}`
    const budget = 2000 - prefix.length - suffix.length
    const recent = history.filter(item => !item.chart && !item.preview && item.text).slice(-4).map(item => `${item.role}: ${item.text}`).join('\n')
    const request = recent && budget > 100 ? `${prefix}${recent.slice(-budget)}${suffix}` : trimmed
    try {
      await streamAssistant(request, token, controller.signal, text => {
        if (mounted.current) setMessages(items => items.map(item => item.id === id ? { ...item, text: item.text + text } : item))
      })
    } catch (reason) {
      if (!mounted.current) return
      if (controller.signal.aborted) setMessages(items => items.map(item => item.id === id ? { ...item, stopped: true } : item))
      else if (reason instanceof AssistantApiError && reason.status === 401) onSessionEnded()
      else setError(reason instanceof Error ? reason.message : 'I couldn’t answer that. Nothing in your account changed.')
    } finally {
      if (active.current === controller) active.current = null
      if (mounted.current) { setBusy(false); inputRef.current?.focus() }
    }
  }

  const addChart = (kind: 'balances' | 'payment') => {
    const payment = data.transactions.find(item => item.status === 'processed' && hasCompleteSplit(item))
    const chart = kind === 'balances' ? Object.fromEntries(data.wallets.map(wallet => [wallet.wallet_type, wallet.balance])) : payment?.allocations
    if (!chart) return
    setMessages(items => [...items, { id: crypto.randomUUID(), role: 'assistant', text: kind === 'balances' ? 'Your current envelope balances (MAD)' : `Recorded split for ${payment!.reference} (MAD)`, source: 'Local engine', chart }])
    setChartOpen(false)
  }
  const localPreview = () => {
    setMessages(items => [...items, { id: crypto.randomUUID(), role: 'user', text: 'What would 12,000.00 MAD do?' }, { id: crypto.randomUUID(), role: 'assistant', text: 'Here’s a preview using your current rules and balances. Your account has not changed.', source: 'Local engine', preview: 12000 }])
  }
  const lastAnswer = messages.findLast(item => item.role === 'assistant' && item.source === 'External model')
  return <section className={`assistant-page ${messages.length ? 'assistant-page--conversation' : ''}`} aria-label="Assistant">
    <div className="assistant-thread" ref={scrollRef} role="log" aria-label="Conversation" aria-relevant="additions">
      {!messages.length ? <div className="assistant-welcome"><span className="assistant-welcome-icon"><Sparkles size={25} /></span><h1>Ask about your money</h1><p>Answers use your envelopes and payments.<br />Nothing changes in your account from chatting here.</p></div> : <div className="assistant-messages">{messages.map(message => <article key={message.id} className={`assistant-message assistant-message--${message.role}`} aria-label={message.role === 'user' ? 'Your question' : 'Assistant response'}>
        {message.source && <span className="assistant-source"><Sparkles size={12} />{message.source}</span>}
        {message.text ? <div className="assistant-message-text">{message.role === 'assistant' ? <FormattedAnswer text={message.text} /> : message.text}</div> : busy && message.id === lastAnswer?.id ? <span className="assistant-thinking" role="status">Thinking…</span> : message.stopped ? null : <p className="workspace-note">No answer received.</p>}
        {message.preview && <DashboardSplitRibbon amount={message.preview} allocations={previewSplit(message.preview, data.rules, data.wallets)} preview />}
        {message.chart && <div className="assistant-chart">{walletOrder.map(type => { const value = message.chart?.[type] ?? 0; const maximum = Math.max(1, ...Object.values(message.chart!).filter((v): v is number => typeof v === 'number')); return <div key={type}><span>{envelopeMeta[type].name}</span><span className="assistant-chart-track"><i style={{ width: `${Math.max(0, value) / maximum * 100}%`, backgroundColor: envelopeMeta[type].color }} /></span><strong>{money.format(value)}</strong></div> })}</div>}
        {message.stopped && <p className="workspace-note">Response stopped.</p>}
        {message.role === 'assistant' && message.text && !busy && <div className="assistant-message-tools"><button onClick={() => { void navigator.clipboard?.writeText(message.text).then(() => setCopied(message.id)).catch(() => setCopied(null)) }} aria-label={copied === message.id ? 'Copied' : 'Copy response'}>{copied === message.id ? <Check size={14} /> : <Copy size={14} />}</button>{message.id === lastAnswer?.id && <button onClick={() => void ask(latestQuestion.current, true)} disabled={!online} aria-label="Regenerate response"><RefreshCw size={14} /></button>}</div>}
      </article>)}</div>}
      {error && <div className="assistant-error" role="alert"><strong>I couldn’t finish that answer.</strong><p>{error}</p><span>Nothing in your account changed.</span><button onClick={() => void ask(latestQuestion.current, true)} disabled={busy || !online}>Try again</button></div>}
    </div>
    <div className="assistant-compose-wrap">
      {!messages.length && <div className="assistant-starters"><button disabled={busy || !online} onClick={() => void ask('Explain my current Tax envelope balance and rule.')}>Why is Tax at this balance?</button><button disabled={busy || !online} onClick={() => void ask('When could Savings reach its cap? Explain the assumptions using my available payments and rules.')}>When will Savings reach its cap?</button><button disabled={busy} onClick={localPreview}>What would 12,000.00 do?</button></div>}
      <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void ask(draft) }}>
        <div className="assistant-composer-tools"><span className="assistant-context"><Check size={13} />Use my envelopes &amp; payments</span><div className="relative" ref={chartRef}><button type="button" className="assistant-add-chart" onClick={() => setChartOpen(value => !value)} disabled={busy} aria-expanded={chartOpen}><BarChart3 size={14} />Add a chart<ChevronDown size={12} /></button>{chartOpen && <div className="assistant-chart-menu"><button type="button" onClick={() => addChart('balances')}>Envelope balances</button><button type="button" disabled={!data.transactions.some(item => item.status === 'processed' && hasCompleteSplit(item))} onClick={() => addChart('payment')}>Last recorded split</button><button type="button" onClick={() => setChartOpen(false)}><X size={12} />Close</button></div>}</div></div>
        <div className="assistant-input-row"><textarea ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} disabled={!online} placeholder={online ? 'Ask about your money' : 'You’re offline. Your conversation is still here.'} aria-label="Ask about your money" rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft) } }} />{busy ? <button type="button" className="assistant-send" onClick={() => active.current?.abort()} aria-label="Stop response"><Square size={16} /></button> : <button type="submit" className="assistant-send" disabled={!draft.trim() || !online} aria-label="Send message"><ArrowUp size={18} /></button>}</div>
      </form>
      <p className="assistant-disclaimer">Check answers before making money decisions. Chat cannot change your rules or move money.</p>
    </div>
  </section>
}

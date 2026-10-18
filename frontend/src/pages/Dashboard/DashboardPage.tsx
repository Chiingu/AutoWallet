import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowDownLeft, BarChart3, Bell, Check, ChevronDown, ChevronRight, Clock3, FlaskConical, LayoutDashboard, Link2, ListOrdered, LogOut, Mail, Menu, MessageSquareText, PanelLeftClose, Plus, Search, Settings, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { DashboardApiError, fetchDashboardResources, fetchDashboardUser } from './dashboardApi'
import type { DashboardData, DashboardTransaction, DashboardUser, WalletType } from './dashboardApi'
import { apiFetch } from '../../api/request'
import { apiErrorDetail } from '../../api/errors'
import { loginPath, safeReturnPath } from '../../auth/returnPath'
import { useRequestSignal } from '../../hooks/useRequestSignal'
import { isValidBankAccountId } from '../../auth/validation'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'
import { HomeView, LoadingHome } from './HomeView'
import { EnvelopesSkeleton, EnvelopesView } from './EnvelopesView'
import { EnvelopeDetailView } from './EnvelopeDetailView'
import { RulesView } from './RulesView'
import { ActivitySkeleton, ActivityView } from './ActivityView'
import { PaymentDetailView } from './PaymentDetailView'
import { SandboxView } from './SandboxView'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { NotificationsView } from './NotificationsView'
import { usePaymentNotifications } from './usePaymentNotifications'
import { usePaymentLiveUpdates } from './usePaymentLiveUpdates'
import { getPaymentAlerts, usePaymentAlerts } from '../Settings/settingsPreferences'
import { envelopeMeta, money } from './envelopeDisplay'
import './dashboard.css'
import './workspace.css'
import './dashboardTheme.css'

const AnalyticsView = lazy(() => import('./AnalyticsView').then(module => ({ default: module.AnalyticsView })))
const AssistantView = lazy(() => import('./AssistantView').then(module => ({ default: module.AssistantView })))

const SettingsView = lazy(() => import('../Settings/SettingsView').then(module => ({ default: module.SettingsView })))

type PageView = 'home' | 'envelopes' | 'rules' | 'activity' | 'analytics' | 'assistant' | 'sandbox' | 'notifications' | 'settings'
type View = PageView | 'envelope-detail' | 'payment-detail'
const nav: { view: PageView; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { view: 'home', label: 'Home', icon: LayoutDashboard },
  { view: 'envelopes', label: 'Envelopes', icon: Mail },
  { view: 'rules', label: 'Rules', icon: ListOrdered },
  { view: 'activity', label: 'Activity', icon: Clock3 },
  { view: 'analytics', label: 'Analytics', icon: BarChart3 },
  { view: 'assistant', label: 'Assistant', icon: MessageSquareText },
  { view: 'settings', label: 'Settings', icon: Settings },
]

export function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const controller = useRef<AbortController | null>(null)
  const lastSnapshot = useRef<DashboardData | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const mobileSearchRef = useRef<HTMLInputElement | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [account, setAccount] = useState<DashboardUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const detailSegment = location.pathname.match(/^\/app\/envelopes\/([^/]+)$/)?.[1]
  const detailType = detailSegment && Object.hasOwn(envelopeMeta, detailSegment) ? detailSegment as WalletType : null
  const paymentSegment = location.pathname.match(/^\/app\/activity\/([^/]+)$/)?.[1]
  const view: View = location.pathname === '/app/settings' || location.pathname.startsWith('/app/settings/') ? 'settings' : detailSegment ? 'envelope-detail' : paymentSegment ? 'payment-detail' : (['envelopes', 'rules', 'activity', 'analytics', 'assistant', 'sandbox', 'notifications'] as const).find(page => location.pathname === `/app/${page}`) ?? 'home'
  const settingsOnly = view === 'settings'
  const returnTo = safeReturnPath(`${location.pathname}${location.search}${location.hash}`)
  const requestSignal = useRequestSignal()
  const fromPath = typeof location.state?.from === 'string' ? location.state.from : '/dashboard'
  const activeView = view === 'notifications' ? fromPath.startsWith('/app/activity') ? 'activity' : fromPath.startsWith('/app/envelopes') ? 'envelopes' : fromPath === '/app/rules' ? 'rules' : fromPath === '/app/assistant' ? 'assistant' : fromPath === '/app/analytics' ? 'analytics' : fromPath === '/app/sandbox' ? 'sandbox' : fromPath.startsWith('/app/settings') ? 'settings' : 'home' : view
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const mobileNavRef = useRef<HTMLElement>(null)
  const notificationRef = useDismissibleLayer(notificationOpen, () => setNotificationOpen(false))
  const profileRef = useDismissibleLayer(profileOpen, () => setProfileOpen(false))
  const moreRef = useDismissibleLayer(moreOpen, () => setMoreOpen(false), mobileNavRef)
  const [search, setSearch] = useState('')
  const [recordOpen, setRecordOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [newPayment, setNewPayment] = useState<DashboardTransaction | null>(null)
  const [bankAccountId, setBankAccountId] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking')

  const signOut = useCallback(() => { localStorage.removeItem('autowallet_token'); navigate('/login', { replace: true }) }, [navigate])
  const endSession = useCallback(() => {
    localStorage.removeItem('autowallet_token')
    navigate(`/session-ended?reason=expired&redirect=${encodeURIComponent(returnTo)}`, { replace: true })
  }, [navigate, returnTo])
  const loadDashboard = useCallback(async () => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    const token = localStorage.getItem('autowallet_token')
    if (!token) { navigate(loginPath(returnTo), { replace: true }); return }
    setLoading(true)
    setError(null)
    setServiceStatus('checking')
    try {
      const user = await fetchDashboardUser(token, next.signal)
      if (next.signal.aborted) return
      setAccount(user)
      if (settingsOnly) {
        setServiceStatus('connected')
        return
      }
      const result = await fetchDashboardResources(user, token, next.signal)
      if (!next.signal.aborted) {
        const latestPayment = result.transactions[0]
        if (latestPayment && lastSnapshot.current?.user.id === result.user.id && !lastSnapshot.current.transactions.some((payment) => payment.id === latestPayment.id) && getPaymentAlerts(result.user.id)) {
          setToast(null)
          setNewPayment(latestPayment)
        }
        lastSnapshot.current = result
        setData(result)
        setServiceStatus('connected')
      }
    } catch (reason) {
      if (next.signal.aborted) return
      if (reason instanceof DashboardApiError && reason.status === 401) { endSession(); return }
      setServiceStatus('unavailable')
      setError(`We could not load your ${settingsOnly ? 'account' : 'dashboard'}. Check your connection and try again.`)
    } finally { if (!next.signal.aborted) setLoading(false) }
  }, [navigate, returnTo, settingsOnly, endSession, setToast, setNewPayment])

  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadDashboard() }); return () => { active = false; controller.current?.abort() } }, [loadDashboard])
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine) void loadDashboard()
      else setServiceStatus('unavailable')
    }
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void loadDashboard()
    }
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (window.innerWidth <= 767) { navigate('/app/activity'); window.requestAnimationFrame(() => mobileSearchRef.current?.focus()) } else searchRef.current?.focus() } }
    window.addEventListener('online', update); window.addEventListener('offline', update); window.addEventListener('keydown', shortcut)
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('keydown', shortcut); document.removeEventListener('visibilitychange', refreshOnReturn) }
  }, [loadDashboard, navigate])

  const handleLink = async (event: FormEvent) => {
    event.preventDefault()
    const id = bankAccountId.trim()
    if (linking) return
    if (!isValidBankAccountId(id)) { setLinkError('Enter a bank account ID using 3 to 50 digits.'); return }
    const token = localStorage.getItem('autowallet_token')
    if (!token) { endSession(); return }
    const signal = requestSignal()
    setLinking(true); setLinkError(null)
    try {
      const response = await apiFetch('/api/auth/link-bank-account', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bank_account_id: id }), signal })
      if (response.status === 401) { endSession(); return }
      if (!response.ok) { const payload = await response.json().catch(() => ({})); setLinkError(apiErrorDetail(payload, 'Could not link this account. Please try again.').message); return }
      setBankAccountId(''); await loadDashboard()
    } catch { if (!signal.aborted) setLinkError('The account link could not be confirmed. Refresh to check its status before trying again.') } finally { if (!signal.aborted) setLinking(false) }
  }

  const chooseView = (next: PageView) => {
    const path = next === 'home' ? '/dashboard' : `/app/${next}`
    if (location.pathname !== path) navigate(path)
    setMoreOpen(false)
    setNotificationOpen(false)
    setProfileOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const openPayment = (payment: DashboardTransaction) => {
    navigate(`/app/activity/${encodeURIComponent(payment.id)}`)
    setNotificationOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const askAssistant = (question: string) => {
    navigate('/app/assistant', { state: { question } })
    window.scrollTo({ top: 0 })
  }
  const openEnvelope = (type: WalletType) => {
    navigate(`/app/envelopes/${type}`)
    setMoreOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const user = account
  const liveStatus = usePaymentLiveUpdates({
    userId: user?.id ?? '',
    enabled: online && !settingsOnly && Boolean(user?.bank_account_id),
    onRefresh: loadDashboard,
    onSessionEnded: endSession,
  })
  const serviceLabel = serviceStatus === 'unavailable' ? 'Service unavailable' : serviceStatus === 'checking' ? 'Checking service'
    : !settingsOnly && liveStatus === 'connected' ? 'Live updates on'
      : !settingsOnly && liveStatus === 'reconnecting' ? 'Reconnecting updates'
        : !settingsOnly && liveStatus === 'unavailable' ? 'Live updates unavailable' : 'Service connected'
  const serviceShortLabel = serviceStatus === 'unavailable' ? 'Unavailable' : serviceStatus === 'checking' ? 'Checking'
    : !settingsOnly && liveStatus === 'connected' ? 'Live' : !settingsOnly && liveStatus === 'reconnecting' ? 'Retrying'
      : !settingsOnly && liveStatus === 'unavailable' ? 'Paused' : 'Connected'
  const initials = user?.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'AW'
  const payments = data?.transactions ?? []
  const paymentAlertsEnabled = usePaymentAlerts(user?.id ?? '')
  const notificationPayments = paymentAlertsEnabled ? payments : []
  const inbox = usePaymentNotifications(user?.id ?? '', notificationPayments)
  const recordAvailable = online && serviceStatus === 'connected' && Boolean(user?.bank_account_id)
  const selectedPayment = payments.find(payment => encodeURIComponent(payment.id) === paymentSegment)
  const title = view === 'home' ? 'Home' : view === 'payment-detail' ? 'Activity' : view === 'envelope-detail' ? 'Envelopes' : view.charAt(0).toUpperCase() + view.slice(1)
  const footer = <footer className="dashboard-footer"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><span>AutoWallet</span></footer>
  const errorNotice = error && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-lg bg-[#FFF0EF] px-4 py-3 text-sm text-[#A33B3B]"><span>{error}</span><button type="button" onClick={() => void loadDashboard()} className="font-semibold underline">Retry</button></div>

  return <div className={`dashboard-shell ${sidebarCollapsed ? 'dashboard-shell--collapsed' : ''} ${view === 'notifications' ? 'dashboard-shell--notifications' : ''} ${view === 'settings' ? 'dashboard-shell--settings' : ''}`}>
    <aside className="dashboard-sidebar"><button type="button" onClick={() => chooseView('home')} className="dashboard-logo" aria-label="AutoWallet Home"><img src="/AW.svg" alt="" /><span>AutoWallet</span></button><nav className="mt-10 space-y-1" aria-label="Main navigation">{nav.map(({ view: itemView, label, icon: Icon }) => <button key={itemView} type="button" onClick={() => chooseView(itemView)} className={`dashboard-nav-item ${(activeView === itemView || (activeView === 'envelope-detail' && itemView === 'envelopes') || (activeView === 'payment-detail' && itemView === 'activity')) ? 'dashboard-nav-item--active' : ''}`} title={label}><Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span>{label}</span></button>)}</nav><div className="dashboard-sidebar-demo"><p>DEMO</p><button type="button" onClick={() => chooseView('sandbox')} className={`dashboard-nav-item ${view === 'sandbox' ? 'dashboard-nav-item--active' : ''}`} title="Sandbox"><FlaskConical className="h-[18px] w-[18px] shrink-0" /><span>Sandbox</span></button></div><button type="button" onClick={() => setSidebarCollapsed((value) => !value)} className="dashboard-sidebar-collapse" title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}><PanelLeftClose className="h-4 w-4" /><span>Collapse sidebar</span></button></aside>
    <div className="dashboard-main-wrap"><header className="dashboard-header"><button type="button" onClick={() => chooseView('home')} className="dashboard-mobile-logo" aria-label="AutoWallet Home"><img src="/AW.svg" alt="" /><span>AutoWallet</span></button><div className="dashboard-header-title">{view === 'envelope-detail' && detailType ? <span className="dashboard-header-breadcrumb"><button type="button" onClick={() => chooseView('envelopes')}>Envelopes</button><ChevronRight className="h-4 w-4" aria-hidden="true" /><strong>{envelopeMeta[detailType].name}</strong></span> : view === 'payment-detail' ? <span className="dashboard-header-breadcrumb"><button onClick={() => chooseView('activity')}>Activity</button><ChevronRight className="h-4 w-4" /><strong>{selectedPayment?.reference ?? 'Payment'}</strong></span> : <strong>{title}</strong>}</div><div className="dashboard-header-tools"><span role="status" aria-label={serviceLabel} title={serviceLabel} className={`dashboard-live ${serviceStatus === 'unavailable' ? 'dashboard-live--offline' : serviceStatus === 'checking' || (!settingsOnly && (liveStatus === 'reconnecting' || liveStatus === 'unavailable')) ? 'dashboard-live--checking' : ''}`}><span className="h-1.5 w-1.5 rounded-full bg-current" /><span className="dashboard-status-full">{serviceLabel}</span><span className="dashboard-status-short">{serviceShortLabel}</span></span><label className="dashboard-search"><Search className="h-4 w-4" aria-hidden="true" /><input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value) chooseView('activity') }} placeholder="Search by reference" aria-label="Search by reference" /><kbd>⌘K</kbd></label><button type="button" onClick={() => { chooseView('activity'); window.requestAnimationFrame(() => mobileSearchRef.current?.focus()) }} className="dashboard-mobile-tool" aria-label="Search payments"><Search className="h-5 w-5" /></button><div className="relative" ref={notificationRef}><button type="button" aria-expanded={notificationOpen || view === 'notifications'} onClick={() => { if (window.innerWidth <= 767) navigate('/app/notifications', { state: { from: location.pathname } }); else setNotificationOpen(value => !value) }} className="dashboard-icon-button notification-bell" aria-label={`Notifications${inbox.unread ? `, ${inbox.unread} unread` : ''}`}><Bell className="h-5 w-5" />{inbox.unread > 0 && <span className="notification-count">{inbox.unread > 9 ? '9+' : inbox.unread}</span>}</button>{notificationOpen && <div className="notifications-popover"><NotificationsView enabled={paymentAlertsEnabled} onSettings={() => { navigate('/app/settings/notifications'); setNotificationOpen(false) }} compact payments={notificationPayments} readIds={inbox.readIds} unread={inbox.unread} onRead={inbox.markRead} onSelect={openPayment} onBack={() => chooseView('notifications')} /></div>}</div><div className="relative" ref={profileRef}><button type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)} className="dashboard-profile" aria-label="Account menu"><span>{initials}</span><ChevronDown className="h-4 w-4" /></button>{profileOpen && <div className="dashboard-popover right-0"><strong className="block truncate">{user?.full_name || 'AutoWallet'}</strong><p className="truncate">{user?.email}</p><button type="button" onClick={() => chooseView('settings')} className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#5963B6]"><Settings className="h-4 w-4" />Settings</button><button type="button" onClick={signOut} className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#5963B6]"><LogOut className="h-4 w-4" />Sign out</button></div>}</div></div></header>
      {!online && <div role="status" className="dashboard-offline"><AlertCircle className="h-4 w-4" />You're offline. We'll refresh when you're back.</div>}
      <main className={`dashboard-main ${view === 'assistant' ? 'dashboard-main--assistant' : ''}`}>{loading && !(settingsOnly ? user : data) ? ((view === 'envelopes' || view === 'envelope-detail') ? <EnvelopesSkeleton /> : view === 'activity' ? <ActivitySkeleton /> : <LoadingHome />) : settingsOnly && user ? <>{errorNotice}<Suspense fallback={<LoadingHome />}><SettingsView key={user.id} user={user} online={online} onSignOut={signOut} onSessionEnded={endSession} /></Suspense>{footer}</> : !data ? <section className="mx-auto mt-16 max-w-md rounded-xl bg-white p-8 text-center shadow-sm"><AlertCircle className="mx-auto h-9 w-9 text-[#C44D4D]" /><h1 className="mt-4 text-xl font-bold">{settingsOnly ? 'Settings unavailable' : 'Dashboard unavailable'}</h1><p role="alert" className="mt-2 text-sm text-[#66758D]">{error}</p><button type="button" onClick={() => void loadDashboard()} className="dashboard-primary-button mt-5">Try again</button></section> : <>{errorNotice}{!user?.bank_account_id ? <section className="mx-auto mt-10 max-w-xl rounded-xl bg-white p-7 shadow-sm"><Link2 className="h-9 w-9 text-[#5A64B4]" /><h1 className="mt-5 text-2xl font-bold">Link your bank account ID</h1><p className="mt-2 text-sm leading-6 text-[#65748C]">Add the account ID that receives your payments to see envelopes, transactions, and rules here. This records the ID with your profile; it does not connect to your bank or move money.</p><form onSubmit={(event) => void handleLink(event)} noValidate className="mt-5 flex flex-wrap items-end gap-3"><label className="min-w-[200px] flex-1 text-sm font-semibold">Bank account ID<input value={bankAccountId} onChange={(event) => { setBankAccountId(event.target.value); setLinkError(null) }} inputMode="numeric" pattern="[0-9]*" minLength={3} maxLength={50} required className="dashboard-input mt-2" placeholder="Enter your account ID" /></label><button type="submit" disabled={linking} className="dashboard-primary-button h-11">{linking ? 'Linking…' : 'Link account'}</button></form>{linkError && <p role="alert" className="mt-3 text-sm text-[#B53235]">{linkError}</p>}</section> : <>
        {view === 'home' ? <HomeView data={data} recordAvailable={recordAvailable} onNavigate={chooseView} onRecord={() => setRecordOpen(true)} onSelectPayment={openPayment} /> : view === 'envelopes' ? <EnvelopesView data={data} onOpen={openEnvelope} /> : view === 'envelope-detail' ? (detailType ? <EnvelopeDetailView type={detailType} data={data} onBack={() => chooseView('envelopes')} onViewRules={() => chooseView('rules')} onSelectPayment={openPayment} onAsk={askAssistant} /> : <section className="dashboard-subview"><h1>Envelope not found</h1><button type="button" onClick={() => chooseView('envelopes')} className="dashboard-primary-button mt-4">Back to Envelopes</button></section>) : view === 'rules' ? <RulesView data={data} onSaved={loadDashboard} onSessionEnded={endSession} /> : view === 'activity' ? <ActivityView payments={data.transactions} search={search} onSearchChange={setSearch} onSelect={openPayment} onRecord={() => setRecordOpen(true)} recordDisabled={!recordAvailable} searchInputRef={mobileSearchRef} /> : view === 'payment-detail' ? <PaymentDetailView paymentId={selectedPayment?.id ?? ''} data={data} onBack={() => chooseView('activity')} onRefresh={() => void loadDashboard()} /> : view === 'sandbox' ? <SandboxView data={data} /> : view === 'notifications' ? <NotificationsView enabled={paymentAlertsEnabled} onSettings={() => navigate('/app/settings/notifications')} payments={notificationPayments} readIds={inbox.readIds} unread={inbox.unread} onRead={inbox.markRead} onSelect={openPayment} onBack={() => { const from = location.state?.from; navigate(typeof from === 'string' && from !== '/app/notifications' && (from === '/dashboard' || from.startsWith('/app/')) ? from : '/dashboard') }} /> : <Suspense fallback={<LoadingHome />}>{view === 'analytics' ? <AnalyticsView key={data.user.id} data={data} onRecord={() => setRecordOpen(true)} recordDisabled={!recordAvailable} onAsk={askAssistant} onRules={() => chooseView('rules')} onRefresh={loadDashboard} onSessionEnded={endSession} /> : <AssistantView key={user?.id} data={data} online={online} onSessionEnded={endSession} />}</Suspense>}
        {footer}
      </>}</> }</main>
    </div>
    {(view === 'home' || view === 'activity') && <button type="button" onClick={() => setRecordOpen(true)} disabled={!online || serviceStatus !== 'connected' || !user?.bank_account_id} className="dashboard-mobile-record"><Plus className="h-4 w-4" />Record payment</button>}<nav ref={mobileNavRef} className="dashboard-mobile-nav" aria-label="Mobile navigation"><button type="button" onClick={() => chooseView('home')} className={activeView === 'home' ? 'is-active' : ''}><LayoutDashboard /><span>Home</span></button><button type="button" onClick={() => chooseView('rules')} className={activeView === 'rules' ? 'is-active' : ''}><ListOrdered /><span>Rules</span></button><button type="button" onClick={() => chooseView('activity')} className={activeView === 'activity' || activeView === 'payment-detail' ? 'is-active' : ''}><Clock3 /><span>Activity</span></button><button type="button" onClick={() => chooseView('assistant')} className={activeView === 'assistant' ? 'is-active' : ''}><MessageSquareText /><span>Assistant</span></button><button type="button" onClick={() => setMoreOpen((value) => !value)} className={['envelopes', 'envelope-detail', 'analytics', 'sandbox', 'settings'].includes(activeView) ? 'is-active' : ''}><Menu /><span>More</span></button></nav>{moreOpen && <div className="dashboard-more-menu" ref={moreRef}><button type="button" onClick={() => chooseView('envelopes')}>Envelopes</button><button type="button" onClick={() => chooseView('analytics')}>Analytics</button><button type="button" onClick={() => chooseView('sandbox')}>Sandbox</button><button type="button" onClick={() => chooseView('settings')}>Settings</button><button type="button" onClick={signOut}>Sign out</button></div>}
    {newPayment && paymentAlertsEnabled && <div role="status" className="dashboard-toast dashboard-toast--payment"><ArrowDownLeft className="h-4 w-4 shrink-0 text-[#5963B6]" aria-hidden="true" /><div><strong>+{money.format(newPayment.amount)} MAD from {newPayment.reference}</strong><p>Your envelope balances have been refreshed.</p><button type="button" onClick={() => { openPayment(newPayment); setNewPayment(null) }}>{newPayment.allocations ? 'View split' : 'View payment'}</button></div><button type="button" onClick={() => setNewPayment(null)} aria-label="Dismiss payment notification"><X className="h-4 w-4" /></button></div>}
    {toast && <div role="status" className="dashboard-toast"><Check className="h-4 w-4 text-[#19854A]" /><span>{toast}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X className="h-4 w-4" /></button></div>}
    {recordOpen && <RecordPaymentDialog onClose={() => setRecordOpen(false)} available={recordAvailable} onSessionEnded={endSession} onRecorded={reference => { setRecordOpen(false); setToast(`Payment ${reference} recorded.`); void loadDashboard() }} />}
  </div>
}

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Bell, Check, ChevronRight, Copy, KeyRound, LockKeyhole, LogOut, Monitor, Moon, Palette, Shield, Sun, UserRound } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { DashboardUser } from '../Dashboard/dashboardApi'
import { SecuritySettings } from './SecuritySettings'
import { PrivacySettings } from './PrivacySettings'
import { unknownSecurity } from '../../api/settingsApi'
import { savePaymentAlerts, saveTheme, usePaymentAlerts, useThemePreference } from './settingsPreferences'
import type { ThemePreference } from './settingsPreferences'
import './settings.css'

const sections = [
  { path: 'profile', label: 'Profile', icon: UserRound },
  { path: 'security', label: 'Security', icon: Shield },
  { path: 'sessions', label: 'Sessions', icon: Monitor },
  { path: 'privacy', label: 'Privacy and data', icon: LockKeyhole },
  { path: 'notifications', label: 'Notifications', icon: Bell },
  { path: 'appearance', label: 'Appearance', icon: Palette },
  { path: 'api-keys', label: 'API keys', icon: KeyRound },
] as const

function AccountIdentity({ user, role }: { user: DashboardUser; role?: string | null }) {
  const initials = user.full_name.trim().split(/\s+/).slice(0, 2).map(name => name[0]).join('').toUpperCase()
  return <div className="settings-identity"><span className="settings-avatar">{initials || 'AW'}</span><div><div className="settings-identity-title"><strong>{user.full_name}</strong>{role && <span className="workspace-tag"><UserRound size={12} />{role === 'admin' ? 'Admin' : 'User'}</span>}</div><span>{user.email}</span></div></div>
}

export function SettingsView({ user, online, onSignOut, onSessionEnded }: { user: DashboardUser; online: boolean; onSignOut: () => void; onSessionEnded: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const segment = location.pathname.match(/^\/app\/settings\/([^/]+)$/)?.[1]
  const section = sections.find(item => item.path === segment)
  const isIndex = !segment
  const [security, setSecurity] = useState(unknownSecurity)
  const [notice, setNotice] = useState<string | null>(null)
  const theme = useThemePreference()
  const paymentsEnabled = usePaymentAlerts(user.id)
  const deleted = () => {
    try {
      localStorage.removeItem('autowallet_token')
      localStorage.removeItem(`autowallet_payment_alerts:${user.id}`)
      localStorage.removeItem(`autowallet_notification_reads:${user.id}`)
    } finally { navigate('/login', { replace: true, state: { accountDeleted: true } }) }
  }
  const profile = <section className="workspace-card settings-card settings-profile"><h2>Profile</h2><p>How you appear in AutoWallet and where we reach you.</p><AccountIdentity user={user} role={security.role} /><div className="settings-form"><label>Full name<input className="dashboard-input" value={user.full_name} readOnly autoComplete="name" aria-describedby="profile-unavailable" /></label><label>Email<input className="dashboard-input" type="email" value={user.email} readOnly autoComplete="email" aria-describedby="profile-unavailable" /><span className="workspace-note">Used for account emails.</span></label><label>Linked account<input className="dashboard-input settings-readonly" value={user.bank_account_id ? `•••• ${user.bank_account_id.slice(-4)}` : 'Not linked'} readOnly /><span className="workspace-note">Payments into this account are split using your saved rules.</span></label><button className="dashboard-primary-button" disabled>Save changes</button></div><p id="profile-unavailable" className="settings-availability">Your profile is read-only until the account service supports profile updates.</p></section>

  return <div className={`workspace-page settings-page ${isIndex ? 'settings-page--index' : 'settings-page--section'}`}>
    <header className="workspace-heading settings-heading"><div><h1>Settings</h1><p>Your profile, security, data and preferences.</p></div></header>
    <div className="settings-mobile-index"><Link className="workspace-card settings-account-link" to="/app/settings/profile"><AccountIdentity user={user} /><ChevronRight size={18} /></Link></div>
    <div className="settings-layout"><nav className="settings-section-nav" aria-label="Settings sections">{sections.map(({ path, label, icon: Icon }) => <NavLink key={path} to={`/app/settings/${path}`} onClick={() => setNotice(null)} className={({ isActive }) => `settings-section-link ${isActive || isIndex && path === 'profile' ? 'settings-section-link--active' : ''}`}><Icon size={18} /><span>{label}</span><ChevronRight className="settings-section-chevron" size={16} /></NavLink>)}</nav>
      <div id="settings-content" className="settings-content">
        {segment && <><Link className="workspace-back settings-mobile-back" to="/app/settings"><ArrowLeft size={16} />Settings</Link><h1 className="settings-mobile-title">{section?.label ?? 'Section not found'}</h1></>}
        {!isIndex && !section ? <section className="workspace-card workspace-empty"><h2>Settings section not found</h2><Link className="dashboard-primary-button" to="/app/settings">Back to Settings</Link></section> : isIndex || segment === 'profile' ? profile : segment === 'security' ? <SecuritySettings email={user.email} info={security} onEnabled={enabled => setSecurity(info => ({ ...info, twoFactorEnabled: enabled }))} onSessionEnded={onSessionEnded} online={online} /> : segment === 'sessions' ? <SessionsSettings onSignOut={onSignOut} /> : segment === 'privacy' ? <PrivacySettings email={user.email} online={online} onSecurityInfo={setSecurity} onSessionEnded={onSessionEnded} onDeleted={deleted} /> : segment === 'notifications' ? <NotificationSettings paymentsEnabled={paymentsEnabled} onToggle={enabled => { const saved = savePaymentAlerts(user.id, enabled); setNotice(saved ? 'Saved on this browser.' : 'Changed for this visit. Browser storage is unavailable.') }} /> : segment === 'appearance' ? <AppearanceSettings theme={theme} onChange={value => { const saved = saveTheme(value); setNotice(saved ? 'Theme saved on this browser.' : 'Theme changed for this visit. Browser storage is unavailable.') }} /> : <ApiKeysSettings />}
        {notice && <p className="settings-save-status" role="status"><Check size={14} />{notice}</p>}
      </div>
    </div>
    <button className="settings-mobile-signout settings-outline-button" onClick={onSignOut}><LogOut size={17} />Log out</button>
  </div>
}

function SessionsSettings({ onSignOut }: { onSignOut: () => void }) {
  let expires = ''
  try {
    const payload = localStorage.getItem('autowallet_token')?.split('.')[1]
    if (payload) {
      const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
      if (typeof claims.exp === 'number' && Number.isFinite(new Date(claims.exp * 1000).getTime())) expires = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(claims.exp * 1000))
    }
  } catch { /* The account service remains responsible for validating the token. */ }
  return <section className="workspace-card settings-card"><h2>Where you’re logged in</h2><p>Manage your sign-in on this browser.</p><div className="settings-session"><span className="settings-session-icon"><Monitor size={20} /></span><div><strong>This browser</strong><p>Active now{expires ? ` · Token expires ${expires}` : ''}</p></div><span className="workspace-tag">This device</span></div><div className="settings-actions"><button className="settings-outline-button" onClick={onSignOut}><LogOut size={16} />Log out of this browser</button><button className="settings-danger-outline" disabled>Log out everywhere else</button></div><p className="settings-availability">The account service does not list other sessions or support revoking them yet. Logging out removes the sign-in token from this browser.</p></section>
}

function NotificationSettings({ paymentsEnabled, onToggle }: { paymentsEnabled: boolean; onToggle: (enabled: boolean) => void }) {
  const rows = [
    { name: 'Payments', description: 'When a payment appears after your dashboard refreshes.', app: paymentsEnabled, email: false, adjustable: true },
    { name: 'Rule changes', description: 'Rule change notifications are not available yet.', app: false, email: false },
    { name: 'Data export', description: 'The account service attempts an email confirmation when you request an export.', app: false, email: true },
    { name: 'Security', description: 'Required account emails are managed by the account service.', app: false, email: true },
  ]
  return <section className="workspace-card settings-card"><h2>What we tell you about</h2><p>Choose whether payment updates appear in this browser. This preference saves as you change it.</p><div className="settings-notification-rows">{rows.map(row => <div key={row.name} className="settings-notification-row"><div><h3>{row.name}</h3><p>{row.description}</p></div><div className="settings-notification-switches"><label><input type="checkbox" role="switch" checked={row.app} disabled={!row.adjustable} onChange={event => onToggle(event.target.checked)} aria-label={`${row.name}, In the app`} /><span className="settings-switch-track" aria-hidden="true" />In the app</label><label><input type="checkbox" role="switch" checked={row.email} disabled readOnly aria-label={`${row.name}, Email`} /><span className="settings-switch-track" aria-hidden="true" />Email</label></div></div>)}</div><p className="settings-availability">Other channels are read-only until notification preferences are supported by the service. Turning off payment alerts does not hide payments from Activity.</p></section>
}

function AppearanceSettings({ theme, onChange }: { theme: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return <><section className="workspace-card settings-card"><h2>Display language</h2><p>AutoWallet is available in English.</p><div className="settings-language"><Check size={16} /><div><strong>English</strong><p>8,500.00 MAD · Sep 23, 2026</p></div></div></section><section className="workspace-card settings-card"><h2>Theme</h2><p>System follows the light or dark setting on your device. Your choice is saved in this browser.</p><fieldset className="settings-theme-options"><legend className="sr-only">Theme</legend>{([{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <label key={value}><input type="radio" name="theme" value={value} checked={theme === value} onChange={() => onChange(value)} /><span><Icon size={15} />{label}</span></label>)}</fieldset></section></>
}

function ApiKeysSettings() {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const example = 'curl "$AUTOWALLET_URL/api/wallets/" -H "Authorization: Bearer $AUTOWALLET_TOKEN"'
  return <><section className="workspace-card settings-card"><h2>API keys</h2><p>Use a key to reach your AutoWallet data from your own scripts. Treat it like a password.</p><div className="settings-empty-keys"><KeyRound size={22} /><div><strong>Personal API keys aren’t available yet</strong><p>The account service does not support creating, listing or revoking keys.</p></div></div><button className="dashboard-primary-button" disabled><KeyRound size={16} />Create key</button></section><section className="workspace-card settings-card"><h2>Try it</h2><p>Read your envelopes with cURL. This example uses a sign-in token, not a personal API key. Set AUTOWALLET_URL and AUTOWALLET_TOKEN in your own terminal.</p><div className="settings-code-block"><header><span>cURL</span><button onClick={() => { if (!navigator.clipboard) { setCopyError(true); return }; void navigator.clipboard.writeText(example).then(() => { setCopied(true); setCopyError(false) }).catch(() => setCopyError(true)) }}><span>{copied ? <Check size={15} /> : <Copy size={15} />}</span>{copied ? 'Copied' : 'Copy'}</button></header><pre><code>{example}</code></pre></div>{copyError && <p className="workspace-field-error" role="alert">Could not copy. Select the example and copy it manually.</p>}<button className="workspace-text-button" aria-expanded={referenceOpen} onClick={() => setReferenceOpen(value => !value)}>{referenceOpen ? 'Hide endpoint reference' : 'View endpoint reference'}<ArrowRight size={14} /></button>{referenceOpen && <div className="settings-api-reference"><h3>GET /api/wallets/</h3><p>Returns your linked account’s envelopes. Requires a valid Bearer token.</p><dl className="settings-data-list"><div><dt>id</dt><dd>string · Envelope ID</dd></div><div><dt>wallet_type</dt><dd>main, rent, tax, savings or free</dd></div><div><dt>balance</dt><dd>number · Amount in MAD</dd></div></dl></div>}</section></>
}

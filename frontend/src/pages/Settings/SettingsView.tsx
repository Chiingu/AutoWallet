import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Copy,
  Globe,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
} from 'lucide-react'
import type { DashboardAccount } from '../Dashboard/dashboardApi'
import {
  SettingsApiError,
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  updateProfile,
} from '../../api/settingsApi'
import type { ApiKeyItem } from '../../api/settingsApi'
import { PrivacySettings } from './PrivacySettings'
import { SecuritySettings } from './SecuritySettings'
import {
  savePaymentAlerts,
  usePaymentAlerts,
} from './settingsPreferences'
import type { ThemePreference } from './settingsPreferences'
import './settings.css'

export type SettingsSection = 'account' | 'security' | 'privacy' | 'notifications' | 'preferences' | 'developer'

interface SettingsViewProps {
  account: DashboardAccount
  online: boolean
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  onLinkAccount: (bankAccountId: string) => Promise<void>
  onRefresh: () => Promise<void>
  onSignOut: () => void
  onSessionEnded: () => void
  onDeleted: () => void
}

const sections: { id: SettingsSection; label: string; icon: typeof User }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'privacy', label: 'Data & privacy', icon: Globe },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'developer', label: 'API & webhooks', icon: KeyRound },
]

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AW'
}

export function SettingsView({
  account,
  online,
  theme,
  onThemeChange,
  onLinkAccount,
  onRefresh,
  onSignOut,
  onSessionEnded,
  onDeleted,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>('account')
  const [mobileIndex, setMobileIndex] = useState(true)
  const [fullNameDraft, setFullNameDraft] = useState<string | null>(null)
  const [emailDraft, setEmailDraft] = useState<string | null>(null)
  const fullName = fullNameDraft ?? account.full_name
  const emailInput = emailDraft ?? account.email
  const setFullName = (value: string) => setFullNameDraft(value)
  const setEmailInput = (value: string) => setEmailDraft(value)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileNotice, setProfileNotice] = useState<string | null>(null)

  const [bankDraft, setBankDraft] = useState('')
  const [bankError, setBankError] = useState<string | null>(null)
  const [bankNotice, setBankNotice] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [twoFactorOverride, setTwoFactorOverride] = useState<boolean | null>(null)
  const twoFactorHint = twoFactorOverride ?? account.is_2fa_enabled ?? null
  const setTwoFactorHint = (value: boolean | null) => setTwoFactorOverride(value)
  const [signsInWith, setSignsInWith] = useState<string | null>(
    account.has_password === false ? 'google' : 'password',
  )
  const [role, setRole] = useState<string | null>(account.role ?? null)
  const paymentAlertsEnabled = usePaymentAlerts(account.id)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [copiedCurl, setCopiedCurl] = useState(false)

  // Personal API keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [keysLoading, setKeysLoading] = useState(false)
  const [keyNameDraft, setKeyNameDraft] = useState('')
  const [keyCreating, setKeyCreating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copiedNewKey, setCopiedNewKey] = useState(false)

  useEffect(() => {
    if (section !== 'developer' || !online) return
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setKeysLoading(true)
      fetchApiKeys(controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setApiKeys(items)
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          if (err instanceof SettingsApiError && err.status === 401) onSessionEnded()
        })
        .finally(() => {
          if (!controller.signal.aborted) setKeysLoading(false)
        })
    })
    return () => controller.abort()
  }, [section, online, onSessionEnded])

  const openSection = (next: SettingsSection) => {
    setSection(next)
    setMobileIndex(false)
    setSavedNotice(null)
  }

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = fullName.trim()
    const trimmedEmail = emailInput.trim().toLowerCase()
    if (!trimmedName) {
      setProfileError('Enter your full name.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setProfileError('Enter a valid email address.')
      return
    }
    setProfileSaving(true)
    setProfileError(null)
    setProfileNotice(null)
    try {
      await updateProfile({ full_name: trimmedName, email: trimmedEmail })
      await onRefresh()
      setFullNameDraft(null)
      setEmailDraft(null)
      setProfileNotice('Your profile has been updated.')
    } catch (reason) {
      if (reason instanceof SettingsApiError && reason.status === 401) {
        onSessionEnded()
        return
      }
      setProfileError(reason instanceof Error ? reason.message : 'Could not update your profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const submitBankLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = bankDraft.trim()
    if (!/^\d{3,34}$/.test(trimmed)) {
      setBankError('Enter 3 to 34 digits. Letters and spaces are not accepted.')
      return
    }
    setLinking(true)
    setBankError(null)
    setBankNotice(null)
    try {
      await onLinkAccount(trimmed)
      setBankDraft('')
      setBankNotice('Your bank account ID is linked.')
    } catch (reason) {
      setBankError(reason instanceof Error ? reason.message : 'Could not link this bank account ID.')
    } finally {
      setLinking(false)
    }
  }

  const refreshProfile = async () => {
    setRefreshing(true)
    setBankNotice(null)
    try {
      await onRefresh()
      setBankNotice('Account details refreshed.')
    } finally {
      setRefreshing(false)
    }
  }

  const updatePaymentAlerts = (enabled: boolean) => {
    savePaymentAlerts(account.id, enabled)
    setSavedNotice('Saved in this browser')
  }

  const handleCreateKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = keyNameDraft.trim()
    if (!trimmed) {
      setKeyError('Enter a descriptive name for your API key.')
      return
    }
    setKeyCreating(true)
    setKeyError(null)
    setNewlyCreatedKey(null)
    try {
      const created = await createApiKey(trimmed)
      setApiKeys((prev) => [created, ...prev])
      setKeyNameDraft('')
      if (created.secret_key) {
        setNewlyCreatedKey(created.secret_key)
        setCopiedNewKey(false)
      }
    } catch (err) {
      if (err instanceof SettingsApiError && err.status === 401) {
        onSessionEnded()
        return
      }
      setKeyError(err instanceof Error ? err.message : 'Could not create API key.')
    } finally {
      setKeyCreating(false)
    }
  }

  const handleRevokeKey = async (id: string) => {
    try {
      await revokeApiKey(id)
      setApiKeys((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      if (err instanceof SettingsApiError && err.status === 401) {
        onSessionEnded()
        return
      }
      setKeyError(err instanceof Error ? err.message : 'Could not revoke API key.')
    }
  }

  const curlExample = `curl -X POST ${window.location.origin}/api/transactions/ \\
  -H "Authorization: Bearer <your_access_or_api_key>" \\
  -H "Content-Type: application/json" \\
  -d '{"reference":"INV-2026-048","amount":8500}'`

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlExample)
      setCopiedCurl(true)
    } catch {
      setCopiedCurl(false)
    }
  }

  const activeSection = sections.find((item) => item.id === section) ?? sections[0]
  const profileDirty =
    fullName.trim() !== account.full_name ||
    emailInput.trim().toLowerCase() !== account.email.toLowerCase()

  return (
    <div className={`workspace-page settings-page ${mobileIndex ? 'settings-page--index' : 'settings-page--section'}`}>
      <header className="workspace-heading settings-heading">
        <div>
          <h1>Settings</h1>
          <p>Manage your account, security, data rights, and browser preferences.</p>
        </div>
      </header>

      <div className="settings-mobile-index">
        <button type="button" className="workspace-card settings-account-link" onClick={() => openSection('account')}>
          <span className="settings-identity">
            <span className="settings-avatar">{initials(account.full_name)}</span>
            <span>
              <strong className="settings-identity-title">{account.full_name}</strong>
              <span>{account.email}</span>
            </span>
          </span>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="settings-layout">
        <nav className="settings-section-nav" aria-label="Settings sections">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`settings-section-link ${section === id ? 'settings-section-link--active' : ''}`}
              onClick={() => openSection(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
              <ChevronRight size={14} className="settings-section-chevron" />
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <button type="button" className="workspace-back settings-mobile-back" onClick={() => setMobileIndex(true)}>
            <ArrowLeft size={14} />
            Settings
          </button>
          <h2 className="settings-mobile-title">{activeSection.label}</h2>

          {section === 'account' && (
            <>
              <section className="workspace-card settings-card settings-profile">
                <h2>Profile</h2>
                <p>Your identity details for this AutoWallet account.</p>
                <div className="settings-identity">
                  <span className="settings-avatar">{initials(fullName || account.full_name)}</span>
                  <div>
                    <strong className="settings-identity-title">
                      {fullName || account.full_name}
                      {role && <span className="workspace-tag">{role}</span>}
                    </strong>
                    <span>{emailInput || account.email}</span>
                  </div>
                </div>

                <form className="settings-form" onSubmit={(event) => void handleSaveProfile(event)} noValidate>
                  <label htmlFor="profile-full-name">
                    Full name
                    <input
                      id="profile-full-name"
                      className="dashboard-input"
                      value={fullName}
                      onChange={(event) => {
                        setFullName(event.target.value)
                        setProfileError(null)
                        setProfileNotice(null)
                      }}
                      disabled={!online || profileSaving}
                      maxLength={100}
                    />
                  </label>
                  <label htmlFor="profile-email">
                    Email address
                    <input
                      id="profile-email"
                      type="email"
                      className="dashboard-input"
                      value={emailInput}
                      onChange={(event) => {
                        setEmailInput(event.target.value)
                        setProfileError(null)
                        setProfileNotice(null)
                      }}
                      disabled={!online || profileSaving}
                    />
                  </label>

                  {profileError && (
                    <p className="workspace-field-error" role="alert">
                      {profileError}
                    </p>
                  )}
                  {profileNotice && (
                    <p className="workspace-note" role="status">
                      {profileNotice}
                    </p>
                  )}

                  <div className="settings-actions">
                    <button
                      type="submit"
                      className="dashboard-primary-button"
                      disabled={!online || profileSaving || !profileDirty}
                    >
                      {profileSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      className="settings-outline-button"
                      disabled={!online || refreshing}
                      onClick={() => void refreshProfile()}
                    >
                      <RefreshCw size={14} />
                      {refreshing ? 'Refreshing…' : 'Refresh profile'}
                    </button>
                  </div>
                </form>
              </section>

              <section className="workspace-card settings-card">
                <h2>Connected bank account</h2>
                <p>Incoming payments for this bank account ID are split by your active rules.</p>
                {bankNotice && <p className="workspace-note" role="status">{bankNotice}</p>}
                {account.bank_account_id ? (
                  <div className="settings-form">
                    <label>
                      Bank account ID
                      <input className="dashboard-input settings-readonly" readOnly value={account.bank_account_id} />
                      <span className="workspace-note">This account ID is linked and ready to receive payments.</span>
                    </label>
                  </div>
                ) : (
                  <form className="settings-form" onSubmit={(event) => void submitBankLink(event)} noValidate>
                    <label htmlFor="settings-bank-id">
                      Bank account ID
                      <input
                        id="settings-bank-id"
                        className="dashboard-input"
                        inputMode="numeric"
                        value={bankDraft}
                        onChange={(event) => { setBankDraft(event.target.value); setBankError(null) }}
                        placeholder="00100000042"
                        aria-invalid={Boolean(bankError)}
                      />
                      {bankError && <span className="workspace-field-error" role="alert">{bankError}</span>}
                    </label>
                    <button type="submit" className="dashboard-primary-button" disabled={!online || linking}>
                      {linking ? 'Linking…' : 'Link bank account'}
                    </button>
                  </form>
                )}
              </section>
            </>
          )}

          {section === 'security' && (
            <SecuritySettings
              email={account.email}
              online={online}
              twoFactorHint={twoFactorHint}
              signsInWith={signsInWith}
              onSessionEnded={onSessionEnded}
              onTwoFactorChanged={(isEnabled) => {
                setTwoFactorHint(isEnabled)
                void onRefresh()
              }}
            />
          )}

          {section === 'privacy' && (
            <PrivacySettings
              email={account.email}
              online={online}
              onSecurityInfo={(info) => {
                if (typeof info.two_factor_enabled === 'boolean') setTwoFactorHint(info.two_factor_enabled)
                if (info.signs_in_with) setSignsInWith(info.signs_in_with)
                if (info.role) setRole(info.role)
              }}
              onSessionEnded={onSessionEnded}
              onDeleted={onDeleted}
            />
          )}

          {section === 'notifications' && (
            <section className="workspace-card settings-card">
              <div className="workspace-title-row">
                <h2>Notifications</h2>
                {savedNotice && <span className="settings-save-status" role="status"><Check size={14} />{savedNotice}</span>}
              </div>
              <p>Choose which live alerts appear while AutoWallet is open in this browser.</p>
              <div className="settings-notification-rows">
                <div className="settings-notification-row">
                  <div>
                    <h3>Payment received</h3>
                    <p>Show a live banner and add an item to the notification bell when a payment is processed.</p>
                  </div>
                  <div className="settings-notification-switches">
                    <label>
                      <input
                        type="checkbox"
                        checked={paymentAlertsEnabled}
                        onChange={(event) => updatePaymentAlerts(event.target.checked)}
                      />
                      <span className="settings-switch-track" aria-hidden="true" />
                      In-app
                    </label>
                  </div>
                </div>
                <div className="settings-notification-row">
                  <div>
                    <h3>Security emails</h3>
                    <p>Verification, password reset, and account deletion codes are always sent when you request those actions.</p>
                  </div>
                  <div className="settings-notification-switches">
                    <label>
                      <input type="checkbox" checked disabled />
                      <span className="settings-switch-track" aria-hidden="true" />
                      Required
                    </label>
                  </div>
                </div>
              </div>
            </section>
          )}

          {section === 'preferences' && (
            <>
              <section className="workspace-card settings-card">
                <h2>Appearance</h2>
                <p>Choose how the dashboard looks on this device.</p>
                <div className="settings-theme-options" role="radiogroup" aria-label="Appearance">
                  {([
                    ['light', 'Light', Sun],
                    ['dark', 'Dark', Moon],
                    ['system', 'System', Monitor],
                  ] as const).map(([value, label, Icon]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="dashboard-theme"
                        value={value}
                        checked={theme === value}
                        onChange={() => { onThemeChange(value); setSavedNotice('Saved in this browser') }}
                      />
                      <span><Icon size={14} />{label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="workspace-card settings-card">
                <h2>Currency &amp; language</h2>
                <div className="settings-language">
                  <Globe size={18} />
                  <div>
                    <strong>Moroccan Dirham (MAD) · English</strong>
                    <p>All envelope balances, rules, and payment splits are calculated and displayed in MAD.</p>
                  </div>
                </div>
              </section>
            </>
          )}

          {section === 'developer' && (
            <section className="workspace-card settings-card">
              <h2>API &amp; webhooks</h2>
              <p>Create personal API keys to record incoming client payments or query your envelopes programmatically.</p>

              <form className="settings-form" onSubmit={(event) => void handleCreateKey(event)} noValidate>
                <label htmlFor="new-api-key-name">
                  New API key name
                  <input
                    id="new-api-key-name"
                    className="dashboard-input"
                    value={keyNameDraft}
                    onChange={(event) => {
                      setKeyNameDraft(event.target.value)
                      setKeyError(null)
                    }}
                    placeholder="e.g. Invoicing webhook"
                    maxLength={60}
                    disabled={!online || keyCreating}
                  />
                </label>
                {keyError && (
                  <p className="workspace-field-error" role="alert">
                    {keyError}
                  </p>
                )}
                <button
                  type="submit"
                  className="dashboard-primary-button"
                  disabled={!online || keyCreating || !keyNameDraft.trim()}
                >
                  <Plus size={15} />
                  {keyCreating ? 'Creating…' : 'Create API key'}
                </button>
              </form>

              {newlyCreatedKey && (
                <div className="settings-code-block" role="status">
                  <header>
                    <span>Copy your new API key now — it won&apos;t be shown again</span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(newlyCreatedKey)
                          .then(() => setCopiedNewKey(true))
                          .catch(() => setCopiedNewKey(false))
                      }}
                    >
                      {copiedNewKey ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedNewKey ? 'Copied' : 'Copy key'}</span>
                    </button>
                  </header>
                  <pre><code>{newlyCreatedKey}</code></pre>
                </div>
              )}

              {keysLoading ? (
                <p className="workspace-note">Loading API keys…</p>
              ) : apiKeys.length === 0 ? (
                <div className="settings-empty-keys">
                  <KeyRound size={20} />
                  <div>
                    <strong>No personal API keys yet</strong>
                    <p>Create a personal key above to authenticate external scripts or invoice webhooks without exposing your browser session.</p>
                  </div>
                </div>
              ) : (
                <dl className="settings-data-list" aria-label="Personal API keys">
                  {apiKeys.map((keyItem) => (
                    <div key={keyItem.id}>
                      <dt>
                        <strong className="text-[var(--aw-ink)]">{keyItem.name}</strong>
                        <span className="ml-2 font-mono text-xs">{keyItem.prefix}</span>
                      </dt>
                      <dd className="flex items-center gap-3">
                        <span className="text-xs text-[var(--aw-muted)]">
                          Created {new Date(keyItem.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <button
                          type="button"
                          className="settings-danger-outline"
                          onClick={() => void handleRevokeKey(keyItem.id)}
                          disabled={!online}
                          aria-label={`Revoke ${keyItem.name}`}
                        >
                          <Trash2 size={13} />
                          Revoke
                        </button>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="settings-api-reference">
                <h3>POST /api/transactions/</h3>
                <p>Authenticated requests with your personal API key or Bearer token record a payment and run your active envelope rules.</p>
                <div className="settings-code-block">
                  <header>
                    <span>cURL example</span>
                    <button type="button" onClick={() => void copyCurl()}>
                      {copiedCurl ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedCurl ? 'Copied' : 'Copy'}</span>
                    </button>
                  </header>
                  <pre><code>{curlExample}</code></pre>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <button type="button" className="settings-danger-outline settings-mobile-signout" onClick={onSignOut}>
        <LogOut size={15} />
        Log out
      </button>
    </div>
  )
}

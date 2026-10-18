import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Loader2, AlertCircle } from 'lucide-react'
import { translations } from '../../i18n'
import { TopBar } from '../../components/common/TopBar'
import { Stepper } from '../../components/common/Stepper'
import { Step1About } from './steps/Step1About'
import { Step2Account } from './steps/Step2Account'
import { Step3Envelopes } from './steps/Step3Envelopes'
import { Step4Rules } from './steps/Step4Rules'
import { Step5TryPayment } from './steps/Step5TryPayment'
import { onboardingPaths } from './routes'
import { clearSignupCredentials, getSignupPassword } from '../../auth/pendingCredentials'
import { isValidBankAccountId } from '../../auth/validation'
import { isValidRuleValue } from '../../utils/format'
import { clearSignupDraft, parseSignupDraft, readSignupDraft, writeSignupDraft } from '../../auth/signupDraft'
import type { SignupDraft } from '../../auth/signupDraft'
import { apiFetch } from '../../api/request'
import { apiErrorDetail } from '../../api/errors'
import { useRequestSignal } from '../../hooks/useRequestSignal'

const normalizeRuleValue = (value: string | undefined, fallback: string) =>
  value ? value.replaceAll(',', '').trim() || fallback : fallback

export function OnboardingPage() {
  const t = translations
  const navigate = useNavigate()
  const location = useLocation()
  const requestSignal = useRequestSignal()

  // Derive step directly from URL route
  const step = onboardingPaths.indexOf(location.pathname as typeof onboardingPaths[number]) + 1

  const [draft] = useState(() => ({ ...readSignupDraft(), ...parseSignupDraft(location.state) }))
  const draftEmail = draft.email || ''
  const [draftPassword] = useState(() => getSignupPassword(draftEmail) || '')
  const [registered, setRegistered] = useState(Boolean(draft.registered))

  useEffect(() => {
    if (!draftEmail || !draftPassword) {
      const path = draft.registered ? '/login' : '/signup'
      const emailQuery = draftEmail ? `?email=${encodeURIComponent(draftEmail)}` : ''
      navigate(`${path}${emailQuery}`, { replace: true })
    }
  }, [draft.registered, draftEmail, draftPassword, navigate])

  useEffect(() => {
    if (registered && step < 3) navigate('/welcome/envelopes', { replace: true })
  }, [navigate, registered, step])

  const [firstName, setFirstName] = useState(draft.firstName || '')
  const [lastName, setLastName] = useState(draft.lastName || '')
  const [bankAccount, setBankAccount] = useState(draft.bankAccount || '')

  // Step 4 Rule customization states (Figma #118:1359)
  const [rentAmount, setRentAmount] = useState(normalizeRuleValue(draft.rentAmount, '3500'))
  const [taxPercent, setTaxPercent] = useState(normalizeRuleValue(draft.taxPercent, '15'))
  const [savingsPercent, setSavingsPercent] = useState(normalizeRuleValue(draft.savingsPercent, '15'))
  const [savingsCap, setSavingsCap] = useState(normalizeRuleValue(draft.savingsCap, '10000'))

  // Step 5 Simulation states (Figma #119:1613)
  const [simulatedAmount, setSimulatedAmount] = useState('8,500.00')
  const [hasSimulated, setHasSimulated] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)

  const simulationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (simulationTimer.current) clearTimeout(simulationTimer.current) }, [])

  const handleSimulate = () => {
    if (isSimulating) return
    setIsSimulating(true)
    simulationTimer.current = setTimeout(() => {
      setIsSimulating(false)
      setHasSimulated(true)
    }, 700)
  }

  // Submission & Validation States
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [firstNameError, setFirstNameError] = useState<string | null>(null)
  const [lastNameError, setLastNameError] = useState<string | null>(null)
  const [bankAccountError, setBankAccountError] = useState<string | null>(
    draft.bankAccountError ?? null,
  )

  const persistDraft = (extra: Partial<SignupDraft> = {}) => {
    writeSignupDraft({
      ...readSignupDraft(), email: draftEmail, firstName, lastName, bankAccount,
      rentAmount, taxPercent, savingsPercent, savingsCap, registered, ...extra,
    })
  }

  const handleStep1Continue = (e?: FormEvent) => {
    if (e) e.preventDefault()
    let hasErr = false

    if (!firstName.trim() || firstName.trim().length < 2) {
      setFirstNameError(t.firstNameRequired)
      hasErr = true
    } else {
      setFirstNameError(null)
    }

    if (!lastName.trim() || lastName.trim().length < 2) {
      setLastNameError(t.lastNameRequired)
      hasErr = true
    } else {
      setLastNameError(null)
    }

    if (hasErr) {
      setErrorMessage(
        !firstName.trim() || firstName.trim().length < 2
          ? t.firstNameRequired
          : t.lastNameRequired
      )
      return
    }

    setErrorMessage(null)
    persistDraft({ firstName: firstName.trim(), lastName: lastName.trim() })
    navigate('/welcome/account')
  }

  const handleStep2Continue = async () => {
    if (loading || registered) return
    setErrorMessage(null)
    setBankAccountError(null)

    const cleanAcc = bankAccount.trim()
    if (!cleanAcc) {
      setBankAccountError(t.bankAccountRequired)
      setErrorMessage(t.bankAccountRequired)
      return
    }

    if (!isValidBankAccountId(cleanAcc)) {
      setBankAccountError(t.bankAccountInvalid)
      setErrorMessage(t.bankAccountInvalid)
      return
    }

    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      persistDraft({ bankAccount: cleanAcc })
      navigate('/welcome/about')
      return
    }

    const signal = requestSignal()
    setLoading(true)
    try {
      const response = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: `${firstName.trim()} ${lastName.trim()}`,
          email: draftEmail.trim(),
          password: draftPassword,
          bank_account_id: cleanAcc,
        }),
        signal,
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        const detail = apiErrorDetail(error, '').message.toLowerCase()
        if (detail.includes('email')) {
          setErrorMessage(t.emailExists)
        } else if (detail.includes('bank account')) {
          setBankAccountError(t.bankAccountExists)
          setErrorMessage(t.bankAccountExists)
        } else {
          setErrorMessage(t.serviceUnavailable)
        }
        return
      }

      persistDraft({ bankAccount: cleanAcc, registered: true })
      setRegistered(true)
      navigate('/welcome/envelopes')
    } catch {
      if (!signal.aborted) setErrorMessage(t.serviceUnavailable)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  const handleStep3Continue = () => {
    setErrorMessage(null)
    persistDraft()
    navigate('/welcome/rules')
  }

  const handleStep4Continue = async () => {
    if (loading) return
    setErrorMessage(null)
    const invalidInput = [
      { id: 'rule1-token-amount-1', value: rentAmount, max: Infinity },
      { id: 'rule2-token-tax', value: taxPercent, max: 100 },
      { id: 'rule3-token-percent', value: savingsPercent, max: 100 },
      { id: 'rule3-token-cap', value: savingsCap, max: Infinity },
    ].find(({ value, max }) => !isValidRuleValue(value, max))

    if (invalidInput) {
      setErrorMessage(t.ruleValueInvalid)
      document.getElementById(invalidInput.id)?.focus()
      return
    }

    persistDraft()
    if (!registered) {
      navigate('/welcome/account')
      return
    }

    const signal = requestSignal()
    setLoading(true)
    try {
      const loginResponse = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: draftEmail.trim(), password: draftPassword }),
        signal,
      })
      if (!loginResponse.ok) {
        setErrorMessage(t.rulesSaveFailed)
        return
      }

      const loginData = await loginResponse.json()
      if (typeof loginData.access_token !== 'string') {
        setErrorMessage(t.rulesSaveFailed)
        return
      }

      const rulesResponse = await apiFetch('/api/rules/onboarding', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${loginData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rent_amount: Number(rentAmount),
          tax_percent: Number(taxPercent),
          savings_percent: Number(savingsPercent),
          savings_cap: Number(savingsCap),
        }),
        signal,
      })
      if (!rulesResponse.ok) {
        setErrorMessage(t.rulesSaveFailed)
        return
      }

      navigate('/welcome/try')
    } catch {
      if (!signal.aborted) setErrorMessage(t.rulesSaveFailed)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  const handleBack = () => {
    setErrorMessage(null)
    persistDraft()
    if (step > (registered ? 3 : 1)) navigate(onboardingPaths[step - 2])
  }

  const handleStepClick = (targetStep: number) => {
    if (registered && targetStep < 3) return
    setErrorMessage(null)
    persistDraft()
    const path = onboardingPaths[targetStep - 1]
    if (path) navigate(path)
  }

  const handleComplete = async () => {
    if (loading) return
    setErrorMessage(null)

    const email = draftEmail.trim()
    const password = draftPassword

    if (!registered) {
      persistDraft()
      navigate('/welcome/account')
      return
    }

    const signal = requestSignal()
    setLoading(true)

    try {
      const loginRes = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal,
      })
      if (loginRes.ok) {
        const tokenData = await loginRes.json()
        if (typeof tokenData.access_token === 'string') {
          localStorage.setItem('autowallet_token', tokenData.access_token)
          clearSignupDraft()
          navigate('/dashboard', { replace: true })
          return
        }
      }
      clearSignupDraft()
      navigate('/login', { replace: true })
    } catch {
      if (signal.aborted) return
      // The account exists; sign-in can be retried without registering again.
      clearSignupDraft()
      navigate('/login', { replace: true })
    } finally {
      if (!signal.aborted) {
        clearSignupCredentials()
        setLoading(false)
      }
    }
  }

  if (!draftEmail || !draftPassword) return null

  return (
    <div className={`min-h-screen bg-[#F3F6FA] flex flex-col justify-between ${'w-full'}`}>
      {/* Onboarding Top Bar with Logo and Stepper */}
      <TopBar variant="onboarding" finalStep={step === 5}>
        <Stepper
          currentStep={step}
          onStepClick={registered || loading ? undefined : handleStepClick}
          expanded={step === 5}
          t={t}
        />
      </TopBar>

      {/* Main Content Area */}
      <main className={`flex-1 flex flex-col items-center px-4 z-10 ${step === 5 ? 'justify-start pt-8 sm:pt-[54px] pb-32 sm:pb-40' : 'justify-center py-8 sm:py-12'}`}>
        {/* Error Alert Display */}
        {errorMessage && (
          <div
            role="alert"
            className="w-full max-w-[560px] mb-5 p-3.5 rounded-xl bg-[#FFF5F5] border border-[#FFD2D2] text-[#C62F31] text-sm flex items-start gap-3 animate-in fade-in"
          >
            <AlertCircle className="w-5 h-5 shrink-0 text-[#C62F31] mt-0.5" />
            <div className="flex-1 leading-snug">
              <span>{errorMessage}</span>
              {errorMessage === t.emailExists && (
                <div className="mt-1.5 flex gap-4 text-xs text-[#5E6B7E]">
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="underline text-[#5A64B4] font-medium cursor-pointer"
                  >
                    {t.loginButton}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/signup')}
                    className="underline text-[#5A64B4] font-medium cursor-pointer"
                  >
                    {t.changeEmail}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 1: About you */}
        {step === 1 && (
          <Step1About
            firstName={firstName}
            setFirstName={(val) => {
              setFirstName(val)
              if (firstNameError && val.trim().length >= 2) setFirstNameError(null)
            }}
            lastName={lastName}
            setLastName={(val) => {
              setLastName(val)
              if (lastNameError && val.trim().length >= 2) setLastNameError(null)
            }}
            t={t}
            onSubmit={handleStep1Continue}
            externalFirstNameError={firstNameError}
            externalLastNameError={lastNameError}
          />
        )}

        {/* Step 2: Link account */}
        {step === 2 && (
          <Step2Account
            bankAccount={bankAccount}
            setBankAccount={(val) => {
              setBankAccount(val)
              if (errorMessage === t.bankAccountExists) setErrorMessage(null)
              if (bankAccountError) setBankAccountError(null)
            }}
            t={t}
            externalBankAccountError={bankAccountError}
            disabled={loading}
          />
        )}

        {/* Step 3: Envelopes */}
        {step === 3 && <Step3Envelopes t={t} />}

        {/* Step 4: Rules */}
        {step === 4 && (
          <fieldset disabled={loading} className="w-full">
            <Step4Rules
              rentAmount={rentAmount}
              setRentAmount={setRentAmount}
              taxPercent={taxPercent}
              setTaxPercent={setTaxPercent}
              savingsPercent={savingsPercent}
              setSavingsPercent={setSavingsPercent}
              savingsCap={savingsCap}
              setSavingsCap={setSavingsCap}
              t={t}
            />
          </fieldset>
        )}

        {/* Step 5: Try payment simulation */}
        {step === 5 && (
          <Step5TryPayment
            simulatedAmount={simulatedAmount}
            setSimulatedAmount={(value) => { setSimulatedAmount(value); setHasSimulated(false) }}
            rentAmount={rentAmount}
            taxPercent={taxPercent}
            savingsPercent={savingsPercent}
            savingsCap={savingsCap}
            hasSimulated={hasSimulated}
            isSimulating={isSimulating}
            onSimulate={handleSimulate}
            t={t}
          />
        )}
      </main>

      {/* Fixed / Bottom Actions Bar per Figma layout_daff2d4f */}
      <footer className={`w-full bg-white border-t border-[#DDE3EA] z-20 ${step === 5 ? 'fixed inset-x-0 bottom-0 h-[88px] sm:h-[132px] pb-[env(safe-area-inset-bottom)] px-4 sm:px-10 flex items-center' : 'px-6 sm:px-10 py-4'}`}>
        <div className={`${step === 5 ? 'w-full' : 'max-w-5xl mx-auto'} flex items-center justify-between`}>
          {step === 1 ? (
            <>
              <div /> {/* Spacer */}
              <button
                type="button"
                id="onboarding-continue-step1"
                onClick={() => handleStep1Continue()}
                disabled={!firstName.trim()}
                className="h-11 px-6 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] text-white font-medium text-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center justify-center gap-2"
              >
                <span>{t.continueButton}</span>
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button
                type="button"
                id="onboarding-back-step2"
                onClick={handleBack}
                disabled={loading}
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[10px] border border-[#DDE3EA] bg-white text-[#3B495D] hover:bg-[#F3F6FA] text-sm font-medium transition cursor-pointer disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>{t.backButton}</span>
              </button>

              <button
                type="button"
                id="onboarding-continue-step2"
                onClick={handleStep2Continue}
                disabled={loading}
                className="h-11 px-6 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] text-white font-medium text-sm transition cursor-pointer disabled:opacity-50 shadow-xs flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{t.signupButton}</span>
              </button>
            </>
          ) : step === 3 ? (
            <>
              {registered ? <div /> : (
                <button
                  type="button"
                  id="onboarding-back-step3"
                  onClick={handleBack}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[10px] border border-[#DDE3EA] bg-white text-[#3B495D] hover:bg-[#F3F6FA] text-sm font-medium transition cursor-pointer disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>{t.backButton}</span>
                </button>
              )}

              <button
                type="button"
                id="onboarding-continue-step3"
                onClick={handleStep3Continue}
                disabled={loading}
                className="h-11 px-6 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] text-white font-medium text-sm transition cursor-pointer disabled:opacity-50 shadow-xs flex items-center justify-center gap-2"
              >
                <span>{t.continueButton}</span>
              </button>
            </>
          ) : step === 4 ? (
            <>
              <button
                type="button"
                id="onboarding-back-step4"
                onClick={handleBack}
                disabled={loading}
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[10px] border border-[#DDE3EA] bg-white text-[#3B495D] hover:bg-[#F3F6FA] text-sm font-medium transition cursor-pointer disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>{t.backButton}</span>
              </button>

              <button
                type="button"
                id="onboarding-continue-step4"
                onClick={handleStep4Continue}
                disabled={loading}
                className="h-11 px-6 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] text-white font-medium text-sm transition cursor-pointer disabled:opacity-50 shadow-xs flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{t.continueButton}</span>
              </button>
            </>
          ) : (
            /* Step 5: Try a payment */
            <>
              <button
                type="button"
                id="onboarding-back-step5"
                onClick={handleBack}
                disabled={loading || isSimulating}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-[10px] bg-white text-[#3B495D] hover:bg-[#F3F6FA] text-sm font-medium transition cursor-pointer disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>{t.backButton}</span>
              </button>

              {!hasSimulated ? (
                <button
                  type="button"
                  id="onboarding-skip-to-home-step5"
                  onClick={handleComplete}
                  disabled={loading || isSimulating}
                  className="h-11 px-6 rounded-[10px] border border-[#DDE3EA] bg-white text-[#3B495D] hover:bg-[#F3F6FA] text-sm font-medium transition cursor-pointer disabled:opacity-50 shadow-xs flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{t.skipToHomeButton}</span>
                </button>
              ) : (
                <button
                  type="button"
                  id="onboarding-go-to-home-step5"
                  onClick={handleComplete}
                  disabled={loading || isSimulating}
                  className="h-[52px] px-5 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] text-white font-medium text-sm transition cursor-pointer disabled:opacity-50 shadow-xs flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{t.goToHomeButton}</span>
                </button>
              )}
            </>
          )}
        </div>
      </footer>
    </div>
  )
}

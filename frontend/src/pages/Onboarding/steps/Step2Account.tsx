import { useState } from 'react'
import { Info, AlertCircle } from 'lucide-react'
import type { Translations } from '../../../i18n'
import { isValidBankAccountId } from '../../../auth/validation'

interface Step2AccountProps {
  bankAccount: string
  setBankAccount: (val: string) => void
  t: Translations
  externalBankAccountError?: string | null
  disabled?: boolean
}

export function Step2Account({
  bankAccount,
  setBankAccount,
  t,
  externalBankAccountError,
  disabled = false,
}: Step2AccountProps) {
  const [touched, setTouched] = useState(false)

  const cleanAcc = bankAccount.trim()
  const isValidFormat = isValidBankAccountId(cleanAcc)
  const hasNonDigit = /\D/.test(cleanAcc)

  const error =
    externalBankAccountError ||
    (hasNonDigit || (touched && cleanAcc.length > 0 && !isValidFormat) ? t.bankAccountInvalid : null)

  return (
    <div className="w-full max-w-[560px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] transition-all">
      {/* Step Heading */}
      <div className="mb-6 space-y-1.5">
        <h1 className="text-2xl sm:text-[28px] font-semibold text-[#1A2330] tracking-tight">
          {t.linkAccountTitle}
        </h1>
        <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
          {t.linkAccountSubtitle}
        </p>
      </div>

      {/* Step 2: Link Account Form (Figma #117:1095) */}
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="account-number-input" className="block text-sm font-medium text-[#1A2330]">
            {t.accountNumberLabel}
          </label>
          <input
            id="account-number-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            minLength={3}
            maxLength={50}
            aria-invalid={Boolean(error)}
            disabled={disabled}
            autoFocus
            value={bankAccount}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              setBankAccount(e.target.value)
              if (isValidBankAccountId(e.target.value)) setTouched(false)
            }}
            placeholder={t.accountNumberPlaceholder}
            className={`w-full h-11 px-3.5 rounded-[10px] border bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none transition ${
              error
                ? 'border-[#FFD2D2] focus:border-[#C62F31] focus:ring-2 focus:ring-[#C62F31]/20'
                : 'border-[#DDE3EA] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
            }`}
          />
          {error ? (
            <p role="alert" className="text-xs text-[#C62F31] flex items-center gap-1.5 mt-1 animate-in fade-in">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          ) : (
            <p className="text-xs text-[#5E6B7E] leading-normal">{t.accountNumberHint}</p>
          )}
        </div>

        {/* Informative Alert Banner (Figma #117:1109) */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-[#ECEEFA] border border-[#D0D6F5] text-[#3B495D] text-sm flex items-start gap-3">
          <Info className="w-5 h-5 text-[#5A64B4] shrink-0 mt-0.5" />
          <p className="leading-snug text-xs sm:text-sm">{t.linkAccountAlert}</p>
        </div>
      </div>
    </div>
  )
}

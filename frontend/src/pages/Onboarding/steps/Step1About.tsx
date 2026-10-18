import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import type { Translations } from '../../../i18n'

interface Step1AboutProps {
  firstName: string
  setFirstName: (val: string) => void
  lastName: string
  setLastName: (val: string) => void
  t: Translations
  onSubmit: (e?: FormEvent) => void
  externalFirstNameError?: string | null
  externalLastNameError?: string | null
}

export function Step1About({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  t,
  onSubmit,
  externalFirstNameError,
  externalLastNameError,
}: Step1AboutProps) {
  const [firstNameTouched, setFirstNameTouched] = useState(false)
  const [lastNameTouched, setLastNameTouched] = useState(false)

  // Local verification checks
  const isFirstNameValid = firstName.trim().length >= 2
  const isLastNameValid = lastName.trim().length >= 2

  const firstNameError =
    externalFirstNameError ||
    (firstNameTouched && !isFirstNameValid ? t.firstNameRequired : null)

  const lastNameError =
    externalLastNameError ||
    (lastNameTouched && !isLastNameValid ? t.lastNameRequired : null)

  return (
    <div className="w-full max-w-[560px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] transition-all">
      {/* Step Heading */}
      <div className="mb-6 space-y-1.5">
        <h1 className="text-2xl sm:text-[28px] font-semibold text-[#1A2330] tracking-tight">
          {t.aboutYouTitle}
        </h1>
        <p className="text-[15px] text-[#5E6B7E] leading-relaxed">
          {t.aboutYouSubtitle}
        </p>
      </div>

      {/* Step 1: About You Form (Figma #117:1008) */}
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* First Name Field */}
          <div className="space-y-1.5">
            <label htmlFor="first-name-input" className="block text-sm font-medium text-[#1A2330]">
              {t.firstNameLabel}
            </label>
            <input
              id="first-name-input"
              autoComplete="given-name"
              type="text"
              required
              autoFocus
              value={firstName}
              onBlur={() => setFirstNameTouched(true)}
              onChange={(e) => {
                setFirstName(e.target.value)
                if (firstNameTouched && e.target.value.trim().length >= 2) {
                  setFirstNameTouched(false)
                }
              }}
              className={`w-full h-11 px-3.5 rounded-[10px] border bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none transition ${
                firstNameError
                  ? 'border-[#FFD2D2] focus:border-[#C62F31] focus:ring-2 focus:ring-[#C62F31]/20'
                  : 'border-[#DDE3EA] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
              }`}
            />
            {firstNameError && (
              <p className="text-xs text-[#C62F31] flex items-center gap-1.5 mt-1 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{firstNameError}</span>
              </p>
            )}
          </div>

          {/* Last Name Field */}
          <div className="space-y-1.5">
            <label htmlFor="last-name-input" className="block text-sm font-medium text-[#1A2330]">
              {t.lastNameLabel}
            </label>
            <input
              id="last-name-input"
              autoComplete="family-name"
              type="text"
              required
              value={lastName}
              onBlur={() => setLastNameTouched(true)}
              onChange={(e) => {
                setLastName(e.target.value)
                if (lastNameTouched && e.target.value.trim().length >= 2) {
                  setLastNameTouched(false)
                }
              }}
              className={`w-full h-11 px-3.5 rounded-[10px] border bg-white text-[#1A2330] placeholder:text-[#8C9BAE] text-sm focus:outline-none transition ${
                lastNameError
                  ? 'border-[#FFD2D2] focus:border-[#C62F31] focus:ring-2 focus:ring-[#C62F31]/20'
                  : 'border-[#DDE3EA] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
              }`}
            />
            {lastNameError && (
              <p className="text-xs text-[#C62F31] flex items-center gap-1.5 mt-1 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{lastNameError}</span>
              </p>
            )}
          </div>
        </div>

      </form>
    </div>
  )
}

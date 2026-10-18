import { Check, Minus } from 'lucide-react'
import type { Translations } from '../../i18n'

interface PasswordStrengthProps {
  password: string
  t: Translations
  className?: string
}

export function PasswordStrength({ password, t, className = 'pt-1.5' }: PasswordStrengthProps) {
  // Password strength calculation (0 to 4)
  const calculatePasswordStrength = (pwd: string): number => {
    if (!pwd) return 0
    let score = 0
    if (pwd.length >= 8) score += 1
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1
    if (/\d/.test(pwd)) score += 1
    if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 12) score += 1
    return score
  }

  const pwStrength = calculatePasswordStrength(password)

  // Password strength text & color (matching Figma A2)
  const getStrengthMeta = () => {
    switch (pwStrength) {
      case 2:
        return { label: t.pwStrengthFair, color: 'bg-[#EB6834]', text: 'text-[#EB6834]' }
      case 3:
        return { label: t.pwStrengthGood, color: 'bg-[#EDA100]', text: 'text-[#EDA100]' }
      case 4:
        return { label: t.pwStrengthStrong, color: 'bg-[#1BAF7A]', text: 'text-[#1BAF7A]' }
      case 1:
        return { label: t.pwStrengthWeak, color: 'bg-[#C62F31]', text: 'text-[#C62F31]' }
      default:
        return { label: '', color: 'bg-[#DDE3EA]', text: 'text-[#5E6B7E]' }
    }
  }

  const strengthMeta = getStrengthMeta()

  return (
    <div className={`${className} space-y-2`}>
      {/* 4-segment progress bar */}
      <div className="grid grid-cols-4 gap-1.5 h-1 w-full" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={`h-full rounded-full transition-colors duration-200 ${
              pwStrength >= step ? strengthMeta.color : 'bg-[#DDE3EA]'
            }`}
          />
        ))}
      </div>

      {/* Requirement & Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5E6B7E]">
        <div className="flex items-center gap-1.5">
          {password.length >= 8 ? (
            <Check className="w-3.5 h-3.5 text-[#1BAF7A]" />
          ) : (
            <Minus className="w-3.5 h-3.5 text-[#5E6B7E]" />
          )}
          <span className={password.length >= 8 ? 'text-[#1A2330] font-medium' : 'text-[#5E6B7E]'}>
            {t.pwRequirement}
          </span>
        </div>
        {password.length > 0 && (
          <span className={`font-semibold ${strengthMeta.text}`}>{strengthMeta.label}</span>
        )}
      </div>
    </div>
  )
}

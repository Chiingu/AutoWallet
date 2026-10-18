import { Home, Landmark, PiggyBank, Wallet, Info } from 'lucide-react'
import type { Translations } from '../../../i18n'
import { RuleValueInput } from '../../../components/onboarding/RuleValueInput'
import { TokenEnvelopePill } from '../../../components/onboarding/TokenEnvelopePill'

interface Step4RulesProps {
  rentAmount: string
  setRentAmount: (val: string) => void
  taxPercent: string
  setTaxPercent: (val: string) => void
  savingsPercent: string
  setSavingsPercent: (val: string) => void
  savingsCap: string
  setSavingsCap: (val: string) => void
  t: Translations
}

export function Step4Rules({
  rentAmount,
  setRentAmount,
  taxPercent,
  setTaxPercent,
  savingsPercent,
  setSavingsPercent,
  savingsCap,
  setSavingsCap,
  t,
}: Step4RulesProps) {
  return (
    <div className="w-full max-w-[680px] mx-auto px-2 sm:px-4 space-y-5">
      {/* Step 4 Heading */}
      <div className="mb-6 space-y-1.5">
        <h1 className="text-2xl sm:text-[28px] font-semibold text-[#1A2330] tracking-tight">
          {t.rulesTitle}
        </h1>
        <p className="text-[15px] sm:text-base text-[#5E6B7E] leading-relaxed">
          {t.rulesSubtitle}
        </p>
      </div>

      {/* Rules Cards Stack */}
      <div className="space-y-3.5">
        {/* Rule 1: Rent lock */}
        <div className="bg-white rounded-2xl border border-[#DDE3EA] p-4 sm:p-5 shadow-2xs space-y-3">
          <h2 className="text-sm sm:text-base font-semibold text-[#1A2330]">
            {t.rule1Title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm sm:text-base text-[#1A2330] leading-relaxed">
            <span>{t.rule1Lock}</span>
            <RuleValueInput
              value={rentAmount}
              onChange={setRentAmount}
              id="rule1-token-amount-1"
              label={t.rule1Title}
              unit="MAD"
            />
            <span>{t.rule1Into}</span>
            <TokenEnvelopePill name={t.rentName} icon={Home} color="#2270D8" bgColor="#EAF2FC" />
          </div>
        </div>

        {/* Rule 2: Tax */}
        <div className="bg-white rounded-2xl border border-[#DDE3EA] p-4 sm:p-5 shadow-2xs space-y-3">
          <h2 className="text-sm sm:text-base font-semibold text-[#1A2330]">
            {t.rule2Title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm sm:text-base text-[#1A2330] leading-relaxed">
            <span>{t.rule2Put}</span>
            <RuleValueInput
              value={taxPercent}
              onChange={setTaxPercent}
              id="rule2-token-tax"
              label={t.rule2Title}
              unit="%"
            />
            <span>{t.rule2OfWhatLeftInto}</span>
            <TokenEnvelopePill name={t.taxName} icon={Landmark} color="#EB6834" bgColor="#FDEEE8" />
          </div>
        </div>

        {/* Rule 3: Savings (capped) */}
        <div className="bg-white rounded-2xl border border-[#DDE3EA] p-4 sm:p-5 shadow-2xs space-y-3">
          <h2 className="text-sm sm:text-base font-semibold text-[#1A2330]">
            {t.rule3Title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm sm:text-base text-[#1A2330] leading-relaxed">
            <span>{t.rule3Put}</span>
            <RuleValueInput
              value={savingsPercent}
              onChange={setSavingsPercent}
              id="rule3-token-percent"
              label={t.rule3Title}
              unit="%"
            />
            <span>{t.rule3OfWhatLeftInto}</span>
            <TokenEnvelopePill name={t.savingsName} icon={PiggyBank} color="#1BAF7A" bgColor="#E3F5EE" />
            <span>{t.rule3OnlyWhile}</span>
            <TokenEnvelopePill name={t.savingsName} icon={PiggyBank} color="#1BAF7A" bgColor="#E3F5EE" />
            <span>{t.rule3IsBelow}</span>
            <RuleValueInput
              value={savingsCap}
              onChange={setSavingsCap}
              id="rule3-token-cap"
              label={`${t.savingsName} ${t.rule3IsBelow}`}
              unit="MAD"
            />
          </div>
        </div>

        {/* Rule 4: Free to spend */}
        <div className="bg-white rounded-2xl border border-[#DDE3EA] p-4 sm:p-5 shadow-2xs space-y-1">
          <h2 className="text-sm sm:text-base font-semibold text-[#1A2330]">
            {t.rule4Title}
          </h2>
          <p className="text-sm sm:text-base text-[#5E6B7E]">
            {t.rule4Gets}
          </p>
        </div>

        {/* Leftover Row: Main */}
        <div className="border border-dashed border-[#8C9BAE] bg-[#F3F6FA] rounded-2xl p-4 sm:p-5 flex items-start sm:items-center gap-3.5">
          <div className="w-10 h-10 rounded-[10px] bg-[#EDF0F4] text-[#5E6B7E] flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
          <p className="text-xs sm:text-sm text-[#3B495D] leading-relaxed">
            <span className="font-semibold text-[#1A2330]">{t.leftoverMainTitle}</span> — {t.leftoverMainDesc}
          </p>
        </div>

        {/* Informational Alert Banner (Figma #118:1488) */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-[#ECEEFA] border border-[#D0D6F5] text-[#3B495D] text-xs sm:text-sm flex items-start gap-3">
          <Info className="w-5 h-5 text-[#5A64B4] shrink-0 mt-0.5" />
          <p className="leading-snug">{t.taxDisclaimer}</p>
        </div>
      </div>
    </div>
  )
}

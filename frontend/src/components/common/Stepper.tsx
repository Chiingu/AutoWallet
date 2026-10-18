import { Check } from 'lucide-react'
import type { Translations } from '../../i18n'

export interface StepperProps {
  currentStep: number // 1 to 5
  onStepClick?: (step: number) => void
  expanded?: boolean
  t: Translations
}

export function Stepper({
  currentStep,
  onStepClick,
  expanded = false,
  t,
}: StepperProps) {
  const steps = [
    { num: 1, label: t.stepAboutYou },
    { num: 2, label: t.stepLinkAccount },
    { num: 3, label: t.stepEnvelopes },
    { num: 4, label: t.stepRules },
    { num: 5, label: t.stepTryPayment },
  ]

  return (
    <nav aria-label="Progress" className={`flex items-center ${expanded ? 'w-full' : ''}`}>
      {/* Desktop Stepper: 5-step numbered markers with connectors (Figma #117:958 & #77:1297) */}
      <ol className={`hidden ${expanded ? 'xl:flex w-full gap-0' : 'lg:flex gap-2 lg:gap-3'} items-center list-none m-0 p-0`}>
        {steps.map((stepItem, index) => {
          const isDone = stepItem.num < currentStep
          const isCurrent = stepItem.num === currentStep
          const isClickable = isDone && Boolean(onStepClick)

          return (
            <li key={stepItem.num} className={`flex items-center select-none ${expanded ? 'flex-1 last:flex-none' : 'gap-2 lg:gap-3'}`}>
              {/* Connector line from previous step */}
              {!expanded && index > 0 && (
                <div
                  aria-hidden="true"
                  className={`w-6 lg:w-10 h-0.5 rounded-full transition-colors duration-200 ${
                    isDone || isCurrent ? 'bg-[#5A64B4]' : 'bg-[#DDE3EA]'
                  }`}
                />
              )}

              {/* Step item button / container */}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(stepItem.num)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center gap-2 focus:outline-none rounded-lg transition-all ${expanded ? '' : 'p-1'} ${
                  isClickable
                    ? 'cursor-pointer hover:opacity-85 active:scale-95'
                    : 'cursor-default'
                }`}
                title={isClickable ? `Go back to ${stepItem.label}` : stepItem.label}
              >
                {/* Marker circle */}
                <div
                  className={`${expanded ? 'w-7 h-7' : 'w-6 h-6'} rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors duration-200 ${
                    isDone
                      ? `${expanded ? 'bg-[#3B495D]' : 'bg-[#5A64B4] hover:bg-[#4A53A0]'} text-white`
                      : isCurrent
                      ? 'bg-[#5A64B4] text-white ring-2 ring-[#5A64B4]/25'
                      : 'border border-[#DDE3EA] bg-white text-[#8C9BAE]'
                  }`}
                >
                  {isDone ? (
                    <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                  ) : (
                    <span>{stepItem.num}</span>
                  )}
                </div>

                {/* Step Label */}
                <span
                  className={`${expanded ? 'text-sm' : 'text-xs xl:text-sm'} whitespace-nowrap transition-colors duration-200 ${
                    isCurrent
                      ? 'font-semibold text-[#1A2330]'
                    : isDone
                      ? `font-medium ${expanded ? 'text-[#1A2330]' : 'text-[#5A64B4]'}`
                      : 'text-[#8C9BAE]'
                  }`}
                >
                  {stepItem.label}
                </span>
              </button>
              {expanded && index < steps.length - 1 && (
                <div aria-hidden="true" className="mx-4 h-0.5 flex-1 rounded-full bg-[#3B495D]" />
              )}
            </li>
          )
        })}
      </ol>

      {/* Mobile Stepper Header (Figma #117:1155 & #77:1291) */}
      <div className={`flex ${expanded ? 'xl:hidden' : 'lg:hidden'} flex-col items-center`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#1A2330]">
            {steps[currentStep - 1]?.label}
          </span>
          <span className="text-[11px] font-normal text-[#5E6B7E]">
            Step {currentStep} of 5
          </span>
        </div>
        <div className="flex gap-1 mt-1" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-1 w-5 rounded-full transition-colors duration-300 ${
                s <= currentStep ? 'bg-[#5A64B4]' : 'bg-[#DDE3EA]'
              }`}
            />
          ))}
        </div>
      </div>
    </nav>
  )
}

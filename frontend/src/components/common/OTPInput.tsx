import { useRef } from 'react'
import type { ChangeEvent, KeyboardEvent, ClipboardEvent } from 'react'

interface OTPInputProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  hasError?: boolean
  onComplete?: (code: string) => void
  autoFocus?: boolean
}

export function OTPInput({
  value,
  onChange,
  disabled = false,
  hasError = false,
  onComplete,
  autoFocus = true,
}: OTPInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])

  const handleChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const char = e.target.value.slice(-1).replace(/\D/g, '')
    const chars = (value || '').padEnd(6, ' ').split('')
    chars[index] = char || ' '
    const nextVal = chars.join('').trimEnd()
    onChange(nextVal)

    if (char && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }

    if (char && nextVal.replace(/\s/g, '').length === 6 && onComplete) {
      onComplete(nextVal)
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.key === 'Backspace' && (!value[index] || value[index] === ' ') && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: ClipboardEvent) => {
    if (disabled) return
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    onChange(pasted)
    const targetIdx = Math.min(pasted.length, 5)
    inputsRef.current[targetIdx]?.focus()

    if (pasted.length === 6 && onComplete) {
      onComplete(pasted)
    }
  }

  return (
    <div
      role="group"
      aria-label="6-digit verification code"
      className="flex items-center justify-between gap-1.5 sm:gap-2.5 my-2"
      onPaste={handlePaste}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of 6`}
          value={value[i] && value[i] !== ' ' ? value[i] : ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-invalid={hasError || undefined}
          className={`min-w-0 w-0 flex-1 sm:w-12 sm:flex-none h-13 sm:h-14 text-center text-2xl font-mono font-semibold rounded-[10px] border transition focus:outline-none ${
            disabled
              ? 'bg-[#F3F6FA] text-[#8C9BAE] border-[#DDE3EA] cursor-not-allowed opacity-60'
              : hasError
              ? 'border-[#B42325] text-[#B42325] bg-[#FFF5F5] focus:border-[#B42325] focus:ring-2 focus:ring-[#B42325]/20'
              : 'border-[#DDE3EA] bg-white text-[#1A2330] focus:border-[#5A64B4] focus:ring-2 focus:ring-[#5A64B4]/20'
          }`}
        />
      ))}
    </div>
  )
}

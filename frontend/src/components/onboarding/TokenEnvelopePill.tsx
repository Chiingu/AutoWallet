import type { ComponentType } from 'react'

interface TokenEnvelopePillProps {
  name: string
  icon: ComponentType<{ className?: string }>
  color: string
  bgColor: string
}

export function TokenEnvelopePill({
  name,
  icon: Icon,
  color,
  bgColor,
}: TokenEnvelopePillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 h-9 min-h-[36px] px-3 rounded-[10px] border border-[#DDE3EA] bg-white text-[#1A2330] font-semibold text-sm shadow-2xs align-middle my-1 select-none">
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: bgColor, color }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span>{name}</span>
    </span>
  )
}

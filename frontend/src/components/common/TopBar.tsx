import React from 'react'
import { useNavigate } from 'react-router-dom'

export interface TopBarProps {
  variant?: 'auth' | 'onboarding'
  finalStep?: boolean
  children?: React.ReactNode
}

export function TopBar({
  variant = 'auth',
  finalStep = false,
  children,
}: TopBarProps) {
  const navigate = useNavigate()

  return (
    <header
      className={`w-full px-6 sm:px-10 py-5 ${finalStep ? 'sm:py-[21px]' : 'sm:py-6'} flex flex-col justify-center z-20 transition-colors ${
        variant === 'onboarding'
          ? `bg-white border-b border-[#DDE3EA] ${finalStep ? '' : 'shadow-xs'}`
          : 'border-b border-transparent'
      }`}
    >
      <div className="w-full flex items-center gap-4">
        {/* AutoWallet Official Logo using AW.svg */}
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="flex items-center gap-2.5 cursor-pointer group text-left transition-opacity hover:opacity-90 select-none shrink-0"
          title="AutoWallet Home"
        >
          <img
            src="/AW.svg"
            alt="AutoWallet Logo"
            className="h-8 sm:h-9 w-auto object-contain transition-transform group-hover:scale-105"
          />
          <span className={`${finalStep ? 'text-base' : 'text-xl sm:text-2xl'} font-bold text-[#3B495D] tracking-tight leading-none`}>
            AutoWallet
          </span>
        </button>

        {/* Stepper (Desktop and wide tablets) */}
        {children && (
          <div className={`hidden ${finalStep ? 'xl:flex pl-4' : 'lg:flex justify-center'} flex-1 items-center min-w-0`}>
            {children}
          </div>
        )}
      </div>

      {/* Stepper (Compact screens: placed below the logo) */}
      {children && (
        <div className={`${finalStep ? 'xl:hidden' : 'lg:hidden'} flex justify-center w-full pt-3`}>
          {children}
        </div>
      )}
    </header>
  )
}

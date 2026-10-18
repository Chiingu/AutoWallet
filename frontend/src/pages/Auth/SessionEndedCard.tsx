import { LegalFooter } from '../../components/common/LegalFooter'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { translations } from '../../i18n'

interface SessionEndedCardProps {
  onLogInAgain?: () => void
}

export function SessionEndedCard({
  onLogInAgain,
}: SessionEndedCardProps) {
  const t = translations
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const redirectPath = searchParams.get('redirect') || searchParams.get('return_to')

  // Set document title per Figma A5 A11y requirement
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${t.sessionEndedTitle} · AutoWallet`
    return () => { document.title = previousTitle }
  }, [t.sessionEndedTitle])

  const handleAction = () => {
    if (onLogInAgain) {
      onLogInAgain()
    } else {
      const redirectQuery = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : ''
      navigate(`/login${redirectQuery}`)
    }
  }

  return (
    <main className="w-full flex-1 flex flex-col items-center justify-center px-4 py-3 sm:py-5 z-10 animate-in fade-in duration-200">
      {/* 440px Centered White Card per Figma A5 (#115:879 & #115:914) */}
      <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#DDE3EA] p-6 sm:p-9 shadow-[0_8px_24px_-4px_rgba(27,36,50,0.08),0_2px_6px_-1px_rgba(27,36,50,0.04)] text-center flex flex-col items-center">
        {/* Clock Icon container (Figma EL-f775418e) */}
        <div className="w-12 h-12 rounded-full bg-[#ECEEFA] flex items-center justify-center mb-5 text-[#5A64B4]">
          <Clock className="w-6 h-6" />
        </div>

        {/* Card Heading (Figma EL-bc40306a) */}
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold text-[#1A2330] tracking-tight">
            {t.sessionEndedTitle}
          </h1>
          <p className="text-[15px] text-[#5E6B7E] leading-relaxed max-w-[340px]">
            {t.sessionEndedSubtitle}
          </p>
        </div>

        {/* Primary Action Button (Figma EL-02d186dd) */}
        <button
          type="button"
          onClick={handleAction}
          className="w-full h-11 sm:h-12 px-4 rounded-[10px] bg-[#5A64B4] hover:bg-[#4A53A0] active:bg-[#3F4789] text-white font-medium text-sm transition flex items-center justify-center cursor-pointer shadow-xs"
        >
          {t.logInAgainButton}
        </button>
      </div>

      {/* Legal Footer (Figma EL-0b7a78e5) */}
      <LegalFooter t={t} />
    </main>
  )
}

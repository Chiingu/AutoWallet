import { Home, Landmark, PiggyBank, ShoppingBag, Wallet, Sparkles } from 'lucide-react'
import type { Translations } from '../../../i18n'

interface Step3EnvelopesProps {
  t: Translations
}

export function Step3Envelopes({ t }: Step3EnvelopesProps) {
  const envelopeCards = [
    {
      id: 'rent',
      name: t.rentName,
      desc: t.rentDesc,
      amount: '0.00',
      currency: 'MAD',
      status: t.rentStatus,
      icon: Home,
      iconColor: '#2270D8',
      bgColor: '#EAF2FC',
      isFocal: false,
    },
    {
      id: 'tax',
      name: t.taxName,
      desc: t.taxDesc,
      amount: '0.00',
      currency: 'MAD',
      status: t.taxStatus,
      icon: Landmark,
      iconColor: '#EB6834',
      bgColor: '#FDEEE8',
      isFocal: false,
    },
    {
      id: 'savings',
      name: t.savingsName,
      desc: t.savingsDesc,
      amount: '0.00',
      currency: 'MAD',
      status: t.savingsStatus,
      icon: PiggyBank,
      iconColor: '#1BAF7A',
      bgColor: '#E3F5EE',
      isFocal: false,
    },
    {
      id: 'free',
      name: t.freeToSpendName,
      desc: t.freeToSpendDesc,
      amount: '0.00',
      currency: 'MAD',
      status: t.freeToSpendStatus,
      icon: ShoppingBag,
      iconColor: '#EDA100',
      bgColor: '#FDF3DC',
      isFocal: true,
      badge: t.freeToSpendBadge,
    },
    {
      id: 'main',
      name: t.mainName,
      desc: t.mainDesc,
      amount: '0.00',
      currency: 'MAD',
      status: t.mainStatus,
      icon: Wallet,
      iconColor: '#5E6B7E',
      bgColor: '#EDF0F4',
      isFocal: false,
    },
  ]

  return (
    <div className="w-full max-w-5xl mx-auto px-2 sm:px-4">
      {/* Step 3 Heading */}
      <div className="mb-8 space-y-2 text-center sm:text-left">
        <h1 className="text-2xl sm:text-[32px] font-semibold text-[#1A2330] tracking-tight">
          {t.envelopesTitle}
        </h1>
        <p className="text-[15px] sm:text-base text-[#5E6B7E] leading-relaxed max-w-3xl">
          {t.envelopesSubtitle}
        </p>
      </div>

      {/* 5 Envelope Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {envelopeCards.map((card) => {
          const IconComponent = card.icon

          return (
            <div
              key={card.id}
              className={`bg-white rounded-2xl border p-5 sm:p-6 flex flex-col justify-between transition-all hover:shadow-xs min-h-[185px] ${
                card.isFocal
                  ? 'border-[#EDA100]/60 ring-2 ring-[#EDA100]/25 shadow-xs relative'
                  : 'border-[#DDE3EA] shadow-2xs'
              }`}
            >
              <div>
                {/* Top Header Row with Icon Tile and Titles */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <div
                      className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0"
                      style={{ backgroundColor: card.bgColor, color: card.iconColor }}
                    >
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-[#1A2330] tracking-tight">
                        {card.name}
                      </h2>
                      <p className="text-xs sm:text-sm text-[#5E6B7E] leading-snug mt-0.5">
                        {card.desc}
                      </p>
                    </div>
                  </div>

                  {card.isFocal && card.badge && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#B26A00] bg-[#FDF3DC] px-2.5 py-0.5 rounded-full border border-[#EDA100]/30 shrink-0 select-none">
                      <Sparkles className="w-3 h-3 text-[#EDA100]" />
                      <span>{card.badge}</span>
                    </span>
                  )}
                </div>

                {/* Middle Balance Amount */}
                <div className="my-4 sm:my-5 flex items-baseline">
                  <span className="text-2xl sm:text-[28px] font-bold text-[#1A2330] tracking-tight">
                    {card.amount}
                  </span>
                  <span className="text-xs sm:text-sm font-medium text-[#5E6B7E] ml-1.5">
                    {card.currency}
                  </span>
                </div>
              </div>

              {/* Bottom Status / Rule Note */}
              <div className="pt-3 border-t border-[#F3F6FA] text-xs text-[#8C9BAE] flex items-center gap-1.5 leading-tight">
                <span>{card.status}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

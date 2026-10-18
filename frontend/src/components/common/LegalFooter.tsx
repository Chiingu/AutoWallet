import type { Translations } from '../../i18n'

export function LegalFooter({ t }: { t: Translations }) {
  return (
    <footer className="mt-6 text-center text-xs text-[#5E6B7E] flex items-center justify-center gap-4">
      <a href="/privacy" target="_blank" rel="noopener noreferrer" aria-label="Privacy (opens in a new tab)" className="hover:text-[#1A2330] hover:underline">
        {t.privacy}
      </a>
      <span>·</span>
      <a href="/terms" target="_blank" rel="noopener noreferrer" aria-label="Terms (opens in a new tab)" className="hover:text-[#1A2330] hover:underline">
        {t.terms}
      </a>
    </footer>
  )
}

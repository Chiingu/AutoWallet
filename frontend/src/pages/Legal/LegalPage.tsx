import { Link } from 'react-router-dom'
import { TopBar } from '../../components/common/TopBar'

interface LegalPageProps {
  document: 'terms' | 'privacy'
}

interface LegalSection {
  title: string
  paragraphs?: readonly string[]
  items?: readonly string[]
  // Starts the section with "<before> <link to a page of the app><after>"
  pageLink?: { before: string; to: string; label: string; after: string }
  // Ends the section with "<contactLine> <email link>."
  contactLine?: string
}

interface LegalDocument {
  title: string
  intro: string
  sections: readonly LegalSection[]
}

const CONTACT_EMAIL = 'mohamedamintarza@gmail.com'
const LAST_UPDATED = '14 October 2026'

const documents: Record<LegalPageProps['document'], LegalDocument> = {
  privacy: {
    title: 'Privacy Policy',
    intro:
      'This page explains what AutoWallet collects about you, why, who else receives it, how long we keep it, and what you can do about it.',
    sections: [
      {
        title: 'Who is responsible',
        paragraphs: [
          "AutoWallet is built and run by the student team listed in our project's README, as our ft_transcendence project at 1337 (42 network) in Morocco. The team is responsible for the personal data described on this page.",
        ],
        contactLine: 'Contact:',
      },
      {
        title: 'What we collect',
        items: [
          'Account: your full name, email address, password and bank account ID. We store only a bcrypt hash of your password, never the password itself.',
          'Google sign-in, if you use it: your Google account ID, name and email address. We never receive your Google password.',
          'Two-factor authentication, if you turn it on: a secret key used to check your 6-digit codes.',
          'Your budget: the balances of your five envelopes (main, rent, tax, savings and free), your splitting rules, your payments (reference, amount, status and dates), and how much of each payment went into each envelope.',
          'AI assistant: the questions you ask it (see "The AI assistant and Google Gemini" below).',
        ],
      },
      {
        title: 'Why we use it',
        items: [
          'To create your account and let you sign in securely.',
          'To split each payment between your envelopes according to your rules, and to show you your balances and history.',
          'To show you charts and totals of your payments for the period you choose (the Analytics page), and to export them as a CSV or PDF file when you ask.',
          'To answer your questions with the AI assistant, using your own envelopes and rules.',
          'To email you about your account, for example the code that confirms deleting it, or a notice when your data is exported.',
          'To keep the service safe, for example by limiting how many AI questions each account can send per minute.',
        ],
      },
      {
        title: 'The AI assistant and Google Gemini',
        paragraphs: [
          'When you ask the assistant a question, AutoWallet sends it to Gemini, an AI service run by Google, together with your current envelope balances, your active rules and your last five payments (date, amount and status). We do not send your name, email address, password or bank account ID.',
          "AutoWallet does not save your questions or the assistant's answers. Google processes them under its own terms, and on the free version of Gemini, Google may use them to improve its products. Please do not type personal details you want to keep private into your questions.",
        ],
      },
      {
        title: 'Information stored in your browser',
        items: [
          'After you sign in, your browser keeps an access token in local storage. It is removed when you log out, and it stops working after 24 hours.',
          "While you sign up, the details you type (email address, first and last name, bank account ID and rule values) are kept in session storage, and your password stays only in the page's memory. They are deleted when you finish signing up or close the tab.",
          'If you sign in with Google, the server sets one small security cookie that protects the sign-in from attacks. It lasts 10 minutes at most.',
          'AutoWallet does not use advertising or tracking cookies.',
        ],
      },
      {
        title: 'Who else receives your data',
        items: [
          'Google, when you choose to sign in with Google, and when you use the AI assistant (Gemini).',
          'Our bank simulator, a test service run by the team, which only knows your bank account ID and simulated payments.',
          'Our email service, which delivers the emails we send you. It receives your email address and the message.',
          'Nobody else: we do not sell your data, and we do not use advertising or analytics services.',
        ],
      },
      {
        title: 'How long we keep it',
        items: [
          'Your account, envelopes, rules and payments: until you delete your account or ask us to delete it.',
          'Your AI questions and answers: not stored by AutoWallet.',
          'The counter that limits AI questions: deleted automatically after 60 seconds.',
          'The code that confirms deleting your account: 15 minutes at most.',
          'The access token in your browser: until you log out. It stops working after 24 hours.',
        ],
      },
      {
        title: 'How we protect it',
        items: [
          'Passwords are stored only as bcrypt hashes.',
          'Sign-in tokens are signed by our server and stop working after 24 hours.',
          'You can turn on two-factor authentication for extra protection.',
          'Each account can only read its own envelopes, rules and payments.',
          'Secret keys, such as the AI service key, stay on the server and are never sent to your browser.',
        ],
      },
      {
        title: 'Your rights',
        pageLink: {
          before: 'You can download a copy of your data (JSON or CSV) or delete your account yourself, at any time, on the',
          to: '/account/privacy',
          label: 'Privacy & data',
          after: ' page of your account. To delete it, you type a 6-digit code that we send to your email address.',
        },
        paragraphs: [
          'You can also write to us to see a copy of your data, to correct it, or to delete your account and all its data. We answer within 30 days.',
          'These rights come from the EU General Data Protection Regulation (GDPR) and from Moroccan law 09-08 on the protection of personal data.',
        ],
        contactLine: 'To use them, write to us at',
      },
      {
        title: 'Changes to this page',
        paragraphs: ['When we change this policy, we update the date at the top of this page.'],
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    intro:
      'These terms explain what AutoWallet is, what you can expect from it, and what we expect from you. By creating an account, you accept them.',
    sections: [
      {
        title: 'What AutoWallet is',
        paragraphs: [
          'AutoWallet is a budgeting tool: when a payment arrives, it divides the amount between your envelopes (main, rent, tax, savings and free) according to rules you choose.',
          'AutoWallet is a budgeting ledger, not a bank. It never holds, moves or transfers real money, and it does not connect to your real bank account.',
        ],
      },
      {
        title: 'Your account',
        items: [
          'Give accurate information, and only link a bank account ID that you are allowed to use.',
          'Keep your password private. We recommend turning on two-factor authentication.',
          'You are responsible for what happens in your account. Tell us quickly if you think someone else is using it.',
          'One account per person.',
        ],
      },
      {
        title: 'Payments and previews',
        items: [
          'Payments come from our bank simulator, a test service that creates simulated payments. They are not real transfers.',
          'The Try a payment screen during signup is calculated in your browser. It does not submit a payment or change any balance.',
          'The rule values you choose during signup (rent amount, tax %, savings % and savings cap) are saved as your account rules.',
          'Always check calculated amounts yourself before relying on them.',
        ],
      },
      {
        title: 'The AI assistant',
        items: [
          'Its answers are written automatically by an AI model and can be wrong or incomplete.',
          'It is not financial, tax or legal advice. For important decisions, check with an official source or a qualified accountant.',
          'To keep the service fair, each account can ask a limited number of questions per minute (currently 20).',
          "Do not use it to share other people's personal data.",
        ],
      },
      {
        title: 'Acceptable use',
        items: [
          "Do not try to access other users' accounts or data.",
          'Do not attack, overload or scan the service, or try to get around its limits.',
          'Do not use AutoWallet for anything illegal or harmful.',
        ],
      },
      {
        title: 'Availability',
        paragraphs: [
          'AutoWallet is a student project. We provide it as it is, without any guarantee: it may contain mistakes, change, be unavailable or stop at any time, and data may be reset while we develop it.',
        ],
      },
      {
        title: 'Liability',
        paragraphs: [
          "As far as the law allows, the AutoWallet team is not responsible for any loss caused by using AutoWallet, by relying on its calculations, or by following the AI assistant's answers.",
        ],
      },
      {
        title: 'Ending your account',
        paragraphs: [
          'You can stop using AutoWallet at any time and ask us to delete your account and its data, as explained in the Privacy Policy. We may suspend an account that breaks these terms.',
        ],
      },
      {
        title: 'Changes to these terms',
        paragraphs: [
          'We may update these terms. The date at the top of this page shows the latest version. If you keep using AutoWallet after a change, you accept the new terms.',
        ],
      },
      {
        title: 'Contact',
        contactLine: 'Questions about these terms? Write to us at',
      },
    ],
  },
}

function ContactLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-[#4A53A0] underline">
      {CONTACT_EMAIL}
    </a>
  )
}

export function LegalPage({ document }: LegalPageProps) {
  const content = documents[document]

  return (
    <div className="min-h-screen bg-[#F3F6FA] flex flex-col">
      <TopBar />
      <main className="w-full max-w-[760px] mx-auto flex-1 px-4 py-8 sm:py-12">
        <article className="rounded-2xl border border-[#DDE3EA] bg-white p-6 sm:p-10 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5A64B4]">AutoWallet</p>
          <h1 className="mt-2 text-3xl font-bold text-[#1A2330]">{content.title}</h1>
          <p className="mt-1 text-sm text-[#5E6B7E]">Last updated: {LAST_UPDATED}</p>
          <p className="mt-3 text-[#5E6B7E] leading-relaxed">{content.intro}</p>
          <div className="mt-8 space-y-7">
            {content.sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-semibold text-[#1A2330]">{section.title}</h2>
                {section.pageLink && (
                  <p className="mt-2 text-sm leading-7 text-[#3B495D]">
                    {section.pageLink.before}{' '}
                    <Link to={section.pageLink.to} className="font-medium text-[#4A53A0] underline">
                      {section.pageLink.label}
                    </Link>
                    {section.pageLink.after}
                  </p>
                )}
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-2 text-sm leading-7 text-[#3B495D]">
                    {paragraph}
                  </p>
                ))}
                {section.items && (
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-7 text-[#3B495D]">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {section.contactLine && (
                  <p className="mt-2 text-sm leading-7 text-[#3B495D]">
                    {section.contactLine} <ContactLink />.
                  </p>
                )}
              </section>
            ))}
          </div>
          <p className="mt-8 rounded-xl bg-[#ECEEFA] px-4 py-3 text-sm text-[#3B495D]">
            AutoWallet is a student project (ft_transcendence at 1337, part of the 42 network). Questions about this
            page or your data? Write to <ContactLink />.
          </p>
          <nav aria-label="Account and legal pages" className="mt-8 flex flex-wrap gap-5 text-sm font-medium text-[#4A53A0]">
            <Link to="/login" className="hover:underline">Back to login</Link>
            <Link to={document === 'terms' ? '/privacy' : '/terms'} className="hover:underline">
              {document === 'terms' ? 'Privacy Policy' : 'Terms of Service'}
            </Link>
          </nav>
        </article>
      </main>
    </div>
  )
}

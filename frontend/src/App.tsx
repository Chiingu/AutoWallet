import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthPage } from './pages/Auth/AuthPage'

import { useDashboardTheme } from './pages/Settings/settingsPreferences'
import { onboardingPaths } from './pages/Onboarding/routes'


const GoogleCallbackPage = lazy(() => import('./pages/Auth/GoogleCallbackPage').then(({ GoogleCallbackPage }) => ({ default: GoogleCallbackPage })))
const LegalPage = lazy(() => import('./pages/Legal/LegalPage').then(({ LegalPage }) => ({ default: LegalPage })))

const OnboardingPage = lazy(() =>
  import('./pages/Onboarding/OnboardingPage').then(({ OnboardingPage }) => ({
    default: OnboardingPage,
  })),
)

const DashboardPage = lazy(() =>
  import('./pages/Dashboard/DashboardPage').then(({ DashboardPage }) => ({
    default: DashboardPage,
  })),
)

const authRoutes = {
  '/login': 'login',
  '/signup': 'signup',
  '/login/2fa': '2fa',
  '/session-ended': 'session-ended',
  '/forgot-password': 'forgot-password',
  '/reset-password': 'reset-password',
  '/verify-email': 'verify-email',
  '/auth/verify-email': 'verify-email',
} as const

export default function App() {
  useDashboardTheme()
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div role="status" className="min-h-screen flex items-center justify-center">
            Loading…
          </div>
        }
      >
        <Routes>
          {Object.entries(authRoutes).map(([path, mode]) => (
            <Route
              key={path}
              path={path}
              element={
                <AuthPage key={mode} mode={mode} />
              }
            />
          ))}

          {/* Figma A3: Continue with Google OAuth Callback */}
          <Route
            path="/auth/google/callback"
            element={
              <GoogleCallbackPage />
            }
          />

          {onboardingPaths.map((path) => (
            <Route
              key={path}
              path={path}
              element={<OnboardingPage />}
            />
          ))}

          <Route path="/onboarding" element={<Navigate to="/welcome/about" replace />} />

          {/* Root Route redirects to /login */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/app/activity" element={<DashboardPage />} />
          <Route path="/app/activity/:paymentId" element={<DashboardPage />} />
          <Route path="/app/analytics" element={<DashboardPage />} />
          <Route path="/app/assistant" element={<DashboardPage />} />
          <Route path="/app/notifications" element={<DashboardPage />} />
          <Route path="/app/sandbox" element={<DashboardPage />} />
          <Route path="/app/settings" element={<DashboardPage />} />
          <Route path="/app/settings/:section" element={<DashboardPage />} />
          <Route path="/app/rules" element={<DashboardPage />} />
          <Route path="/app/envelopes" element={<DashboardPage />} />
          <Route path="/app/envelopes/:walletType" element={<DashboardPage />} />
          <Route path="/maintenance" element={<Navigate to="/dashboard" replace />} />
          {/* Preserve links shared from the original account pages. */}
          <Route path="/analytics" element={<Navigate to="/app/analytics" replace />} />
          <Route path="/assistant" element={<Navigate to="/app/assistant" replace />} />
          <Route path="/account/privacy" element={<Navigate to="/app/settings/privacy" replace />} />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

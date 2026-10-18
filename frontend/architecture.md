# Frontend architecture

Updated October 16, 2026. This document describes the current frontend; backend endpoint coverage and outstanding contracts are maintained in [AUDIT.md](AUDIT.md).

## File organization

```text
src/
  api/                  Shared HTTP clients, SSE reader, error and wallet validation
  assets/               Imported assets (Google logo)
  auth/                 Validation, safe return URLs, signup drafts, in-memory credentials
  components/
    common/             Dialog, OTP, password meter, stepper, top bar, legal footer
    icons/              Google icon wrapper
    onboarding/         Reusable onboarding inputs and envelope tokens
  hooks/                Countdown, request cancellation, dismissible menus
  i18n/                 English copy and its inferred TypeScript type
  pages/
    Auth/               Login, signup, two-factor, recovery, OAuth callback
    Dashboard/          Dashboard shell and individual workspace views
    Legal/              Terms and Privacy pages
    Onboarding/         Five-step signup controller and step components
    Settings/           Settings sections, security/privacy flows, browser preferences
  utils/                Shared number/date formatting
  App.tsx               Route registration and lazy page boundaries
  main.tsx              React entry point and legacy draft cleanup
  index.css             Tailwind and global styles
public/AW.svg           Public logo
tests/                  QA-owned component and domain tests
```

Local design exports and the ZIP are reference inputs, not runtime assets. Build output and dependency directories are generated. `Dockerfile` builds the production bundle and serves it with nginx; Compose includes the frontend and its reverse proxy.

## API boundaries

- `api/request.ts` applies a timeout while preserving caller cancellation. A write timeout means the outcome is unknown; payment retries retain the same reference.
- `api/errors.ts` reads string and structured FastAPI errors safely, including missing or malformed error bodies.
- `api/walletTypes.ts` defines the shared wallet identifiers and their runtime validation.
- `api/analyticsApi.ts` validates date ranges and response shapes, and downloads CSV/PDF reports.
- `api/assistantApi.ts` handles streaming chat; `api/paymentLiveApi.ts` handles authenticated payment events and an idle watchdog. Both consume `api/sse.ts` for chunked UTF-8/CRLF event parsing and stream cleanup.
- `api/settingsApi.ts` handles Settings errors, retry metadata, and security metadata from a data export.
- `pages/Dashboard/dashboardApi.ts` remains the feature's typed account/resource aggregator and public dashboard domain types. It validates users, wallets, transactions, and rules before rendering. Authentication and onboarding keep their form-specific request orchestration beside their state machines.

The development proxy forwards relative `/api` requests to the configured backend. The browser does not call Docker hostnames. Google OAuth starts with a browser navigation so the backend can set its state-binding cookie; the frontend exchanges the returned one-time code.

## Dashboard data flow

`DashboardPage` owns account loading, refresh/error state, navigation, menus, and record/link actions. `HomeView` owns Home balances, envelope rows, the split ribbon, and recent payments. Other views receive typed data and callbacks. Analytics and Assistant load their additional API data through their clients. Settings only requires `/api/auth/me`, so a failed transaction read does not block account settings.

`usePaymentLiveUpdates` subscribes after a linked user is known. It resynchronizes after subscribing or reconnecting, batches bursts of payment events, backs off on disconnects, expires the session on 401, and stops while hidden, offline, or viewing Settings. Payment events trigger fresh resource reads rather than treating an event as a complete ledger. The backend has no replay cursor, so reconnecting must read current state.

`dashboardSplit.ts` is shared by signup, Sandbox and dashboard previews. It previews active rules in priority order using current balances and conditions. It is a preview, not a replacement for server processing. Historical payment bars and envelope histories require actual allocation fields and reconciled totals; absent values are not reconstructed from today's rules.

## State and lifecycle

- The URL selects the current view and detail object. Safe return URLs survive login, two-factor entry, and the Google callback.
- Recovery codes use component memory with copy/download controls; they are cleared when the Security screen unmounts. Verification consumes email tokens once per mounted screen, including StrictMode effect replay.
- Signup and two-factor passwords are page-memory data; non-secret drafts and a short-lived Google return destination use session storage.
- The Bearer token is currently stored in local storage. Backend authorization remains authoritative.
- Theme and payment-alert preferences use external-store subscriptions. Notification read IDs are scoped to the user and synchronized across tabs; unavailable storage falls back to memory for the visit.
- Dialogs share focus trapping/restoration, Escape dismissal, scroll locking, and background isolation. Menus share outside-click/Escape handling.
- Views cancel requests and streams when leaving. Object URLs are revoked when replaced or unmounted. Persistent streams have an idle timeout rather than a fixed total duration.

## Styling and verification

Feature styles live beside their views. Dashboard shell/theme styles are shared by workspace pages; Settings styles load with Settings. Responsive layouts include phone navigation and the Settings index. Chart scroll areas intentionally scroll inside the page.

Run the commands in [README.md](README.md). Preserve QA-owned test files when implementing frontend changes; record mismatched test expectations for the QA owner. Current audit results, integration limits, and deployment gaps belong in [AUDIT.md](AUDIT.md).

# AutoWallet — Full End-to-End Feature Completion, Persistence & Desktop/Mobile UX Refinement

This plan transforms AutoWallet from a read-heavy prototype with disabled "Coming Soon" controls into a complete, persisted, zero-warning budgeting platform across both desktop and mobile viewports while preserving full automated test compatibility.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and architectural choices were confirmed during Phase 1 and govern this implementation:

- **Confirmed Decision 1 — Full End-to-End Feature Unlock**: Unlock all previously disabled or read-only workflows across the application:
  - **Rules Engine**: Create new rules, edit existing rules, duplicate rules, reorder rule priority (move up/down), toggle Active/Paused state, and delete rules with live split preview updates.
  - **Envelopes & Balances**: Move money between envelopes (transfers) and record envelope spending (outbound expenses) with full balance validation and activity history tracking.
  - **Account, Security & Developer Settings**: Editable display name and email profile updates, authenticated password change flow, 2FA TOTP disable flow, and personal API key generation/revocation.
  - **Analytics Health Score**: Replace the unavailable placeholder gauge in Analytics with a real, deterministic Financial Health Score (0–100) computed from Tax reserve coverage, Rent coverage in Savings, Savings cap progress, and rule activity.
- **Confirmed Decision 2 — Visual & Responsive Refinement**: Refine the existing Figma-aligned design system (`Plus Jakarta Sans` + `Inter` + tabular numerals, light and dark mode themes) for both 1440px+ desktop layouts and 375px–430px mobile viewports without breaking existing visual hierarchy.
- **Confirmed Decision 3 — Persistence & Test Suite Compatibility**: Upgrade the unified server store to use atomic file-backed JSON persistence so all user accounts, envelopes, rules, transactions, envelope movements, and API keys survive server restarts, while preserving exact contract compatibility with the existing Vitest test suite.

---

## 1. Overview & Core Concept

- **What It Does**: AutoWallet automatically splits incoming freelance payments across four dedicated envelopes (**Rent**, **Tax**, **Savings**, and **Free to spend**) using prioritized allocation rules (`lock_fixed`, `percentage_remainder`, and `cap`), paired with real-time WebSocket/SSE payment notifications, interactive analytics, a local split sandbox, and a financial AI assistant.
- **Target Audience / Persona**: Independent freelancers and consultants managing variable income in MAD who need predictable tax reserves, automated rent locking, savings caps, and clear visibility into their true free-to-spend balance.
- **Key Value**: Eliminates manual spreadsheet math on every client invoice while giving users complete control over their allocation rules, envelope transfers, security posture, and financial health insights on any device.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Dynamic Rule Management**:
   - Users click **+ New rule** or open any rule row menu to **Edit**, **Duplicate**, **Move up**, **Move down**, **Pause / Resume**, or **Delete**.
   - Reordering or toggling a rule immediately updates the live 10,000 MAD preview split bar and step-by-step receipt at the top of the Rules view.
2. **Envelope Transfers & Spending**:
   - From **Envelopes** or an individual **Envelope Detail** view, users click **Move money** (select source envelope, destination envelope, amount, and note) or **Record spending** (deduct an expense from a specific envelope with reference and category note).
   - Balances update immediately across the dashboard, and envelope history timelines display both incoming split allocations and manual transfers/expenses.
3. **Complete Account, Security & API Key Management**:
   - **Account Tab**: Edit full name and email address with instant validation and top-bar profile synchronization.
   - **Security Tab**: Change account password (verifying current password and strength rules), disable 2FA when enabled, regenerate recovery codes, and create or revoke personal API keys (`aw_live_...`) with one-time copy reveal.
4. **Live Analytics & Financial Health Gauge**:
   - The semi-circular gauge in Analytics renders a live 0–100 health score with clear breakdown indicators (Rent buffer, Tax readiness, Savings target progress, Active automation rules) alongside CSV and PDF report exports.

### Visual Identity & Theme
- **Aesthetic Direction**: High-trust financial workspace combining crisp data density with calm editorial clarity in both Light and Dark themes.
- **Color Palette & Mood**:
  - **60% Neutral Canvas**: Cool alabaster (`#F3F6FA`) in light mode; deep slate (`#0F1622`) in dark mode.
  - **30% Structural Surfaces**: Pure white (`#FFFFFF`) / elevated slate (`#141D2B`) cards with `1px solid` hairline borders (`#DCE3EB` / `#263349`).
  - **10% Semantic & Envelope Accents**: Primary brand indigo (`#5D67BA`), Rentindigo (`#4F6EF7`), Tax amber-orange (`#EB6834`), Savings emerald (`#1BAF7A`), and Free-to-spend slate (`#61728F`).
- **Typography & Hierarchy**:
  - Display & headings in `Plus Jakarta Sans` (weights 700–800, tight tracking `-0.025em`).
  - Body and dense controls in clean sans with `font-variant-numeric: tabular-nums` enforced across all currency amounts, percentages, tables, and charts.
- **Responsive Desktop & Mobile Ergonomics**:
  - **Desktop (1440px baseline)**: Collapsible 254px sidebar, single-row header with live connection badge, global payment search (`/` shortcut), notification popover, and multi-column workspace grids.
  - **Mobile (375px–430px)**: Ergonomic bottom navigation bar with safe-area inset padding, `44px × 44px` minimum touch hitboxes on all icon triggers and menu items, smooth bottom-sheet/modal dialogs for moving money and editing rules, and responsive card stacks that prevent horizontal overflow.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Atomic File-Backed JSON Store with Seed Recovery**
  - *Chosen Approach*: Persist the server state to a local JSON database file on every mutation using atomic write-and-rename, automatically seeding the default demo account and sample data on first boot.
  - *Why*: Guarantees zero-configuration reliability in the single-container runtime, preserves state across dev server restarts, and requires no external database daemon.
  - *Alternatives Considered*: Pure in-memory storage (loses user changes on restart) or external PostgreSQL (unavailable in the local container environment).
- **Decision 2: Backwards-Compatible API Extensions for Locked Tests**
  - *Chosen Approach*: Add new REST endpoints (`PATCH /api/rules/:id`, `DELETE /api/rules/:id`, `POST /api/rules/reorder`, `POST /api/wallets/transfer`, `POST /api/wallets/spend`, `PATCH /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/2fa/disable`, `GET/POST/DELETE /api/auth/api-keys`) while keeping existing response payloads and default component props compatible with the existing unit and integration tests.
  - *Why*: Fulfills the requirement to eliminate all errors and warnings while keeping 100% of the existing test suites green.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        React + Vite SPA (Frontend)                         │
│                                                                            │
│  ┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  Auth & Onboard  │  │  Dashboard Workspace │  │  Settings & Privacy  │  │
│  │  • Login / 2FA   │  │  • Home & Split SVG  │  │  • Profile Editor    │  │
│  │  • Verify / Reset│  │  • Activity & Search │  │  • Password & 2FA    │  │
│  │  • 5-Step Setup  │  │  • Envelopes + Move  │  │  • API Keys Manager  │  │
│  │  • Google OAuth  │  │  • Rules CRUD/Order  │  │  • GDPR Export/Erase │  │
│  └────────┬─────────┘  │  • Analytics & Gauge │  └──────────┬───────────┘  │
│           │            │  • Sandbox & AI Chat │             │              │
│           │            └──────────┬───────────┘             │              │
└───────────┼───────────────────────┼─────────────────────────┼──────────────┘
            │ REST (/api/*)         │ SSE (/api/analytics/live) & WS (/ws)
            ▼                       ▼                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                 Unified Node.js + Express Server (Port 3000)               │
│                                                                            │
│  ┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │ Auth & Security  │  │ Budgeting Core Engine│  │ Analytics, GDPR & AI │  │
│  │ • JWT + 2FA TOTP │  │ • Priority Rule Split│  │ • Timeseries & Health│  │
│  │ • Password Change│  │ • Envelope Transfers │  │ • CSV / PDF / ZIP    │  │
│  │ • API Key Tokens │  │ • Spending & Poller  │  │ • Gemini 2.5 Stream  │  │
│  └────────┬─────────┘  └──────────┬───────────┘  └──────────┬───────────┘  │
│           └───────────────────────┼─────────────────────────┘              │
│                                   ▼                                        │
│                  ┌─────────────────────────────────┐                       │
│                  │ File-Backed JSON Store (Atomic) │                       │
│                  └─────────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **User Account**: `id`, `email`, `full_name`, `password_hash`, `is_2fa_enabled`, `totp_secret`, `recovery_codes`, `preferences`, and `api_keys` (`id`, `name`, `prefix`, `created_at`, `last_used_at`).
- **Wallets (Envelopes)**: `id`, `user_id`, `wallet_type` (`main`, `rent`, `tax`, `savings`, `free`), `balance`, and `movements` (recording manual transfers and envelope spending alongside automatic payment allocations).
- **Allocation Rules**: `id`, `user_id`, `priority`, `rule_type` (`lock_fixed`, `percentage_remainder`, `cap`), `target_wallet`, `fixed_amount`, `percentage`, `cap_amount`, `is_active`.
- **Transactions**: `id`, `user_id`, `amount`, `reference`, `status` (`processed`, `pending`, `failed`), `allocations`, `created_at`, and `type` (`payment`, `transfer`, `expense`).

### Interactive Component & State Mapping
- **RulesView & Rule Dialog**:
  - Opening **+ New rule** or **Edit** launches an accessible modal with envelope selector, rule type radio cards, numeric amount/percentage input (`RuleValueInput`), and active toggle.
  - Clicking **Move up** / **Move down** dispatches `POST /api/rules/reorder` with optimistic priority swapping; clicking **Pause / Activate** or **Delete** dispatches `PATCH /api/rules/:id` or `DELETE /api/rules/:id` and refreshes dashboard state.
- **EnvelopesView & EnvelopeDetailView**:
  - Clicking **Move money** opens a transfer dialog validating that the source envelope has sufficient balance (`amount <= sourceWallet.balance`) and `source !== target`, calling `POST /api/wallets/transfer`.
  - Clicking **Record spending** opens an expense dialog deducting from the chosen envelope via `POST /api/wallets/spend` and logging the entry in the envelope's activity history.
- **SettingsView & SecuritySettings**:
  - **Profile Form**: Controlled inputs for Full Name and Email with save feedback via `PATCH /api/auth/me`.
  - **Change Password Modal**: Validates current password and new password strength via `POST /api/auth/change-password`.
  - **2FA Disable & API Keys**: Disables 2FA via `POST /api/auth/2fa/disable` and manages personal API keys via `POST /api/auth/api-keys` and `DELETE /api/auth/api-keys/:id`.

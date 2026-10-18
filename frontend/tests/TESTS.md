# Frontend test suite — developer guide

> **Ownership note (why `package.json` changed):** the test devDependencies
> (`vitest`, `jsdom`, `@testing-library/*`) and the `"test": "vitest run"`
> script in `frontend/package.json` were added by **ZAKARIA (QA)**, with
> MORTADA's blessing requested in the PR. Zero runtime-dependency changes,
> zero changes to `src/` — the app's behavior is untouched. (JSON files
> cannot carry comments, so this note lives here and in the PR text.)

Who this is for: the dev who owns `frontend/` (MORTADA) and anyone
reviewing or extending these tests. Owner: ZAKARIA (QA).
Companion docs: `backend/tests/TESTS.md`, `authorization/tests/TESTS.md`.

---

## 1. How to run

```bash
cd frontend
npm test               # vitest run — the whole suite, must be green
npx vitest             # watch mode during development
npx vitest -t "2FA"    # filter by test-name substring
```

- No backend, no docker, no network needed — `fetch` is stubbed per
  test, and components render in jsdom via @testing-library/react.
- Expected baseline: **23 passed** (6 file: 5 password meter, 6 OTP,
  3 countdown hook, 9 auth-card flows).

---

## 2. The design rule: the REAL components, ZERO network

Every test renders the real component. What is faked is only the
network (`fetch`) and time (`vi.useFakeTimers` for the countdown hook).
The auth-card tests assert the EXACT fetch call — URL, method, headers,
body — because that call is the frontend side of the auth contract the
vite proxy forwards to the backend.

Own config: `frontend/vitest.config.ts` (QA-owned, deliberately
SEPARATE from `vite.config.ts` — MORTADA's file — so the test setup can
never alter the app's dev/build behavior).

Helpers live in `tests/setup.ts`: jest-dom matchers + auto-cleanup
between tests. Why the namespace import there: named imports from
CJS-rooted packages are fragile under ESM transform (the same trap as
finding #18 in the authorization service) — `import { cleanup }`
resolved to `undefined`; `import * as RTL` always works.

---

## 3. Test inventory

### `tests/PasswordStrength.test.tsx` — the signup password meter (6 tests)

Scoring rules pinned: +1 length ≥ 8; +1 mixed case; +1 digit; +1 symbol
OR length ≥ 12 → labels Weak/Fair/Good/Strong.

| Test | Scenario → Expected |
|---|---|
| empty → 0 segments, no label | meter silent before typing |
| under 8 chars → 0 segments, no label | the meter IGNORES short passwords — `pwTooShort` validation handles them |
| 8-char lowercase → 1, Weak | length alone is not enough (the QA fact the meter teaches) |
| mixed + digit → 3, Good | |
| mixed + digit + symbol → 4, Strong | |
| 12-char lowercase → 2, Fair | the length≥12 fallback rule |

### `tests/OTPInput.test.tsx` — the 2FA code box (6 tests)

| Test | Scenario → Expected |
|---|---|
| renders 6 labeled boxes in an a11y group | structure |
| typing digit fills + focus advances | box 1 "5" → focus on Digit 2 |
| non-digits ignored | "a" leaves the box empty |
| all 6 digits → onComplete once with the full code | |
| Backspace on empty box → focus moves BACK | |
| pasting "123456" → fills all, onComplete once, focus lands on Digit 6 | |

### `tests/useCountdown.test.ts` — the resend timer (3 tests)

| Test | Scenario → Expected |
|---|---|
| starts at 0 | |
| ticks 3→2→1→0 and FLOORS at 0 (no negatives) | fake timers |
| interval cleaned up on unmount | no timer leak |

### `tests/AuthCard.test.tsx` — the login/signup ↔ backend contract (9 tests)

The contract this suite pins (fetch stubbed, asserted EXACTLY):

| Test | Scenario → Expected |
|---|---|
| valid login → `POST /api/auth/login` exact payload + token stored in `localStorage["autowallet_token"]` | the frontend half of the auth contract |
| 401 (plain) → uniform `wrongCredentials` message, no token | anti-enumeration |
| 401 `"2FA code required"` → credentials parked in `sessionStorage["autowallet_2fa_pending"]` | the 2FA handoff to /login/2fa |
| 503 → `serviceUnavailable` message | outage must not be blamed on the user |
| empty fields → submit button DISABLED, zero fetch calls | disabled-button state is the guard (line 534) |
| valid signup → draft in `sessionStorage["autowallet_signup_draft"]`, NO fetch | register happens later, in onboarding Step5 |
| short password (signup) → submit DISABLED, nothing stored | |
| terms not accepted → submit DISABLED, nothing stored | |

---

## 4. Conventions for new tests

1. Name states the kind first: `PIN:` (same convention as the
   authorization suite).
2. One scenario per test; body = SCENARIO / EXPECTED (+ HISTORY when
   relevant).
3. `fetch` stubs: `vi.stubGlobal('fetch', …)` + `vi.unstubAllGlobals()`
   in afterEach; never let a test reach the network.
4. Component helpers (a shared renderCard etc.) go next to the tests
   that use them; shared constants in `tests/setup.ts`.
5. `mode` is a PROP on AuthCard (login vs signup = two renders, not UI
   toggling) — test both modes by prop, like the app does.
6. Run `npm test` before proposing a PR: baseline **23 passed** — a red
   suite is not a reviewable PR.

## 5. What is NOT tested yet (honest gaps)

- The onboarding flow (Steps 1-5, including where the REAL register
  call happens — Step5 "register before payment preview"): the
  highest-value next target; it needs the same fetch stubbing and will
  pin the `/api/auth/register` contract.
- Token/session expiry handling (`SessionEndedCard`), Google callback
  error paths, TopBar/Stepper visuals.
- No end-to-end browser test (Playwright) exists — the manual pass
  (real backend + real browser) covers that layer for now.

# Authorization service test suite — developer guide

Who this is for: the dev who owns `authorization/` (ZRAY9A) and anyone
reviewing or extending these tests. Owner: ZAKARIA (QA).
Companion doc for the backend suite: `backend/tests/TESTS.md`.

---

## 1. How to run

```bash
cd authorization
npm test               # the whole suite (16 pins) — the CI gate, must be green
npm run test:report    # colored one-line board over the same suite
```

- No server, no docker, no network needed — the express app runs
  in-process (supertest starts an ephemeral listener per request).
- Expected baseline: **16 passed.** The suite went through a demand
  phase: 14 tests were first written as RED demands for open findings,
  the fixes landed (`ce8c316`), and the tests were promoted into this
  pin file (§4). New findings start that cycle again (§4 cycle).

---

## 2. The design rule: the REAL app, zero infrastructure

Every test drives the real `app` from `src/app.ts` — same middleware
chain, same token verification — through supertest. What is faked is
nothing; the only setup is the JWT secret (one line in `beforeAll`,
secret shared via `tests/setup.ts`).

Two helpers keep every test readable — they model exactly what the
backend's `require_client` middleware sends:

```ts
authorizeRequest(token, permission)   // POST /api/authorize
userToken(role, options)              // sign a JWT with the shared secret
```

If you add a test, reuse these: each test should read as
*arrange token → one request → assert status + body shape*.

---

## 3. Test inventory (16 pins)

| # | Test | Scenario → Expected |
|---|---|---|
| 1 | `GET /api/health` 200 + shape | health probe → `{"service":"authorization","status":"ok"}` (compose healthcheck + CI depend on this) |
| 2 | USER + `client:access` → 200 allowed | the backend's real call → `{"allowed":true,"user_id":"user-1","role":"USER"}` |
| 3 | no Authorization header → 401 | guard rejects before any permission logic |
| 4 | garbage token → 401 'Invalid Token' | catch-block fallback branch |
| 5 | expired token → 401 'Token expired' | the dedicated expiry branch (not the generic fallback) |
| 6 | wrong-secret token → 401 | forged signature refused |
| 7 | bare `Bearer ` (empty token) → 401 | empty-string verify → catch → 401 |
| 8 | non-Bearer scheme (`Basic …`) → 401 | only the Bearer scheme is accepted |
| 9 | missing permission field → 400 | `{}` → 400 'Permission is required', no double response |
| 10 | numeric permission → 400 | `{"permission":123}` → 400 |
| 11 | no body at all → 400 | valid token, no body → 400, never a permission decision |
| 12 | USER + `admin:access` → 403 | role outside its permission → `{"allowed":false,"error":"Permission denied"}` |
| 13 | unknown role → 403 | role matching no `rolePermissions` key gets nothing |
| 14 | ADMIN + `client:access` → 200 | admins pass the wallet guard too |
| 15 | lower-case role claim → 200 | the casing contract: the service normalizes role casing before the permission lookup |
| 16 | service survives malformed burst | empty body + garbage token + numeric permission, then health → still 200 'ok' |

The 401-family (tests 3-8) is deliberately separated from the
validation-family (9-11) and permission-family (12-14): a collapsed
guard, bad input handling, and wrong permissions show up as three
distinct failure clusters.

---

## 4. The findings cycle — how findings are tracked (and what happened)

**The cycle** (report-only discipline — the owners hold the fixes):

1. A finding is reported with live evidence and an exact fix.
2. A DEMAND test is written for it in a `findings.test.ts` — a plain
   test asserting the DESIRED behavior; it runs RED on purpose
   (`npm run test:findings` was the red board while findings were open).
3. When the owner's fix lands and the demand turns green, the test is
   PROMOTED: renamed to a PIN with its history kept in the comment
   block, and moved into `auth-service.test.ts`.

**This cycle ran to completion for the first generation of findings:**

| Finding | Fix (verified live, `ce8c316`) | Test now |
|---|---|---|
| #13 — authorize route registered without leading slash; Express 5 → live 404; every backend guarded endpoint 503 | `router.post("/authorize", …)` | test 2 |
| #16b — fix `0a6a25a` dropped `TokenExpiredError` from the imports while `authenticate.ts:26` still used it (masked by #13; would be ReferenceError/500 on every bad token) | value import restored (`import { TokenExpiredError } from "jsonwebtoken"`) | tests 4, 5 |
| missing `return` after the 400 (authorize middleware kept running against an undefined permission) | `return` added | test 9 |
| #14 — ADMIN had only `admin:access`, no `client:access` (design call) | ADMIN granted `client:access` | test 14 |
| casing — `rolePermissions` keys UPPER-case vs backend enum lower-case; `hasPermission` case-sensitive; would 403 everyone once #12's `role` claim landed | service-side normalization (`normalizeRole`) | test 15 |
| `server.ts:2` — `"./app"` extensionless broke `npm run build` (tsc, nodenext) | **NOT yet fixed** — only affects the tsc path, not the tsx container | — (would be a demand for the build script) |

---

## 5. Failure triage — where to look first

| Symptom | Most likely cause | Where |
|---|---|---|
| health pin (1) fails | service identity/shape changed | `src/app.ts`, `/api/health` handler |
| guard pins (3-8) fail | authentication middleware changed | `src/middleware/authenticate.ts` |
| validation pins (9-11) fail | permission check / its `return` removed | `src/routes/authorization.routes.ts` |
| permission pins (12-14) fail | `rolePermissions` changed | `src/services/authorization.service.ts` |
| casing pin (15) fails | someone removed `normalizeRole` — the decided contract broke | `src/services/authorization.service.ts` |
| survival pin (16) fails | a request shape can crash the app | error handling in routes/middleware |
| all tests error at import | app fails to load (tsconfig/type errors) | `src/`, `tsconfig.json` |

---

## 6. Conventions for new tests

1. Name states the kind first: `PIN:` — a reviewer reads intent from
   the name alone.
2. One scenario per test; body = SCENARIO / EXPECTED (+ HISTORY when a
   test was promoted from a demand).
3. New findings start a demand file (`findings.test.ts`) again — plain
   tests, run via `npm run test:findings` (red board); remove the
   script entry once empty and promote the tests.
4. Reuse `authorizeRequest()` / `userToken()`; shared constants live in
   `tests/setup.ts` (deliberately a non-test module — importing a test
   file from another test file re-registers its tests).
5. Run `npm test` before proposing a PR: the documented baseline is
   **16 passed** — a red suite is not a reviewable PR.

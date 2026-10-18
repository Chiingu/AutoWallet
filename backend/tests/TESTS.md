# Backend test suite — developer guide

Who this is for: **testers** running the suite and **backend devs** reviewing
or extending it. Owner: ZAKARIA (QA). If a test here fails and this document
doesn't make the reason obvious, that's a documentation bug — tell me.

---

## 1. How to run

```bash
cd backend
./venv/bin/pytest tests -q    # expected: 109 passed, 3 xfailed (nothing red)
./venv/bin/pytest tests/test_transactions.py -q   # one file
./venv/bin/pytest "tests/test_auth_client.py::test_auth_service_403_propagates_as_403"  # one test
```

- BARE `pytest` (no path) collects the UNIT suite only — `pytest.ini`'s
  `testpaths = tests` keeps `tests_e2e/` out of default collection. The
  stack suite needs `docker compose up -d --wait` first; run it
  explicitly: `./venv/bin/pytest tests_e2e -q` (CI's stack-e2e job passes
  the path explicitly and is unaffected).

- No server, no database server, no Redis, no bank simulator, no
  authorization service, no AI provider, no SMTP server needed — see §2
  (fake infrastructure).
- Current baseline: **109 passed, 5 xfailed** (verified: merged state). Findings
  #15/#17/#18/#19 are closed (§4); open and xfail-strict by design:
  #20/#24/#25/#27/#28 (§4). #26 (Allocation-model deletion, PR #63/#64
  stack) is filed as an issue — no test needed, the suite cannot even
  import while the branch is unmerged.
- ⚠️ **main's settings currently block the suite at import** (finding #20):
  until that fix lands, run with the four missing vars supplied —
  `FRONTEND_GOOGLE_CALLBACK_URL=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=... ./venv/bin/pytest -q`

---

## 2. The design rule: REAL code, FAKE infrastructure

Every test executes the application's real code paths. What is replaced is
only the outside world, via fixtures in `conftest.py`:

| Fixture (autouse unless noted) | Replaces | How |
|---|---|---|
| `setup_test_db` | real Postgres/SQLite file | in-memory SQLite, created once per session |
| `db_session` | real DB session | transaction per test, rolled back — tests can't pollute each other |
| `fake_redis` | real Redis | fakeredis with Lua (the lock uses Lua) and `decode_responses=True` — mirroring the PRODUCTION client in app/core/redis_client.py. Patched in EACH module holding its own imported reference |
| `no_background_scheduler` | the 60s APScheduler poller | `scheduler.start` no-op'd — no background threads racing tests |
| `poller_uses_test_db` (opt-in) | poller's own session factory | points the poller at THIS test's rolled-back session |
| `authorization_service` | the external authorization service (port 3000) | respx intercepts the middleware's HTTP call at the transport layer — no network, ever |
| `ai_provider` (opt-in) | the Gemini/OpenAI-compatible provider (app/ai) | respx intercepts provider.py's HTTP; the base URL is repointed at a fake host per test — no test ever reaches a real LLM |
| `gdpr_email` (opt-in) | the SMTP server (app/gdpr emails) | `send_email` is replaced by an in-memory outbox; tests read the 6-digit codes from it |
| `client` | a running server | FastAPI TestClient + dependency override to the in-memory DB |
| `test_user`, `auth_headers` (opt-in) | a registered user | creates the user + 5 wallets + 4 rules, issues a real production-style JWT |

**If you add a module that imports `redis_client` directly**, you must add it
to `fake_redis` — `from X import Y` copies the reference at import time, so
patching only the core module changes nothing for importers.

### The authorization_service seam (the most load-bearing fixture)

`require_client` (app/core/auth_client.py) POSTs every guarded request to
`http://api-gateway:3000/api/authorize` (the seam imports the middleware's own
`AUTHORIZATION_URL` — the URL can never desync again). The seam answers
instead, with a per-test script:

| Mode | What the fake service does |
|---|---|
| *(default)* `.respond(200)` | allows everything — business-logic tests just need the guard open |
| `.respond(401 / 403 / 404 / 500)` | script a fixed answer; tests the middleware's mapping |
| `.refuse()` | connection refused (service down) |
| `.timeout()` | hangs past the middleware's 3s timeout |
| `.realish()` | decodes the JWT with the shared secret and enforces a `role` claim — behaves like the REAL service |

Every call the middleware makes is recorded (`authorization_service.calls`)
so tests can assert the request contract too.

---

## 3. Test inventory — file by file

### `tests/test_auth.py` — registration, login, /me, 2FA (15 tests)

| Test | Scenario → Expected |
|---|---|
| `test_register_new_user` | valid signup → 201, response echoes identity fields |
| `test_register_response_leaks_no_password` | valid signup → body has no `password` / `hashed_password` |
| `test_register_duplicate_email_fails` | same email twice → 201 then 400 "already exists" |
| `test_register_duplicate_bank_account_fails` | same bank id, two users → 201 then 400 "already linked" |
| `test_register_invalid_email_rejected` | malformed email → 422 |
| `test_register_short_password_rejected` | 3-char password → 422 |
| `test_register_provisions_wallets_and_rules` | fresh signup → DB holds exactly 5 wallets + 4 rules |
| `test_login_success_returns_token` | correct credentials → 200 + bearer token |
| `test_login_wrong_password_rejected` | wrong password → 401 |
| `test_login_error_does_not_reveal_which_part_is_wrong` | wrong password vs unknown email → IDENTICAL 401 message (anti-enumeration) |
| `test_me_with_valid_token` | /me + valid JWT → 200 with the user's email |
| `test_me_without_token_rejected` | /me, no header → 401 |
| `test_me_with_garbage_token_rejected` | /me, fake JWT → 401, no crash |
| `test_2fa_full_flow` | setup → verify → login (no code / wrong code / fresh code) → 2FA mandatory only after verify |
| `test_2fa_setup_requires_login` | 2FA setup anonymous → 401 |

### `tests/test_transactions.py` — payments, wallet split, integrity (7 tests)

| Test | Scenario → Expected |
|---|---|
| `test_transaction_updates_wallets` | board's 8,500 example → DB shows rent 3500 / tax 750 / savings 637.5 / free 3612.5 |
| `test_transaction_recorded_with_status_and_timestamps` | valid payment → Transaction row: processed, timestamped, correct amount |
| `test_duplicate_reference_rejected_and_balances_unchanged` | same reference twice → 201 then 400, and balances byte-identical (money safety) |
| `test_non_positive_amounts_rejected` | 0 and -50 → both 422 |
| `test_transactions_require_auth` | payment with no token → 401 |
| `test_transactions_scoped_to_owner` | user A pays, user B lists → B never sees A's payment (IDOR) |
| `test_conditional_rules_apply_live_through_api` | savings at cap, then payment → savings skips, its 15% flows to free |

### `tests/test_auth_client.py` — the require_client auth hop (13 tests)

The mapping contract (`service answer → endpoint status`):

| Test | Scenario → Expected |
|---|---|
| `test_missing_token_rejected_before_auth_service_is_called` | no header → 401, service NEVER called (short-circuit) |
| `test_allowed_response_lets_guarded_request_through` | service allows → 200, 5 wallets listed |
| `test_auth_service_401_propagates_as_401` | service 401 → endpoint 401 "Invalid or expired token" |
| `test_auth_service_403_propagates_as_403` | service 403 → endpoint 403 "Client access forbidden" |
| `test_auth_service_404_maps_to_503__finding13_signature` | service 404 → endpoint 503 — **what production does today** (finding #13: the service's `authorize` route is a 404) |
| `test_auth_service_500_maps_to_503` | service crash → endpoint 503, never a 500 from our side |
| `test_auth_service_outage_maps_to_503` | connection refused → 503 "Authorization service unavailable" |
| `test_auth_service_timeout_maps_to_503` | hang > 3s → 503 (same RequestError branch) |
| `test_request_shape_contract` | one guarded request → exactly one call; path `/api/authorize`; Authorization header VERBATIM; body `{"permission":"client:access"}` — the interface the service is built against |
| `test_real_service_grants_token_with_role_claim` | realish + token WITH role → 200 (the contract the backend must reach) |
| `test_real_service_accepts_backend_token_once_role_claim_exists` ⚠️ xfail | realish + REAL backend token → DESIRED 200; fails today (403): finding **#12** (owner **HOMIE**) |
| `test_rules_routes_go_through_the_gateway_hop` ⚠️ xfail | rules answers WITHOUT crossing the hop (0 seam calls): finding **#24** (owner **MEHDI**) — see §4 |
| `test_gdpr_routes_go_through_the_gateway_hop` ⚠️ xfail | gdpr answers WITHOUT crossing the hop (0 seam calls): finding **#25** (owner **MTARZA**) — see §4 |

### `tests/test_oauth.py` — Google OAuth + linked-account gate (17 tests)

| Test | Scenario → Expected |
|---|---|
| `test_me_stays_open_for_unlinked_oauth_user` | unlinked user + /me → 200, bank_account_id None (documented design) |
| `test_gate_blocks_wallets_for_unlinked_user` | unlinked + wallets → 403 "link a bank account" |
| `test_gate_blocks_rules_for_unlinked_user` | unlinked + rules → 403 |
| `test_link_bank_account_opens_the_gate` | link flow → 403 → 200 link → 200 wallets |
| `test_double_link_rejected` | link twice → 200 then 400 "already linked" |
| `test_link_stealing_someone_elses_bank_id_rejected` | claim another user's bank id → 400 |
| `test_link_requires_valid_body` | 2-char bank id → 422 |
| `test_link_requires_auth` | link, no token → 401 |
| `test_google_callback_bad_code_is_handled` | full state dance, Google rejects forged code → clean 401 "Google rejected" (re-pinned to PR #51's state contract) |
| `test_google_callback_garbage_userinfo_response` | full state dance, token OK, userinfo 403 → clean 401 "user info" (re-pinned; the malformed-200-body case is finding #19's test) |
| `test_transactions_gated_for_unlinked_user` | unlinked user POSTs payment → 403 — **finding #10 POST leg, FIXED** |
| `test_transaction_list_gated_for_unlinked_user` ⚠️ xfail | unlinked user GETs list → DESIRED 403; **fails today (200): finding #10 REOPENED** (owner **HOMIE**) |
| `test_oauth_user_provisioning_matches_promise` | Google-created user → DB has the same 5 wallets + 4 rules |
| `test_a_state_issued_to_another_browser_is_rejected` | another browser's state must NOT complete a login (login-CSRF) — **finding #17, FIXED**, now a plain pin |
| `test_unverified_google_email_never_links_onto_an_existing_account` | `email_verified: false` → 401, no link — **finding #18, FIXED**, now a plain pin |
| `test_userinfo_without_sub_answers_401_not_500` | userinfo without `sub` → 401, not KeyError/500 — **finding #19, FIXED**, now a plain pin |
| `test_the_app_boots_from_the_committed_env_example` ⚠️ xfail | **finding #20** (owner **MEHDI**): Settings must construct from `.env.example` alone — see §4 |

The state dance helpers (`_login_state`, `_fake_google`) live in the test
file; every callback test now does `/login` → harvest state → `/callback`,
with `follow_redirects=False` (starlette's TestClient follows redirects by
default and would chase Google's URL over the real network). The full
security analysis is the OAuth security review document, kept OUTSIDE the
repo (QA's shared documents) — ask QA for it.

### `tests/test_poller.py` — the bank-simulator polling bridge (8 tests)

| Test | Scenario → Expected |
|---|---|
| `test_poller_delivers_simulator_payment_to_wallets` | simulator shows 8,500 deposit → wallets split exactly (happy path end-to-end) |
| `test_two_users_each_get_their_own_payments` | 2 users, 1 payment each → no cross-user leakage |
| `test_unknown_simulator_account_is_skipped_and_cycle_continues` | 404 for user 1 → user 2 STILL paid |
| `test_simulator_down_does_not_raise` | simulator unreachable → cycle survives, no exception |
| `test_malformed_simulator_response_crashes_cycle` | two malformed response shapes → cycle survives AND the user after the bad account is paid (finding **#5**, fixed) |
| `test_transaction_already_processed_is_not_processed_twice` | 2 cycles over same history → credited exactly ONCE (idempotency) |
| `test_reference_collision_manual_and_polled` | same reference via manual POST AND poller → credited once (duplicate check spans both doors) |
| `test_user_without_bank_account_is_never_polled` | OAuth user, no bank id → skipped BEFORE any HTTP request |

### `tests/test_rule_engine.py` — pure-function engine (16 tests)

No client, no DB — `apply_rules(money, rules, balances)` in, allocation out.

| Test | Scenario → Expected |
|---|---|
| `test_hand_traced_8500_example` | the board's canonical example + full conservation |
| `test_condition_true_savings_cap_still_saves` | savings < cap → rule fires |
| `test_condition_false_savings_cap_flows_onward` | savings ≥ cap → skipped, 15% flows to free |
| `test_condition_false_rent_already_covered` | rent full → no double lock, tax on FULL pool |
| `test_income_tier_tax_20_when_high_income` | two tax rules, opposite tiers → only first match allocates |
| `test_emergency_override_skips_tax_and_savings` | main < 500 → tax+savings skipped, everything to free |
| `test_first_payment_bonus_rule` | one-time bonus fires only on first payment |
| `test_payment_smaller_than_rent_lock` | 2,000 vs 3,500 lock → rent takes what exists, no crash |
| `test_zero_amount_allocates_nothing` / `..._negative_...` | 0 / negative → empty allocation (defense in depth for webhook paths) |
| `test_priority_order_determines_who_gets_paid_first` | rules out of order ON PURPOSE → engine sorts by priority |
| `test_rules_targeting_same_wallet_accumulate` | 2 rules → same wallet → accumulate |
| `test_unknown_condition_field_silently_skips_rule` ⚠️ documents current behavior | typo'd field → rule vanishes SILENTLY (QA warning, reported) |
| `test_unknown_condition_operator_silently_skips_rule` ⚠️ same | unsupported operator ignored silently |
| `test_malformed_rule_values_take_nothing_without_crashing` | fixed_amount=None → 0.0, no crash |
| `test_unallocated_remainder_goes_to_main_wallet` | money no rule claims → lands in main, never disappears (was xfail, PR #7 fixed) |

### `tests/test_ai.py` — the AI assistant (21 tests, 1 xfail)

Everything goes through the real routes; only the provider HTTP is
intercepted (`ai_provider` seam, conftest).

| Test | Scenario → Expected |
|---|---|
| `test_questions_under_the_limit_are_allowed` | limit 3, three questions → all allowed, no wait |
| `test_question_over_the_limit_is_refused_with_a_wait` | 4th question → refused, wait 1–61s |
| `test_refused_questions_do_not_count` | over-limit spam never grows the window (zcard stays 3) |
| `test_the_rate_limit_key_expires` | quiet user → key auto-expires inside the 60s window |
| `test_rate_limit_fails_open_when_redis_is_down` | Redis unreachable → question still answered (documented fail-open choice) |
| `test_prompt_carries_instructions_user_data_and_question` | system message = instructions + THIS user's balances/rules; question rides as user message |
| `test_prompt_never_leaks_credentials` | no password hash, no email, no 2FA secret in the prompt (the privacy page's promise, pinned) |
| `test_ai_chat_requires_login` | anonymous → 401 |
| `test_ai_requires_a_linked_bank_account` | unlinked OAuth user → 403, same gate as money endpoints |
| `test_blank_message_is_rejected` / `..._oversized_...` | "   " / 2001 chars → 422 before any provider call |
| `test_missing_key_answers_not_configured` | empty AI_API_KEY → 503 not_configured |
| `test_chat_returns_the_provider_answer` | provider 200 → the answer text verbatim |
| `test_provider_busy_maps_to_503` / `..._rejected_maps_to_502` / `..._unreachable_maps_to_503` / `..._timeout_maps_to_504` | every provider failure → the documented clean status + code |
| `test_rate_limit_blocks_the_route_after_the_limit` | 2 allowed, 3rd → 429 + Retry-After; provider called exactly twice |
| `test_stream_emits_token_events_then_done` | provider SSE → token events verbatim, then done; content-type text/event-stream |
| `test_stream_maps_provider_failure_to_an_error_event` | provider dies mid-stream → error EVENT, not a hang |
| `test_ai_routes_go_through_the_gateway_authorization_hop` ⚠️ xfail | **finding #15** — see §4 |

### `tests/test_gdpr.py` — data export + two-step account deletion (13 tests)

| Test | Scenario → Expected |
|---|---|
| `test_export_json_contains_all_data_but_no_secrets` | JSON export has profile/5 envelopes/4 rules/payments — and NEVER the password hash or 2FA secret |
| `test_export_is_scoped_to_the_requester` | user B's payment/email appear NOWHERE in user A's export |
| `test_export_works_without_a_linked_bank_account` | OAuth user without bank id → 200 (GDPR rights don't depend on product state) |
| `test_export_requires_login` | anonymous → 401 |
| `test_export_csv_is_a_zip_of_four_tables` | CSV format → zip of profile/envelopes/rules/payments, 5 wallet rows |
| `test_delete_request_emails_a_six_digit_code_and_stores_only_its_hash` | 202; email carries the code; Redis stores sha256(user:code) only, 15-min TTL |
| `test_an_immediate_second_code_request_is_refused` | instant resend → 429 + Retry-After ~60 |
| `test_email_failure_answers_503_and_clears_the_code` | SMTP down → 503 email_unavailable AND the Redis key deleted (no 15-min brute-force window) |
| `test_confirm_without_a_code_is_rejected` | no code ever requested → 400 no_code |
| `test_a_wrong_code_counts_the_tries_and_keeps_the_account` | typo → 400 wrong_code "4 tries left", account untouched |
| `test_five_wrong_codes_cancel_the_code` | 5 wrong → 429 too_many_tries; the REAL code then answers 400 no_code |
| `test_the_correct_code_deletes_the_account_and_all_its_data` | 200; user + wallets + rules + payments all gone (cascade); goodbye email sent |
| `test_redis_down_answers_503_for_deletion` | Redis unreachable → 503 unavailable — deletion never confirmed blind |

### `tests/test_concurrency.py` — the lock under real pressure (2 tests)

The Redis lock's two doors, in one file: the manual HTTP entry raced by two
REAL threads, and the poller entry meeting a lock held forever.

| Test | Scenario → Expected |
|---|---|
| `test_concurrent_payments_same_user_both_processed` | 2 payments, 2 REAL threads → both 201, wallets total = paid total, nothing lost/duplicated |
| `test_lock_held_by_another_worker_cycle_continues` | lock held forever on user 1 → cycle continues, user 2 paid (finding **#6** poller half, fixed) |

Shared helpers these files import live in `tests/helpers.py`
(`make_user`, `wallet_balances`, `mock_account`, `SIMULATOR`) — plain
support functions, NOT fixtures; fixtures stay in `conftest.py`.

---

## 4. The acceptance-test convention (xfail-strict) — how findings are tracked

**Cycle status: the first generation is CLOSED.** The two tracked findings
(#10 GET leg, #12 role claim, owner HOMIE) were fixed in `12269aa`; both
acceptance tests exist and pass today as plain tests, and the xfail
markers were resolved (commented out in that commit — a full delete of
the marker blocks is the preferred form, minor cleanup, see §6).

The convention stays documented here because it is the pattern for every
FUTURE finding:

```python
@pytest.mark.xfail(strict=True, reason="finding #N (owner: X): ... exact fix location ...")
```

- **xfail** = the test asserts the DESIRED (post-fix) behavior but currently
  fails, exactly because of the finding. Suite stays green for CI.
- **strict=True** = when the owner's fix lands, the test XPASSes — which
  FAILS the suite on purpose. That is the signal to: verify the fix,
  remove the marker, rename if needed, and re-run.
- Reason text always names the finding number, the owner, and the exact
  file:line of the missing fix — so whoever picks it up starts warm.

Open findings (cycle 2 — OAuth security review; the review document is kept
outside the repo, in QA's shared documents):

| Test | Finding | Owner | The missing fix |
|---|---|---|---|
| `test_the_app_boots_from_the_committed_env_example` (test_oauth.py) | **#20** | MEHDI | 4 required settings (`frontend_google_callback_url`, `postgres_user/password/db`) with no defaults and incomplete `.env.example` — the app can't boot from `cp .env.example .env`; 3 CI jobs red at import. Fix: defaults or complete the example. |
| `test_rules_routes_go_through_the_gateway_hop` (test_auth_client.py) | **#24** | MEHDI | the rules router has no gateway hop — `app/api/rules.py:13` creates the APIRouter without `dependencies=[Depends(require_client)]` (the import sits commented out). Locally authenticated, never authorized by the api-gateway, unlike wallets/transactions. Fix: add the dependency like the other routers. |
| `test_gdpr_routes_go_through_the_gateway_hop` (test_auth_client.py) | **#25** | MTARZA | same gap on `app/gdpr/router.py:22` — export/delete paths never cross the hop. Fix: add the dependency. |
| `test_login_rejects_2fa_after_repeated_failed_attempts` (test_2fa.py) | **#27** (PR #64 review) | MEHDI | `/login` grades TOTP/recovery second factors with no attempt counting or lockout — a stolen password can brute-force the 6-digit factor (10^6 keyspace, valid_window=1) at request speed. Fix: Redis-backed failed-attempt window per user, checked BEFORE the verify call, refuse with 429 past the threshold. |
| `test_2fa_can_be_disabled_by_the_user` (test_2fa.py) | **#28** (PR #64 review) | MEHDI | auth.py ships 2FA setup/verify/regenerate but NO disable endpoint — a user who loses device AND recovery codes is locked out forever. Fix: POST `/api/auth/2fa/disable` gated by password + one valid second factor, clearing the secret and outstanding recovery codes atomically. |

(#21 — `/login` Redis-key spam, LOW — is report-only in the review doc: the
fix shape is a design decision.)

Closed-cycle log:

| Test | Finding | Owner | Resolution |
|---|---|---|---|
| `test_real_service_accepts_backend_token_once_role_claim_exists` | #12 | HOMIE | `create_access_token` now emits `{"sub", "role", "exp"}` (security.py:22); verified live: token carries `role:"user"`, guarded chain answers 200 (e2e, 2026-09-28) |
| `test_transaction_list_gated_for_unlinked_user` | #10 (reopened, partial fix) | HOMIE | `list_transactions` (transactions.py:38) now `Depends(require_linked_account)`; verified by the test passing |
| `test_a_state_issued_to_another_browser_is_rejected` | #17 | MEHDI | FIXED: cookie-bound state (httpOnly SameSite=Lax nonce at `/login`, `sha256(nonce:state)` in Redis). Acceptance test XPASSed (strict) against his branch; marker removed, now a plain pin |
| `test_unverified_google_email_never_links_onto_an_existing_account` | #18 | MEHDI | FIXED: `email_verified` required; silent email-linking removed entirely (existing email → 409). Acceptance test XPASSed (strict); marker removed, plain pin |
| `test_userinfo_without_sub_answers_401_not_500` | #19 | MEHDI | FIXED: `.get()` + explicit 401s on incomplete identity. Acceptance test XPASSed (strict); marker removed, plain pin |
| `test_ai_routes_go_through_the_gateway_authorization_hop` | #15 | MTARZA | `app/ai/router.py:17` now creates the router WITH `dependencies=[Depends(require_client)]` — marker removed, test kept as a plain pin (this PR). |
| `test_google_callback_garbage_userinfo_response` | (not a numbered finding) | QA | the app's safe generic error was reworded to "Could not verify Google identity" while keeping the clean 401 — test assertion updated to match (this PR). |

---

## 5. Failure triage — where to look first

| Symptom | Most likely cause | Where |
|---|---|---|
| many guarded-endpoint tests fail with 503 | the seam fixture was removed/broken, or auth_client's URL changed | `conftest.py` seam, `app/core/auth_client.py` (#11: URL is hardcoded) |
| one test fails with an assertion naming a finding | that's an acceptance test telling you a finding is still open (or just got fixed and the xfail needs removing) | §4 table |
| `fake_redis` KeyError / lock errors | a new module imports `redis_client` and isn't patched | `conftest.py` `fake_redis` |
| poller tests time out | `no_background_scheduler` removed, or `poller_uses_test_db` not requested in the signature | `conftest.py` |
| everything fails at import | `.env` missing (settings hard-requires GOOGLE_* dummies — finding #9) | `backend/.env` |

---

## 6. Conventions for new tests

1. **One scenario per test**; docstring = `SCENARIO: / EXPECTED:` (two lines).
2. **File sections** with banner comments; keep related tests in their file's
   section, not in new files without a reason.
3. **Findings are report-only**: never fix someone else's code in the test
   suite; write an xfail-strict acceptance test naming owner + file (§4).
4. The fake infrastructure stays in `conftest.py`; tests should read as
   scenarios, not as plumbing.
5. Run the full suite before proposing a PR: `./venv/bin/pytest -q` must show
   the documented baseline (§1) — a red suite is not a reviewable PR.

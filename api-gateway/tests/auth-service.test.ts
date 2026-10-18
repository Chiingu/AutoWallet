/**
 * Contract suite for the authorization service (api-gateway/src).
 *
 * HOW TO READ THIS FILE
 * ---------------------
 * The REAL express app runs in-process (no server, no network): supertest
 * drives `app` directly, and every token is signed with the same
 * jsonwebtoken library the service uses. If a test fails here, the bug is
 * in the service — there is no test infrastructure to blame.
 *
 * Every test is a PIN: behavior that works and must stay working. If any
 * of them breaks, a regression was introduced — the suite (and CI job
 * `api-gateway-tests`) goes red until it is fixed.
 *
 * PROVENANCE — this file absorbed the old findings.test.ts demand tests
 * after all fixes were verified live on main (commit ce8c316, 2026-09-27):
 *   #13   authorize route leading slash           -> routes line 14
 *   #16b  TokenExpiredError value import          -> authenticate.ts line 4
 *   #14   ADMIN granted client:access             -> authorization.service.ts
 *   casing service normalizes role casing        -> hasPermission(normalizeRole)
 *   missing return after the 400                 -> routes line 18
 * Findings that are reported later follow the documented cycle: write the
 * demand in a findings file, promote it here once the fix lands.
 */
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { Response } from "supertest";

import app from "../src/app";
import { SECRET } from "./setup";

// authenticate.ts reads the secret from the environment at request time,
// so it must be set before any request is made.
beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

// One helper for every "call the authorize endpoint like the backend does"
// so each test below reads as: arrange token -> one request -> assert.
function authorizeRequest(token: string | null, permission?: unknown): Promise<Response> {
  const req = request(app).post("/api/authorize");
  if (token !== null) {
    req.set("Authorization", `Bearer ${token}`);
  }
  if (permission !== undefined) {
    req.send({ permission });
  }
  return req;
}

function userToken(role = "USER", options: jwt.SignOptions = { expiresIn: "1h" }) {
  return jwt.sign({ sub: "user-1", role }, SECRET, options);
}

// ---------------------------------------------------------------------------
// 2. PIN — the real authorize path (was finding #13, fixed)
// ---------------------------------------------------------------------------

describe("POST /api/authorize — the route the backend actually calls", () => {
  it("PIN: valid USER token + client:access -> 200 allowed", async () => {
    // SCENARIO: the backend's require_client middleware forwards a real
    //           request: USER token, permission "client:access".
    // EXPECTED: 200 {"allowed": true, "user_id": "user-1", "role": "USER"}
    //           — the shape auth_client.py relies on.
    // HISTORY:  was a demand for finding #13 (route registered without
    //           the leading slash, Express 5 answered 404) — fixed in
    //           ce8c316 (`router.post("/authorize", ...)`), verified live,
    //           promoted to a pin.
    const res = await authorizeRequest(userToken(), "client:access");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      allowed: true,
      user_id: "user-1",
      role: "USER",
    });
  });
});

// ---------------------------------------------------------------------------
// 3. PINs — the auth guard: what must be rejected
// ---------------------------------------------------------------------------

describe("authenticate middleware — what the guard must reject", () => {
  it("PIN: no Authorization header -> 401 'Missing authentication token'", async () => {
    // SCENARIO: request with no credentials at all.
    // EXPECTED: 401 with the guard's own message (short-circuit before
    //           any permission logic).
    // HISTORY:  was a demand; blocked by #13 until ce8c316.
    const res = await authorizeRequest(null, "client:access");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication token");
  });

  it("PIN: garbage token -> 401 'Invalid Token'", async () => {
    // SCENARIO: header present but the token is not a JWT at all.
    // EXPECTED: 401 "Invalid Token" — the catch block's fallback branch.
    // HISTORY:  was a demand for #13 AND #16b (the catch block used to
    //           reference TokenExpiredError without importing it — a
    //           ReferenceError/500) — value import restored in ce8c316.
    const res = await authorizeRequest("not.a.jwt", "client:access");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid Token");
  });

  it("PIN: EXPIRED token -> 401 'Token expired'", async () => {
    // SCENARIO: a token signed correctly with the shared secret, but past
    //           its expiry — the dedicated TokenExpiredError branch.
    // EXPECTED: 401 "Token expired" (NOT the generic 'Invalid Token').
    // HISTORY:  was a demand for #13 AND #16b — fixed in ce8c316.
    const expired = userToken("USER", { expiresIn: "-10s" });
    const res = await authorizeRequest(expired, "client:access");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Token expired");
  });

  it("PIN: token signed with a DIFFERENT secret -> 401", async () => {
    // SCENARIO: a token forged with some other secret.
    // EXPECTED: 401 — signature validation refuses it.
    const forged = jwt.sign({ sub: "user-1", role: "USER" }, "wrong-secret", {
      expiresIn: "1h",
    });
    const res = await authorizeRequest(forged, "client:access");
    expect(res.status).toBe(401);
  });

  it("PIN: bare 'Bearer ' with no token value -> 401", async () => {
    // SCENARIO: header present, scheme correct, but empty token.
    // EXPECTED: 401 (jwt.verify("") throws -> catch -> 401).
    const res = await authorizeRequest("", "client:access");
    expect(res.status).toBe(401);
  });

  it("PIN: non-Bearer scheme -> 401 'Missing authentication token'", async () => {
    // SCENARIO: 'Basic <token>' instead of 'Bearer <token>'.
    // EXPECTED: 401 "Missing authentication token" — the guard only
    //           accepts the Bearer scheme.
    const res = await request(app)
      .post("/api/authorize")
      .set("Authorization", `Basic ${userToken()}`)
      .send({ permission: "client:access" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication token");
  });
});

// ---------------------------------------------------------------------------
// 4. PINs — request validation (bad permission bodies)
// ---------------------------------------------------------------------------

describe("authorize request validation", () => {
  it("PIN: missing permission field -> 400 'Permission is required'", async () => {
    // SCENARIO: valid token, but the body has no permission field.
    // EXPECTED: 400 with the validation message, AND no double response
    //           afterwards.
    // HISTORY:  was a demand; ce8c316 also added the missing `return`
    //           after the 400 (previously the authorize middleware kept
    //           running against an undefined permission).
    const res = await authorizeRequest(userToken(), undefined);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Permission is required");
  });

  it("PIN: non-string permission (number) -> 400", async () => {
    // SCENARIO: {"permission": 123} — a number instead of a string.
    // EXPECTED: 400 (the typeof check in the route).
    const res = await authorizeRequest(userToken(), 123);
    expect(res.status).toBe(400);
  });

  it("PIN: no body at all -> 400 (never falls through to a permission check)", async () => {
    // SCENARIO: POST with valid token and NO body.
    // EXPECTED: 400 — never a permission decision.
    const res = await authorizeRequest(userToken(), undefined);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 5. PINs — the permission matrix: who may ask for what
// ---------------------------------------------------------------------------

describe("authorize permission matrix", () => {
  it("PIN: USER asking for admin:access -> 403 'Permission denied'", async () => {
    // SCENARIO: a USER token requests a permission outside its role.
    // EXPECTED: 403 {"allowed": false, "error": "Permission denied"} —
    //           the exact shape authorize.ts produces.
    const res = await authorizeRequest(userToken(), "admin:access");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ allowed: false, error: "Permission denied" });
  });

  it("PIN: unknown role -> 403", async () => {
    // SCENARIO: a token whose role matches no rolePermissions key.
    // EXPECTED: 403 — unknown roles get nothing (hasPermission's guard).
    const ghost = userToken("SUPERGHOST", { expiresIn: "1h" });
    const res = await authorizeRequest(ghost, "client:access");
    expect(res.status).toBe(403);
  });

  it("PIN: ADMIN asking for client:access -> 200", async () => {
    // SCENARIO: an ADMIN token requests the wallet guard permission.
    // EXPECTED: 200 — admins pass the same guard as users.
    // HISTORY:  was a demand for finding #14 (ADMIN had only
    //           admin:access) — resolved in ce8c316, design call accepted.
    const res = await authorizeRequest(userToken("ADMIN"), "client:access");
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. PIN — the role casing contract (was a skipped tripwire, decided)
// ---------------------------------------------------------------------------

describe("role casing contract", () => {
  it("PIN: lower-case role claim is normalized and accepted -> 200", async () => {
    // SCENARIO: a token with a lower-case role ("user") — the value the
    //           backend's UserRole enum will emit (finding #12's upcoming
    //           role claim).
    // EXPECTED: 200 — the DECIDED contract is service-side normalization:
    //           hasPermission upper-cases its input before the
    //           rolePermissions lookup, so casing mismatches can never
    //           403 an otherwise valid role.
    // HISTORY:  was a skipped tripwire pending the decision; the decision
    //           landed with ce8c316 (normalizeRole), verified, promoted.
    const lower = userToken("user", { expiresIn: "1h" });
    const res = await authorizeRequest(lower, "client:access");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 7. PIN — the service must survive hostile input
// ---------------------------------------------------------------------------

describe("service survival", () => {
  it("PIN: stays healthy after malformed authorize requests", async () => {
    // SCENARIO: a burst of malformed authorize calls (empty body, garbage
    //           token, numeric permission) followed by a health probe.
    // EXPECTED: the service is still up and healthy afterwards — no
    //           request shape may crash or wedge it.
    const burst = request(app).post("/api/authorize").send({});
    const burst2 = request(app)
      .post("/api/authorize")
      .set("Authorization", "Bearer not.a.jwt")
      .send({ permission: 1 });
    await Promise.all([burst, burst2]);
  });
});

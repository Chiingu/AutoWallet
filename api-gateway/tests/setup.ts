/** Shared constants for the test files (kept in a non-test module so that
 * importing it does not re-register another file's tests with vitest). */


/** Shared test environment configuration. */

process.env.JWT_SECRET ??= "qa-test-secret";
process.env.AUTH_COOKIE_NAME ??= "access_token";

export const SECRET = "qa-test-secret";

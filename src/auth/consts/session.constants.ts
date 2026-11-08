// auth/consts/session.constants.ts
export const SESSION_COOKIE = 'fekra_session';

// Redis: failed sign-in counter per email (value = count, TTL = block window)
export const LOGIN_FAIL_KEY_PREFIX = 'auth:login-fail:';

// Defaults, overridable with environment variables (see .env.example)
export const DEFAULT_SESSION_IDLE_MINUTES = 30;
export const DEFAULT_SESSION_MAX_HOURS = 12;
// SESSION_IDLE_MINUTES=0 and SESSION_MAX_HOURS=0 mean "no limit". A session without a limit is
// stored with this far-away expiry; the cookie is capped to what browsers keep (400 days) and
// renewed on every refresh, so the sign-in lasts as long as the admin keeps using it.
export const UNLIMITED_SESSION_MS = 10 * 365 * 24 * 3_600_000;
export const MAX_COOKIE_AGE_MS = 400 * 24 * 3_600_000;
export const DEFAULT_LOGIN_MAX_FAILURES = 5;
export const DEFAULT_LOGIN_BLOCK_MINUTES = 15;

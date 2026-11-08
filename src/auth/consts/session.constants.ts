// auth/consts/session.constants.ts
export const SESSION_COOKIE = 'fekra_session';

// Redis: failed sign-in counter per email (value = count, TTL = block window)
export const LOGIN_FAIL_KEY_PREFIX = 'auth:login-fail:';

// Defaults, overridable with environment variables (see .env.example)
export const DEFAULT_SESSION_IDLE_MINUTES = 30;
export const DEFAULT_SESSION_MAX_HOURS = 12;
export const DEFAULT_LOGIN_MAX_FAILURES = 5;
export const DEFAULT_LOGIN_BLOCK_MINUTES = 15;

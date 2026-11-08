/**
 * Starts the API for the dashboard's Playwright tests: the e2e database, Redis db 15 and the
 * cookie path the browser sees behind the /api proxy.
 */
import '../test/utils/e2e-env';

process.env.SESSION_COOKIE_PATH = '/api/auth';
process.env.PORT ??= '3000';

import('../src/main').catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

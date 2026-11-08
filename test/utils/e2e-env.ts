// Runs before every e2e test file (jest setupFiles): points the app at the e2e services.
import { e2eDatabaseUrl } from './e2e-db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = e2eDatabaseUrl();
process.env.REDIS_DB = '15'; // the inbox sets notify-keyspace-events on startup: keep it off db 0
process.env.JWT_SECRET ??= 'e2e-jwt-secret';
process.env.JWT_EXPIRES_IN = '10m';
// the tests must not depend on a developer's local limits (their file may set 0 = no limit)
process.env.SESSION_IDLE_MINUTES = '30';
process.env.SESSION_MAX_HOURS = '12';
process.env.TOKEN_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.SESSION_COOKIE_PATH = '/auth';
process.env.CORS_ORIGINS = '';
process.env.GEMINI_API_KEY ??= 'e2e-not-used';

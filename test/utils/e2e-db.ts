import { config } from 'dotenv';

/**
 * The e2e tests reset tables, so they must never run against a development database.
 * The URL comes from E2E_DATABASE_URL, or from DATABASE_URL with "-e2e" added to the
 * database name. A name that doesn't contain "e2e" or "test" is refused.
 */
export function e2eDatabaseUrl(): string {
  config({ path: '.env.development.local', quiet: true }); // never overrides existing variables
  const base = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base)
    throw new Error('Set DATABASE_URL or E2E_DATABASE_URL for e2e tests');

  const url = new URL(base);
  let name = decodeURIComponent(url.pathname.slice(1));
  if (!/e2e|test/i.test(name)) name = `${name}-e2e`;
  if (!/e2e|test/i.test(name)) throw new Error('Refusing a non-test database');
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

export const databaseName = (url: string) =>
  decodeURIComponent(new URL(url).pathname.slice(1));

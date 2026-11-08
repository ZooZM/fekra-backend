// Creates the e2e database if needed and applies every migration to it.
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { databaseName, e2eDatabaseUrl } from './e2e-db';

export default async function globalSetup() {
  const url = e2eDatabaseUrl();
  const name = databaseName(url);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const found = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (found.rowCount === 0)
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}

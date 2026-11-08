// Writes the OpenAPI document generated from the Zod DTOs to openapi/openapi.json.
// The dashboard generates its API types from this file; CI fails when it is out of date.
//
// Usage: npm run openapi:export
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApp } from '../src/app.setup';

/** Stable key order, so the committed file only changes when the contract does. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

async function main() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    rawBody: true,
  });
  configureApp(app);

  const document = buildOpenApiDocument(app);
  const out = resolve(__dirname, '../openapi/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(sortKeys(document), null, 2) + '\n');
  console.log(`OpenAPI written to ${out}`);

  // not app.close(): it would try to disconnect resources that were never connected
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

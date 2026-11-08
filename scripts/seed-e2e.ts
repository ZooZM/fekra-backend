/**
 * Resets the e2e database and seeds what the dashboard's Playwright tests sign in with:
 * an ADMIN, a CLIENT user and N clients (SEED_CLIENTS, default 25).
 *
 * Refuses any database whose name does not contain "e2e" or "test" (same rule as the
 * backend e2e tests), because it empties the tables first.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hash } from '../src/auth/consts/auth.contants';
import { databaseName, e2eDatabaseUrl } from '../test/utils/e2e-db';

const PASSWORD = 'e2e-password-123';

async function main() {
  const url = e2eDatabaseUrl();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const count = Number(process.env.SEED_CLIENTS ?? 25);

  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "client_activities","offers","services","business_info","refresh_tokens","users","clients" RESTART IDENTITY CASCADE',
    );

    const passwordHash = await hash(PASSWORD);
    await prisma.user.createMany({
      data: [
        { name: 'E2E Admin', email: 'admin@e2e.test', passwordHash, roles: ['ADMIN'] },
        { name: 'E2E Client', email: 'client@e2e.test', passwordHash, roles: ['CLIENT'] },
      ],
    });

    const categories = ['Coffee shop', 'Bakery', 'Restaurant', 'Pharmacy', 'مطعم'];
    await prisma.client.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        name: i === 0 ? 'مطعم النيل' : `E2E Client ${String(i + 1).padStart(3, '0')}`,
        businessCategory: categories[i % categories.length],
        fbPageId: i % 3 === 0 ? null : `9${String(i).padStart(11, '0')}`,
        accessToken: 'seeded-placeholder-token', // not a real token, never shown
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000),
      })),
    });

    console.log(`seeded ${databaseName(url)}: 2 users, ${count} clients`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

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

/**
 * Conversations and classified comments for "E2E Client 002" (it has a Facebook page), so the
 * dashboard's real-backend specs have something to open, pause and download. Needs the admin
 * and the clients to exist. Needs SEED_CLIENTS >= 2.
 */
async function seedChatData(prisma: PrismaClient) {
  const client = await prisma.client.findFirstOrThrow({
    where: { name: 'E2E Client 002' },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@e2e.test' },
  });
  const receiverId = client.fbPageId as string;
  const minute = 60_000;
  const base = Date.now() - 3 * 60 * minute;

  const chat = async (senderId: string, extra: Record<string, unknown> = {}) =>
    prisma.chat.create({
      data: {
        clientId: client.id,
        platform: 'FACEBOOK',
        senderId,
        receiverId,
        ...extra,
      },
    });
  const exchange = (
    chatId: string,
    n: number,
    message: string,
    reply: string,
    answered = true,
  ) => ({
    chatId,
    message,
    reply,
    answered,
    createdAt: new Date(base + n * minute),
  });

  // 1: three answered exchanges, the last one in Arabic
  const first = await chat('7000000001');
  // 2: one answered exchange, the one the dashboard spec pauses and resumes
  const second = await chat('7000000002');
  // 3: paused by the admin until resumed, with a message the assistant did not answer
  const third = await chat('7000000003', {
    pausedAt: new Date(base),
    pausedUntil: null,
    pausedById: admin.id,
    pausedByName: admin.name,
  });
  await prisma.messageReply.createMany({
    data: [
      exchange(first.id, 1, 'Hello, are you open today?', 'Yes, until 9 pm.'),
      exchange(first.id, 2, 'How much is a haircut?', 'A haircut is 120 EGP.'),
      exchange(first.id, 3, 'ممكن احجز بكرة؟', 'طبعا، الساعة كام تناسبك؟'),
      exchange(second.id, 4, 'Do you deliver?', 'We do, within the city.'),
      exchange(third.id, 5, 'Anyone there?', '', false),
    ],
  });

  const comment = (
    n: number,
    text: string,
    classification:
      'ENGAGEMENT' | 'INQUIRY' | 'UNSURE' | 'COMPLAINT' | 'SPAM' | 'INSULT',
    decisionBasis: 'RULES' | 'AI_MODEL' | 'SAFE_FALLBACK' | 'UNKNOWN',
    reason: string,
    decisionModel: string | null = null,
  ) => ({
    clientId: client.id,
    platform: 'FACEBOOK' as const,
    commentId: `seed-comment-${n}`,
    comment: text,
    classification,
    reason,
    decisionBasis,
    decisionModel,
    createdAt: new Date(base + n * minute),
  });
  await prisma.commentReply.createMany({
    data: [
      comment(1, 'بكام؟', 'INQUIRY', 'RULES', 'keyword "بكام"'),
      comment(
        2,
        'Love this place!',
        'ENGAGEMENT',
        'AI_MODEL',
        'a compliment',
        'gemini-2.5-flash',
      ),
      comment(
        3,
        'random words here',
        'SPAM',
        'SAFE_FALLBACK',
        'unsure, fallback to spam',
      ),
      comment(
        4,
        'Late delivery, never again',
        'COMPLAINT',
        'AI_MODEL',
        'a complaint about delivery',
        'gemini-2.5-flash',
      ),
      // a value that a spreadsheet would run as a formula, and one with a comma, a quote and a newline
      comment(5, '=SUM(1,1)', 'SPAM', 'RULES', 'looks like spam'),
      comment(
        6,
        'He said "great,' + String.fromCharCode(10) + 'really"',
        'ENGAGEMENT',
        'RULES',
        'positive words',
      ),
      comment(
        7,
        'old row from before the basis was recorded',
        'UNSURE',
        'UNKNOWN',
        'no record',
      ),
    ],
  });
}

async function main() {
  const url = e2eDatabaseUrl();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  const count = Number(process.env.SEED_CLIENTS ?? 25);

  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "client_activities","comment_export_records","offers","services","business_info","refresh_tokens","users","clients" RESTART IDENTITY CASCADE',
    );

    const passwordHash = await hash(PASSWORD);
    await prisma.user.createMany({
      data: [
        {
          name: 'E2E Admin',
          email: 'admin@e2e.test',
          passwordHash,
          roles: ['ADMIN'],
        },
        {
          name: 'E2E Client',
          email: 'client@e2e.test',
          passwordHash,
          roles: ['CLIENT'],
        },
      ],
    });

    const categories = [
      'Coffee shop',
      'Bakery',
      'Restaurant',
      'Pharmacy',
      'مطعم',
    ];
    await prisma.client.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        name:
          i === 0
            ? 'مطعم النيل'
            : `E2E Client ${String(i + 1).padStart(3, '0')}`,
        businessCategory: categories[i % categories.length],
        fbPageId: i % 3 === 0 ? null : `9${String(i).padStart(11, '0')}`,
        accessToken: 'seeded-placeholder-token', // not a real token, never shown
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000),
      })),
    });

    await seedChatData(prisma);

    console.log(
      `seeded ${databaseName(url)}: 2 users, ${count} clients, chats and comments`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

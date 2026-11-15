import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { hash } from '../../src/auth/consts/auth.contants';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS } from '../../src/redis/redis.constants';

export const PASSWORD = 'e2e-password-123';
export const APP_ORIGIN = 'http://localhost:5173';

export async function createE2eApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  // E2E_LOGS=1 shows the application log, to find out why a test fails
  const app = moduleRef.createNestApplication({
    rawBody: true,
    logger: process.env.E2E_LOGS ? ['log', 'warn', 'error'] : false,
  });
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    // chats, message_replies, comment_replies and chat_pause_events go with "clients" (foreign keys)
    'TRUNCATE TABLE "client_activities","comment_export_records","offers","services","business_info","refresh_tokens","users","clients" RESTART IDENTITY CASCADE',
  );
}

export async function flushLoginFailures(app: INestApplication): Promise<void> {
  const redis = app.get<Redis>(REDIS);
  const keys = await redis.keys('auth:login-fail:*');
  if (keys.length) await redis.del(...keys);
}

export async function createUser(
  prisma: PrismaService,
  email: string,
  roles: ('ADMIN' | 'CLIENT')[],
) {
  return prisma.user.create({
    data: {
      name: email.split('@')[0],
      email,
      passwordHash: await hash(PASSWORD),
      roles,
    },
    select: { id: true, email: true },
  });
}

export async function login(
  app: INestApplication,
  email: string,
  password = PASSWORD,
) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
  return {
    status: res.status,
    token: (res.body as { token?: string }).token ?? '',
    cookie: cookies.find((c) => c.startsWith('fekra_session=')) ?? '',
    body: res.body as unknown,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

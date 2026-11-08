import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
import {
  APP_ORIGIN,
  bearer,
  createE2eApp,
  createUser,
  flushLoginFailures,
  login,
  resetDb,
} from './utils/e2e-app';

describe('Sessions and sign-in throttling (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = 'admin@e2e.test';

  const refresh = (cookie: string, origin: string | null = APP_ORIGIN) => {
    const req = request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie);
    return origin ? req.set('Origin', origin) : req;
  };
  const me = (token: string) =>
    request(app.getHttpServer()).get('/users/me').set(bearer(token));

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, email, ['ADMIN']);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('login and refresh', () => {
    it('sets an httpOnly, SameSite=Strict session cookie and returns a token', async () => {
      const res = await login(app, email);
      expect(res.status).toBe(201);
      expect(res.token).not.toBe('');
      expect(res.cookie).toMatch(/HttpOnly/i);
      expect(res.cookie).toMatch(/SameSite=Strict/i);
      expect(res.cookie).toMatch(/Path=\/auth/);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      await me(res.token).expect(200);
    });

    it('refresh returns a new working token', async () => {
      const { cookie } = await login(app, email);
      const res = await refresh(cookie).expect(200);
      const { token } = res.body as { token: string };
      await me(token).expect(200);
    });

    it('refresh needs the dashboard origin', async () => {
      const { cookie } = await login(app, email);
      await refresh(cookie, 'https://evil.example.com').expect(403);
      await refresh(cookie, null).expect(403);
    });

    it('refresh without a cookie is SESSION_EXPIRED', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', APP_ORIGIN)
        .expect(401);
      expect((res.body as { errorCode: string }).errorCode).toBe(
        'SESSION_EXPIRED',
      );
    });

    it('stores only a hash of the cookie value', async () => {
      const { cookie } = await login(app, email);
      const value = cookie.split(';')[0].split('=')[1];
      const rows = await prisma.refreshToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(value);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('session limits', () => {
    it('refuses refresh after 30 minutes idle and clears the cookie', async () => {
      const { cookie } = await login(app, email);
      await prisma.refreshToken.updateMany({
        data: { lastUsedAt: new Date(Date.now() - 31 * 60_000) },
      });
      const res = await refresh(cookie).expect(401);
      expect((res.body as { errorCode: string }).errorCode).toBe(
        'SESSION_EXPIRED',
      );
      expect(String(res.headers['set-cookie'])).toMatch(/fekra_session=;/);
    });

    it('a refresh within the idle window extends it', async () => {
      const { cookie } = await login(app, email);
      await prisma.refreshToken.updateMany({
        data: { lastUsedAt: new Date(Date.now() - 20 * 60_000) },
      });
      await refresh(cookie).expect(200);
      const [row] = await prisma.refreshToken.findMany();
      expect(Date.now() - row.lastUsedAt.getTime()).toBeLessThan(5_000);
    });

    it('refuses refresh and access tokens after the 12 hour limit', async () => {
      const { cookie, token } = await login(app, email);
      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await refresh(cookie).expect(401);
      await me(token).expect(401);
    });
  });

  describe('logout', () => {
    it('ends the session at once, for refresh and for access tokens', async () => {
      const { cookie, token } = await login(app, email);
      await me(token).expect(200);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', APP_ORIGIN)
        .expect(204);

      await me(token).expect(401);
      await refresh(cookie).expect(401);
      const [row] = await prisma.refreshToken.findMany();
      expect(row.revokedAt).not.toBeNull();
    });

    it('is idempotent without a session', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Origin', APP_ORIGIN)
        .expect(204);
    });
  });

  describe('sign-in throttling', () => {
    const wrong = () => login(app, email, 'wrong-password-1');

    it('blocks after 5 failures with a response identical to a wrong password (SC-010)', async () => {
      const first = await wrong();
      expect(first.status).toBe(401);
      for (let i = 0; i < 4; i += 1) await wrong();

      const blocked = await login(app, email); // the correct password
      expect(blocked.status).toBe(401);
      expect(blocked.body).toEqual(first.body);

      const unknown = await login(app, 'nobody@e2e.test');
      expect(unknown.body).toEqual(first.body);
    });

    it('works again once the block ends', async () => {
      for (let i = 0; i < 5; i += 1) await wrong();
      expect((await login(app, email)).status).toBe(401);
      await flushLoginFailures(app); // stands in for the 15 minutes passing
      expect((await login(app, email)).status).toBe(201);
    });

    it('does not block other accounts and treats email case as the same email', async () => {
      await createUser(prisma, 'other@e2e.test', ['ADMIN']);
      for (let i = 0; i < 5; i += 1)
        await login(app, 'ADMIN@e2e.test', 'wrong-password-1');
      expect((await login(app, email)).status).toBe(401);
      expect((await login(app, 'other@e2e.test')).status).toBe(201);
    });

    it('a successful sign-in resets the counter', async () => {
      for (let i = 0; i < 4; i += 1) await wrong();
      expect((await login(app, email)).status).toBe(201);
      for (let i = 0; i < 4; i += 1) await wrong();
      expect((await login(app, email)).status).toBe(201);
    });
  });
});

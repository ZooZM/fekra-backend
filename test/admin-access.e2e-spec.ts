import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
import {
  bearer,
  createE2eApp,
  createUser,
  flushLoginFailures,
  login,
  resetDb,
} from './utils/e2e-app';

describe('Admin-only access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let clientToken: string;
  const id = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createUser(prisma, 'client@e2e.test', ['CLIENT']);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    clientToken = (await login(app, 'client@e2e.test')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  const rawRoutes: [string, string, object?][] = [
    ['get', '/clients'],
    ['post', '/clients', { name: 'X' }],
    ['get', `/clients/${id}`],
    ['patch', `/clients/${id}`, { name: 'X' }],
    ['delete', `/clients/${id}`],
    ['put', `/clients/${id}/access-token`, { token: 't' }],
    ['get', '/users/admin'],
    ['get', `/users/admin/${id}`],
    ['get', '/users/admin/email/a@b.com'],
    ['post', '/users/admin', { name: 'X' }],
    ['put', `/users/admin/${id}`, { name: 'X' }],
    ['delete', `/users/admin/${id}`],
    // no public sign-up: accounts are created by an admin
    ['post', '/auth/register', { name: 'X' }],
    // ADMIN only until CLIENT users are scoped to their own clientId
    ['get', '/services'],
    ['post', '/services', { name: 'X' }],
    ['get', `/services/${id}`],
    ['put', `/services/${id}`, { name: 'X' }],
    ['delete', `/services/${id}`],
    ['get', '/offers'],
    ['post', '/offers', { title: 'X' }],
    ['get', `/offers/${id}`],
    ['patch', `/offers/${id}`, { title: 'X' }],
    ['delete', `/offers/${id}`],
    ['post', `/business-info/client/${id}`, { description: 'X' }],
    ['get', `/business-info/client/${id}`],
    ['put', `/business-info/client/${id}`, { description: 'X' }],
    ['delete', `/business-info/client/${id}`],
  ];

  // every row needs a third entry, or Jest passes its done callback in that slot
  const routes = rawRoutes.map(([m, p, b]) => [m, p, b ?? null] as const);

  const call = (
    method: string,
    path: string,
    body?: object | null,
    token?: string,
  ) => {
    const req = (request(app.getHttpServer()) as any)[method](path);
    if (token) req.set(bearer(token));
    return body ? req.send(body) : req;
  };

  it.each(routes)('401 without a token: %s %s', async (method, path, body) => {
    await call(method, path, body).expect(401);
  });

  it.each(routes)(
    '403 for a CLIENT user: %s %s',
    async (method, path, body) => {
      const res = await call(method, path, body, clientToken).expect(403);
      expect((res.body as { errorCode: string }).errorCode).toBe('FORBIDDEN');
    },
  );

  it('a CLIENT user cannot create an ADMIN account', async () => {
    await call(
      'post',
      '/users/admin',
      {
        name: 'Mallory',
        email: 'mallory@e2e.test',
        password: 'e2e-password-123',
        roles: ['ADMIN'],
      },
      clientToken,
    ).expect(403);
    expect(
      await prisma.user.count({ where: { email: 'mallory@e2e.test' } }),
    ).toBe(0);
  });

  it('an ADMIN can list clients', async () => {
    const res = await call('get', '/clients', undefined, adminToken).expect(
      200,
    );
    expect(res.body).toMatchObject({ data: [], meta: { total: 0, page: 1 } });
  });

  it('an ADMIN can still register an account', async () => {
    await call(
      'post',
      '/auth/register',
      {
        name: 'New User',
        email: 'new-user@e2e.test',
        password: 'e2e-password-123',
      },
      adminToken,
    ).expect(201);
    const created = await prisma.user.findUnique({
      where: { email: 'new-user@e2e.test' },
    });
    expect(created?.roles).toEqual(['CLIENT']);
  });

  it('own-account routes stay open to CLIENT users', async () => {
    await call('get', '/users/me', undefined, clientToken).expect(200);
  });

  it('removing the admin role takes effect for a token that is still valid', async () => {
    await call('get', '/clients', undefined, adminToken).expect(200);
    await prisma.user.update({
      where: { email: 'admin@e2e.test' },
      data: { roles: ['CLIENT'] },
    });
    await call('get', '/clients', undefined, adminToken).expect(403);
    await prisma.user.update({
      where: { email: 'admin@e2e.test' },
      data: { roles: ['ADMIN'] },
    });
  });
});

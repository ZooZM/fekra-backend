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

describe('Clients admin API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set(bearer(token));

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    token = (await login(app, 'admin@e2e.test')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('list', () => {
    const SECRET = 'SECRET-TOKEN-VALUE-do-not-leak';

    beforeAll(async () => {
      const rows = [
        ['Cafe Nile', 'Coffee shop'],
        ['Bella Cafe', 'Restaurant'],
        ['Zahra Bakery', 'Bakery'],
        ['100% Juice', 'Drinks'],
        ['Under_Score', 'Misc'],
        ['مطعم النيل', 'مطاعم'],
      ];
      for (const [i, [name, businessCategory]] of rows.entries()) {
        await prisma.client.create({
          data: {
            name,
            businessCategory,
            accessToken: SECRET,
            createdAt: new Date(2026, 0, i + 1),
          },
        });
      }
    });

    it('pages with the totals in meta', async () => {
      const res = await get('/clients?limit=4&page=2').expect(200);
      expect(res.body).toMatchObject({
        meta: { total: 6, page: 2, limit: 4, totalPages: 2 },
      });
      expect((res.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('sorts newest first by default', async () => {
      const res = await get('/clients').expect(200);
      const names = (res.body as { data: { name: string }[] }).data.map(
        (c) => c.name,
      );
      expect(names[0]).toBe('مطعم النيل');
      expect(names.at(-1)).toBe('Cafe Nile');
    });

    it.each([
      ['name', 'asc', '100% Juice'],
      ['name', 'desc', 'مطعم النيل'],
      ['businessCategory', 'asc', 'Zahra Bakery'],
      ['createdAt', 'asc', 'Cafe Nile'],
    ])('orders by %s %s', async (orderBy, orderDir, first) => {
      const res = await get(
        `/clients?orderBy=${orderBy}&orderDir=${orderDir}`,
      ).expect(200);
      expect((res.body as { data: { name: string }[] }).data[0].name).toBe(
        first,
      );
    });

    it('rejects an unknown sort field', async () => {
      const res = await get('/clients?orderBy=accessToken').expect(422);
      expect((res.body as { errorCode: string }).errorCode).toBe(
        'INPUT_VALIDATION_ERROR',
      );
    });

    it('searches name or category, ignoring case, and counts only the matches', async () => {
      const res = await get('/clients?search=CAFE').expect(200);
      const body = res.body as {
        data: { name: string }[];
        meta: { total: number };
      };
      expect(body.data.map((c) => c.name).sort()).toEqual([
        'Bella Cafe',
        'Cafe Nile',
      ]);
      expect(body.meta.total).toBe(2);

      const byCategory = await get('/clients?search=bakery').expect(200);
      expect(
        (byCategory.body as { data: { name: string }[] }).data,
      ).toHaveLength(1);
    });

    it('matches Arabic text', async () => {
      const res = await get(
        `/clients?search=${encodeURIComponent('النيل')}`,
      ).expect(200);
      expect((res.body as { data: unknown[] }).data).toHaveLength(1);
    });

    it('treats % and _ as plain characters', async () => {
      const percent = await get(
        `/clients?search=${encodeURIComponent('%')}`,
      ).expect(200);
      expect(
        (percent.body as { data: { name: string }[] }).data.map((c) => c.name),
      ).toEqual(['100% Juice']);
      const underscore = await get('/clients?search=_').expect(200);
      expect(
        (underscore.body as { data: { name: string }[] }).data.map(
          (c) => c.name,
        ),
      ).toEqual(['Under_Score']);
    });

    it('reports no matches with an empty page', async () => {
      const res = await get('/clients?search=zzzz').expect(200);
      expect(res.body).toMatchObject({ data: [], meta: { total: 0 } });
    });

    it.each(['', 'x'.repeat(101)])(
      'rejects a search of length %#',
      async (search) => {
        await get(`/clients?search=${search}`).expect(422);
      },
    );

    it('returns version and never the access token', async () => {
      const res = await get('/clients').expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      expect(JSON.stringify(res.body)).not.toContain('accessToken');
      expect(
        (res.body as { data: { version: number }[] }).data[0].version,
      ).toBe(1);
    });

    it('returns one client by id and 404 for an unknown id', async () => {
      const [first] = await prisma.client.findMany({ take: 1 });
      const res = await get(`/clients/${first.id}`).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      const missing = await get(
        '/clients/00000000-0000-4000-8000-000000000000',
      ).expect(404);
      expect((missing.body as { errorCode: string }).errorCode).toBe(
        'NOT_FOUND',
      );
      await get('/clients/not-a-uuid').expect(422);
    });
  });

  // ───────────────────────── writes (US2–US5) ─────────────────────────
  type Body = Record<string, unknown>;
  const post = (path: string, body: Body) =>
    request(app.getHttpServer()).post(path).set(bearer(token)).send(body);
  const patch = (path: string, body: Body) =>
    request(app.getHttpServer()).patch(path).set(bearer(token)).send(body);
  const put = (path: string, body: Body) =>
    request(app.getHttpServer()).put(path).set(bearer(token)).send(body);
  const del = (path: string) =>
    request(app.getHttpServer()).delete(path).set(bearer(token));
  const activity = (clientId: string) =>
    prisma.clientActivity.findMany({
      where: { clientId },
      orderBy: { createdAt: 'asc' },
    });
  const valid = (over: Body = {}): Body => ({
    name: 'New Client',
    businessCategory: 'Retail',
    accessToken: 'plain-token-1',
    ...over,
  });

  describe('create', () => {
    it('creates a client at version 1 and records who did it', async () => {
      const res = await post(
        '/clients',
        valid({ fbPageId: '100000000001' }),
      ).expect(201);
      const body = res.body as { id: string; version: number };
      expect(body.version).toBe(1);
      expect(JSON.stringify(res.body)).not.toContain('plain-token-1');

      const rows = await activity(body.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'CREATED',
        clientName: 'New Client',
        actorName: 'admin',
        actorEmail: 'admin@e2e.test',
      });
      const stored = await prisma.client.findUniqueOrThrow({
        where: { id: body.id },
        select: { accessToken: true },
      });
      expect(stored.accessToken).toEqual(expect.any(String));
      expect(stored.accessToken).not.toContain('plain-token-1'); // encrypted at rest
    });

    it('refuses a Facebook Page ID that another client uses, and creates nothing', async () => {
      const before = await prisma.client.count();
      const res = await post(
        '/clients',
        valid({ fbPageId: '100000000001' }),
      ).expect(409);
      expect(res.body).toMatchObject({
        errorCode: 'DUPLICATE_KEY_ERROR',
        details: { field: 'fbPageId' },
      });
      expect(await prisma.client.count()).toBe(before);
    });

    it('names the Instagram field when that one is the duplicate', async () => {
      await post(
        '/clients',
        valid({ name: 'Insta', instaAccountId: '200000000001' }),
      ).expect(201);
      const res = await post(
        '/clients',
        valid({ instaAccountId: '200000000001' }),
      ).expect(409);
      expect((res.body as { details: { field: string } }).details.field).toBe(
        'instaAccountId',
      );
    });

    it.each([
      ['a non-digit fbPageId', { fbPageId: 'abc' }],
      [
        'a 256-character brandLogo',
        { brandLogo: `https://example.com/${'a'.repeat(240)}.png` },
      ],
      ['a javascript: logo', { brandLogo: 'javascript:alert(1)' }],
      ['an empty name', { name: '  ' }],
      ['an unknown field', { role: 'ADMIN' }],
    ])('rejects %s with 422', async (_label, over) => {
      const res = await post('/clients', valid(over)).expect(422);
      expect((res.body as { errorCode: string }).errorCode).toBe(
        'INPUT_VALIDATION_ERROR',
      );
    });

    it('rejects a missing access token', async () => {
      const body = valid();
      delete body.accessToken;
      await post('/clients', body).expect(422);
    });
  });

  describe('update', () => {
    let id: string;

    beforeAll(async () => {
      const res = await post(
        '/clients',
        valid({ name: 'Editable', fbPageId: '300000000001' }),
      );
      id = (res.body as { id: string }).id;
    });

    it('saves with the right version, bumps it and records only the changed field names', async () => {
      const res = await patch(`/clients/${id}`, {
        version: 1,
        name: 'Edited',
        businessCategory: 'Retail', // unchanged: must not be listed
      }).expect(200);
      expect(res.body).toMatchObject({ name: 'Edited', version: 2 });
      const rows = await activity(id);
      const last = rows[rows.length - 1];
      expect(last.action).toBe('UPDATED');
      expect(last.changedFields).toEqual(['name']);
      expect(last.actorEmail).toBe('admin@e2e.test');
    });

    it('refuses a stale version with who changed it, and changes nothing', async () => {
      const res = await patch(`/clients/${id}`, {
        version: 1,
        name: 'Stale',
      }).expect(409);
      expect(res.body).toMatchObject({
        errorCode: 'CLIENT_VERSION_CONFLICT',
        details: { currentVersion: 2, updatedBy: { name: 'admin' } },
      });
      expect(
        (await prisma.client.findUniqueOrThrow({ where: { id } })).name,
      ).toBe('Edited');
    });

    it('lets only one of two simultaneous saves win', async () => {
      const [a, b] = await Promise.all([
        patch(`/clients/${id}`, { version: 2, name: 'Race A' }),
        patch(`/clients/${id}`, { version: 2, name: 'Race B' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        (await prisma.client.findUniqueOrThrow({ where: { id } })).version,
      ).toBe(3);
    });

    it('does nothing when the values are identical', async () => {
      const current = await prisma.client.findUniqueOrThrow({ where: { id } });
      const rowsBefore = (await activity(id)).length;
      const res = await patch(`/clients/${id}`, {
        version: current.version,
        name: current.name,
      }).expect(200);
      expect((res.body as { version: number }).version).toBe(current.version);
      expect(await activity(id)).toHaveLength(rowsBefore);
    });

    it('rejects a missing version, and an access token in the body', async () => {
      await patch(`/clients/${id}`, { name: 'No version' }).expect(422);
      await patch(`/clients/${id}`, { version: 3, accessToken: 'x' }).expect(
        422,
      );
    });

    it('refuses an account id used by another client, but allows its own', async () => {
      const current = await prisma.client.findUniqueOrThrow({ where: { id } });
      const res = await patch(`/clients/${id}`, {
        version: current.version,
        instaAccountId: '200000000001', // belongs to "Insta"
      }).expect(409);
      expect(res.body).toMatchObject({ details: { field: 'instaAccountId' } });
      await patch(`/clients/${id}`, {
        version: current.version,
        fbPageId: '300000000001', // its own
        name: 'Own ids ok',
      }).expect(200);
    });

    it('returns 404 for an unknown client', async () => {
      await patch('/clients/00000000-0000-4000-8000-000000000000', {
        version: 1,
      }).expect(404);
    });
  });

  describe('access token', () => {
    const SECRET = 'replacement-SECRET-token-9';
    let id: string;

    beforeAll(async () => {
      id = (
        (await post('/clients', valid({ name: 'Tokens' }))).body as {
          id: string;
        }
      ).id;
    });

    it('replaces the token, keeps the version and records it without the value', async () => {
      const tokenOf = (cid: string) =>
        prisma.client.findUniqueOrThrow({
          where: { id: cid },
          select: { accessToken: true, version: true },
        });
      const before = await tokenOf(id);
      const res = await put(`/clients/${id}/access-token`, {
        token: SECRET,
      }).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);

      const after = await tokenOf(id);
      expect(after.version).toBe(before.version);
      expect(after.accessToken).not.toBe(before.accessToken);

      const rows = (await activity(id)).filter(
        (r) => r.action === 'ACCESS_TOKEN_REPLACED',
      );
      expect(rows).toHaveLength(1);
      const dump = await prisma.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM client_activities',
      );
      expect(JSON.stringify(dump)).not.toContain(SECRET);
    });

    it('never returns the token in list or detail responses (SC-004)', async () => {
      const list = await get('/clients?limit=100').expect(200);
      const detail = await get(`/clients/${id}`).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
      expect(JSON.stringify(detail.body)).not.toContain(SECRET);
    });

    it('rejects an empty token and an unknown client', async () => {
      await put(`/clients/${id}/access-token`, { token: '  ' }).expect(422);
      await put('/clients/00000000-0000-4000-8000-000000000000/access-token', {
        token: SECRET,
      }).expect(404);
    });
  });

  describe('delete', () => {
    it('removes the client with its data, unlinks users and keeps the activity record', async () => {
      const created = await post('/clients', valid({ name: 'Doomed' }));
      const id = (created.body as { id: string }).id;
      await prisma.businessInfo.create({ data: { clientId: id } });
      const offer = await prisma.offer.create({
        data: {
          clientId: id,
          title: 'Sale',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-02-01'),
        },
      });
      await prisma.service.create({
        data: { clientId: id, name: 'Cut', offerId: offer.id },
      });
      const linked = await createUser(prisma, 'linked@e2e.test', ['CLIENT']);
      await prisma.user.update({
        where: { id: linked.id },
        data: { clientId: id },
      });

      await del(`/clients/${id}`).expect(200);

      expect(await prisma.client.findUnique({ where: { id } })).toBeNull();
      expect(await prisma.businessInfo.count({ where: { clientId: id } })).toBe(
        0,
      );
      expect(await prisma.service.count({ where: { clientId: id } })).toBe(0);
      expect(await prisma.offer.count({ where: { clientId: id } })).toBe(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: linked.id } }))
          .clientId,
      ).toBeNull();
      const rows = await activity(id);
      expect(rows.map((r) => r.action)).toEqual(['CREATED', 'DELETED']);
      expect(rows[1].clientName).toBe('Doomed');

      await del(`/clients/${id}`).expect(404);
      await get(`/clients/${id}`).expect(404);
    });
  });

  describe('settings', () => {
    const settings = {
      aiConfig: {
        language: 'ENGLISH_ARABIC',
        brandVoice: 'Warm and playful',
        custom: { a: 1 },
      },
      dmReplyConfig: {
        enabled: true,
        likes_enabled: true,
        replies: ['Thanks!', 'شكرا'],
      },
      commentReplyConfig: {
        enabled: true,
        likes_enabled: false,
        inquiry_can_dm: ['Sent you a message'],
        inquiry_can_not_dm: ['Please call us'],
        engagement: ['Thank you', 'We love you', '❤️'],
      },
    };

    it('reads back the defaults for a client created without settings (FR-025)', async () => {
      const created = await post(
        '/clients',
        valid({ name: 'Defaults' }),
      ).expect(201);
      expect(created.body).toMatchObject({
        aiConfig: { language: 'ARABIC' },
        dmReplyConfig: { enabled: false, likes_enabled: false, replies: [] },
        commentReplyConfig: {
          enabled: false,
          likes_enabled: false,
          inquiry_can_dm: [],
          inquiry_can_not_dm: [],
          engagement: [],
        },
      });
    });

    it('saves and reads back all three settings, keeping extra aiConfig keys (SC-009)', async () => {
      const created = await post('/clients', valid({ name: 'Settings' }));
      const id = (created.body as { id: string }).id;
      const res = await patch(`/clients/${id}`, {
        version: 1,
        ...settings,
      }).expect(200);
      expect(res.body).toMatchObject(settings);
      const detail = await get(`/clients/${id}`).expect(200);
      expect(detail.body).toMatchObject(settings);
      const rows = await activity(id);
      expect(rows[rows.length - 1].changedFields.sort()).toEqual([
        'aiConfig',
        'commentReplyConfig',
        'dmReplyConfig',
      ]);
    });

    it('refuses private messages on with an empty list, naming the field', async () => {
      const res = await post(
        '/clients',
        valid({
          dmReplyConfig: { enabled: true, likes_enabled: false, replies: [] },
        }),
      ).expect(422);
      expect(res.body).toMatchObject({
        details: {
          fieldErrors: {
            dmReplyConfig: [expect.stringContaining('at least one message')],
          },
        },
      });
    });

    it.each([
      [
        '51 messages',
        { replies: Array.from({ length: 51 }, (_, i) => `m${i}`) },
      ],
      ['a 1001-character message', { replies: ['x'.repeat(1001)] }],
    ])('refuses %s', async (_label, over) => {
      await post(
        '/clients',
        valid({
          dmReplyConfig: { enabled: false, likes_enabled: false, ...over },
        }),
      ).expect(422);
    });
  });
});

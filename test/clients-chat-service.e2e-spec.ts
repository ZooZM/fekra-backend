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

interface ClientBody {
  id: string;
  version: number;
  chatWorkflowEndpoint: string | null;
  chatSubscribed: boolean;
  errorCode?: string;
  details?: { field?: string; fieldErrors?: Record<string, string[]> };
}
interface Page {
  data: ClientBody[];
  meta: { total: number };
}

describe('Clients: chat workflow endpoint and subscription (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let ownerToken: string;

  const as = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set(bearer(token)),
    post: (p: string) =>
      request(app.getHttpServer()).post(p).set(bearer(token)),
    patch: (p: string) =>
      request(app.getHttpServer()).patch(p).set(bearer(token)),
    delete: (p: string) =>
      request(app.getHttpServer()).delete(p).set(bearer(token)),
  });
  const admin = () => as(adminToken);
  const newClient = async (name: string, extra: Record<string, unknown> = {}) =>
    (
      await admin()
        .post('/clients')
        .send({ name, businessCategory: 'Shop', accessToken: 'tok', ...extra })
        .expect(201)
    ).body as ClientBody;
  const patch = (c: ClientBody, body: Record<string, unknown>) =>
    admin()
      .patch(`/clients/${c.id}`)
      .send({ version: c.version, ...body });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createUser(prisma, 'owner@e2e.test', ['CLIENT']);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    ownerToken = (await login(app, 'owner@e2e.test')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts a new client as not subscribed, with no endpoint', async () => {
    const client = await newClient('Plain');
    expect(client).toMatchObject({
      chatWorkflowEndpoint: null,
      chatSubscribed: false,
    });
  });

  it('keeps a client that existed before the chat fields not subscribed (FR-047)', async () => {
    // a row written without the new columns, like the ones from before this release
    const old = await prisma.client.create({
      data: { name: 'Old client', businessCategory: 'Shop', accessToken: 'x' },
    });
    const body = (await admin().get(`/clients/${old.id}`).expect(200))
      .body as ClientBody;
    expect(body).toMatchObject({
      chatWorkflowEndpoint: null,
      chatSubscribed: false,
    });
  });

  describe('subscribing', () => {
    it('refuses to subscribe a client that has no endpoint, on the endpoint field', async () => {
      const client = await newClient('No endpoint');
      const res = await patch(client, { chatSubscribed: true }).expect(422);
      expect((res.body as ClientBody).errorCode).toBe('INPUT_VALIDATION_ERROR');
      expect(
        (res.body as ClientBody).details?.fieldErrors?.chatWorkflowEndpoint,
      ).toBeDefined();
      expect(
        (await admin().get(`/clients/${client.id}`)).body as ClientBody,
      ).toMatchObject({ chatSubscribed: false });
    });

    it('subscribes with the endpoint in the same edit, and bumps the version', async () => {
      const client = await newClient('Both at once');
      const res = await patch(client, {
        chatWorkflowEndpoint: 'chat-both',
        chatSubscribed: true,
      }).expect(200);
      expect(res.body).toMatchObject({
        chatWorkflowEndpoint: 'chat-both',
        chatSubscribed: true,
        version: client.version + 1,
      });
    });

    it('creates a client already subscribed when it comes with an endpoint, and refuses it without one', async () => {
      const created = await newClient('Created subscribed', {
        chatWorkflowEndpoint: 'chat-created',
        chatSubscribed: true,
      });
      expect(created).toMatchObject({ chatSubscribed: true });

      const res = await admin()
        .post('/clients')
        .send({
          name: 'Bad',
          businessCategory: 'Shop',
          accessToken: 't',
          chatSubscribed: true,
        })
        .expect(422);
      expect(
        (res.body as ClientBody).details?.fieldErrors?.chatWorkflowEndpoint,
      ).toBeDefined();
    });

    it('refuses to clear the endpoint of a subscribed client, and keeps it when unsubscribing', async () => {
      const client = await newClient('Subscribed', {
        chatWorkflowEndpoint: 'chat-keep',
        chatSubscribed: true,
      });
      const refused = await patch(client, {
        chatWorkflowEndpoint: null,
      }).expect(422);
      expect(
        (refused.body as ClientBody).details?.fieldErrors
          ?.chatWorkflowEndpoint?.[0],
      ).toMatch(/unsubscribe/i);

      const off = await patch(client, { chatSubscribed: false }).expect(200);
      expect(off.body).toMatchObject({
        chatSubscribed: false,
        chatWorkflowEndpoint: 'chat-keep',
      });
    });
  });

  describe('the endpoint', () => {
    it('can be shared by several clients: one workflow for many (feature 004)', async () => {
      const first = await newClient('First user', {
        chatWorkflowEndpoint: 'chat-shared',
      });
      const second = await newClient('Second');

      const res = await patch(second, {
        chatWorkflowEndpoint: 'chat-shared',
        chatSubscribed: true,
      }).expect(200);
      expect(res.body).toMatchObject({
        chatWorkflowEndpoint: 'chat-shared',
        chatSubscribed: true,
      });

      const create = await admin()
        .post('/clients')
        .send({
          name: 'Third',
          businessCategory: 'Shop',
          accessToken: 't',
          chatWorkflowEndpoint: 'chat-shared',
        })
        .expect(201);
      expect((create.body as ClientBody).chatWorkflowEndpoint).toBe(
        'chat-shared',
      );

      // the first client keeps it
      const firstNow = await admin().get(`/clients/${first.id}`).expect(200);
      expect((firstNow.body as ClientBody).chatWorkflowEndpoint).toBe(
        'chat-shared',
      );
    });

    it('can be saved again unchanged by its own client, and used by another after a delete', async () => {
      const client = await newClient('Reuse', {
        chatWorkflowEndpoint: 'chat-reuse',
      });
      await patch(client, {
        chatWorkflowEndpoint: 'chat-reuse',
        name: 'Reuse 2',
      }).expect(200);

      await admin().delete(`/clients/${client.id}`).expect(200);
      await newClient('Takes it over', { chatWorkflowEndpoint: 'chat-reuse' });
    });

    it.each([
      'https://evil.test/x',
      '//evil',
      'a/b',
      '..',
      'a b',
      'a?b',
      'a#b',
      'a%2Fb',
      'a@b',
      'a.b',
      '',
      'x'.repeat(101),
    ])('refuses the value %j with a 422 on the field', async (endpoint) => {
      const client = await newClient(`Bad endpoint ${endpoint.length}`);
      const res = await patch(client, {
        chatWorkflowEndpoint: endpoint,
      }).expect(422);
      expect(
        (res.body as ClientBody).details?.fieldErrors?.chatWorkflowEndpoint,
      ).toBeDefined();
    });

    it('is recorded in the activity entry by field name, never by value', async () => {
      const client = await newClient('Audited');
      await patch(client, {
        chatWorkflowEndpoint: 'chat-secret-name',
        chatSubscribed: true,
      }).expect(200);

      const entry = await prisma.clientActivity.findFirstOrThrow({
        where: { clientId: client.id, action: 'UPDATED' },
      });
      expect(entry.changedFields.sort()).toEqual([
        'chatSubscribed',
        'chatWorkflowEndpoint',
      ]);
      expect(JSON.stringify(entry)).not.toContain('chat-secret-name');
    });
  });

  describe('the list filter (the release checklist)', () => {
    it('lists only the clients that are not subscribed, and counts only them', async () => {
      const off = (
        await admin().get('/clients?chatSubscribed=false&limit=100').expect(200)
      ).body as Page;
      const on = (
        await admin().get('/clients?chatSubscribed=true&limit=100').expect(200)
      ).body as Page;
      const all = (await admin().get('/clients?limit=100').expect(200))
        .body as Page;

      expect(off.data.every((c) => !c.chatSubscribed)).toBe(true);
      expect(on.data.every((c) => c.chatSubscribed)).toBe(true);
      expect(off.meta.total + on.meta.total).toBe(all.meta.total);
      expect(off.meta.total).toBeGreaterThan(0);
      expect(on.meta.total).toBeGreaterThan(0);
    });

    it('refuses a value that is not true or false', async () => {
      await admin().get('/clients?chatSubscribed=maybe').expect(422);
    });
  });

  describe('access', () => {
    it('answers 401 without a token and 403 to a CLIENT-role user', async () => {
      await request(app.getHttpServer())
        .get('/clients?chatSubscribed=false')
        .expect(401);
      await as(ownerToken).get('/clients?chatSubscribed=false').expect(403);
      const client = await newClient('Protected');
      await as(ownerToken)
        .patch(`/clients/${client.id}`)
        .send({ version: client.version, chatSubscribed: true })
        .expect(403);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request = require('supertest');
import { DEAD_LIST } from '../src/inbox/inbox.constants';
import { N8nDeliveryService } from '../src/inbox/n8n-delivery.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.constants';
import {
  bearer,
  createE2eApp,
  createUser,
  login,
  resetDb,
} from './utils/e2e-app';
import {
  createChatClient,
  fastPipeline,
  flushRedis,
  pushDm,
  sleep,
  sweepDmBuffers,
  uniqueId,
  waitFor,
} from './utils/chat-e2e';
import { n8nCalls, restoreN8n, stubN8n } from './utils/n8n-stub';

// the DM window and the dispatch loop are shortened for this file only
fastPipeline();

const BASE = 'http://n8n.e2e.test/webhook/';

interface Payload {
  requestId: string;
  attempt: number;
  accountId: string;
  client: {
    id: string;
    aiConfig: { brandVoice?: string };
    businessInfo: { phone?: string } | null;
    services: { price: string | null }[];
    offers: { discountValue: string }[];
  };
}
const calls = () => n8nCalls() as { url: string; body: Payload }[];

describe('Chat workflow routing and subscription (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let token: string;

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string) =>
    request(app.getHttpServer())[method](path).set(bearer(token));

  /** One DM from a new customer, then the DM window is swept until `expected` calls arrived. */
  const sendAndWait = async (
    accountId: string,
    text: string,
    expected: number,
  ) => {
    await pushDm(app, { accountId, senderId: uniqueId('cust'), text });
    await waitFor(
      async () => {
        await sweepDmBuffers(app);
        return calls().length;
      },
      (n) => n >= expected,
      20_000,
      300,
    );
    return calls().at(-1)!;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await resetDb(prisma);
    await flushRedis(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    token = (await login(app, 'admin@e2e.test')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => stubN8n());
  afterEach(() => restoreN8n());

  it('hands 50 DMs of 3 subscribed clients to their own workflow only (SC-015)', async () => {
    const pages = ['page-a', 'page-b', 'page-c'];
    const clients = new Map<string, string>();
    for (const page of pages) {
      clients.set(page, (await createChatClient(app, { fbPageId: page })).id);
    }

    for (let i = 0; i < 50; i++) {
      await pushDm(app, {
        accountId: pages[i % 3],
        senderId: uniqueId('cust'),
        text: `hello ${i}`,
      });
    }
    await waitFor(
      async () => {
        await sweepDmBuffers(app);
        return calls().length;
      },
      (n) => n >= 50,
      30_000,
      300,
    );

    expect(calls()).toHaveLength(50);
    for (const call of calls()) {
      const page = call.body.accountId;
      expect(call.url).toBe(`${BASE}chat-${page}`);
      expect(call.body.client.id).toBe(clients.get(page));
    }
  });

  it('ignores the DMs of a client that is not subscribed: nothing sent, stored or buffered (SC-018)', async () => {
    const client = await createChatClient(app, {
      fbPageId: 'page-off',
      endpoint: 'chat-off',
      subscribed: false,
    });

    for (let i = 0; i < 50; i++) {
      await pushDm(app, {
        accountId: 'page-off',
        senderId: uniqueId('cust'),
        text: `ignored ${i}`,
      });
    }
    await waitFor(
      () => redis.zcard('inbox:messages'),
      (n) => n === 0,
    );
    await sleep(2_500); // longer than the DM window, so a buffered message would have been delivered
    await sweepDmBuffers(app);

    expect(calls()).toHaveLength(0);
    expect(await prisma.chat.count({ where: { clientId: client.id } })).toBe(0);
    expect(
      await prisma.messageReply.count({
        where: { chat: { clientId: client.id } },
      }),
    ).toBe(0);
  });

  it('sends the next DM to the new endpoint after the endpoint is changed', async () => {
    const client = await createChatClient(app, {
      fbPageId: 'page-move',
      endpoint: 'chat-move-1',
    });

    const first = await sendAndWait('page-move', 'one', 1);
    expect(first.url).toBe(`${BASE}chat-move-1`);

    await prisma.client.update({
      where: { id: client.id },
      data: { chatWorkflowEndpoint: 'chat-move-2' },
    });
    const second = await sendAndWait('page-move', 'two', 2);
    expect(second.url).toBe(`${BASE}chat-move-2`);
  });

  it('stops the DMs of a client once it is unsubscribed, at once', async () => {
    const client = await createChatClient(app, { fbPageId: 'page-stop' });
    await sendAndWait('page-stop', 'before', 1);

    await prisma.client.update({
      where: { id: client.id },
      data: { chatSubscribed: false },
    });
    await pushDm(app, {
      accountId: 'page-stop',
      senderId: uniqueId('cust'),
      text: 'after',
    });
    await waitFor(
      () => redis.zcard('inbox:messages'),
      (n) => n === 0,
    );
    await sleep(2_000);
    await sweepDmBuffers(app);

    expect(calls()).toHaveLength(1);
  });

  it('carries every saved change in the next DM: client setting, business info, service and offer (SC-020)', async () => {
    const client = await createChatClient(app, { fbPageId: 'page-fresh' });
    let sent = 0;
    const next = async () =>
      (await sendAndWait('page-fresh', 'q', ++sent)).body;

    // a client setting
    const loaded = await api('get', `/clients/${client.id}`).expect(200);
    await api('patch', `/clients/${client.id}`)
      .send({
        version: (loaded.body as { version: number }).version,
        aiConfig: { language: 'ARABIC', brandVoice: 'Warm and short' },
      })
      .expect(200);
    expect((await next()).client.aiConfig.brandVoice).toBe('Warm and short');

    // business information
    await api('post', `/business-info/client/${client.id}`)
      .send({ phone: '0100' })
      .expect(201);
    expect((await next()).client.businessInfo?.phone).toBe('0100');
    await api('put', `/business-info/client/${client.id}`)
      .send({ phone: '0200' })
      .expect(200);
    expect((await next()).client.businessInfo?.phone).toBe('0200');

    // a service price
    const service = await api('post', '/services')
      .send({ clientId: client.id, name: 'Cut', price: '100' })
      .expect(201);
    expect((await next()).client.services[0].price).toBe('100');
    await api('put', `/services/${(service.body as { id: string }).id}`)
      .send({ price: '120' })
      .expect(200);
    expect((await next()).client.services[0].price).toBe('120');

    // an offer
    const offer = await api('post', '/offers')
      .send({
        clientId: client.id,
        title: 'Sale',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startDate: '2026-11-01',
        endDate: '2026-12-01',
      })
      .expect(201);
    expect(Number((await next()).client.offers[0].discountValue)).toBe(10);
    await api('patch', `/offers/${(offer.body as { id: string }).id}`)
      .send({ discountValue: 15 })
      .expect(200);
    expect(Number((await next()).client.offers[0].discountValue)).toBe(15);
  });

  it('dead-letters a resend when the client was unsubscribed while it waited', async () => {
    restoreN8n();
    stubN8n(() => ({ status: 500 })); // never acknowledged, so the request stays pending
    const client = await createChatClient(app, { fbPageId: 'page-pending' });

    await sendAndWait('page-pending', 'will wait', 1);
    const requestId = calls()[0].body.requestId;

    await prisma.client.update({
      where: { id: client.id },
      data: { chatSubscribed: false },
    });
    await app.get(N8nDeliveryService).onExpire(requestId);

    const dead = await waitFor(
      async () =>
        (await redis.lrange(DEAD_LIST, 0, -1)).map(
          (raw) => JSON.parse(raw) as { id: string; reason: string },
        ),
      (list) => list.some((entry) => entry.id === requestId),
    );
    expect(dead.find((entry) => entry.id === requestId)?.reason).toBe(
      'UNSUBSCRIBED',
    );
    expect(calls()).toHaveLength(1); // no second attempt reached n8n
  });
});

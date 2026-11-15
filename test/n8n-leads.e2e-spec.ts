import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, resetDb } from './utils/e2e-app';
import { createChatClient, flushRedis } from './utils/chat-e2e';

interface LeadBody {
  id: string;
  clientId: string;
  platform: string;
  accountId: string;
  senderId: string;
  stage: string;
  phone: string | null;
  country: string | null;
  lastIntent: string | null;
  summary: string | null;
  fields: Record<string, string>;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ContextBody {
  lead: LeadBody | null;
  history: {
    message: string;
    reply: string;
    answered: boolean;
    createdAt: string;
  }[];
}
interface UpsertBody {
  lead: LeadBody;
  notifiedNow: boolean;
}
interface ErrorBody {
  statusCode: number;
  errorCode: string;
  details?: { fieldErrors?: Record<string, string[]> };
}

const LEAD_KEYS = [
  'accountId',
  'clientId',
  'country',
  'createdAt',
  'fields',
  'id',
  'lastIntent',
  'notifiedAt',
  'phone',
  'platform',
  'senderId',
  'stage',
  'summary',
  'updatedAt',
];

/** The n8n data endpoints (feature 004): secret, ownership, validation, context and upsert. */
describe('n8n lead endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clientA: string;
  let clientB: string;
  const SECRET = () => process.env.N8N_WEBHOOK_SECRET as string;
  const http = () => app.getHttpServer() as Server;

  const context = (query: Record<string, unknown>, secret = SECRET()) =>
    request(http())
      .get('/n8n/leads/context')
      .query(query)
      .set('x-webhook-secret', secret);
  const save = (body: Record<string, unknown>, secret = SECRET()) =>
    request(http())
      .post('/n8n/leads')
      .set('x-webhook-secret', secret)
      .send(body);

  /** Client A's Facebook page and one customer. */
  const keyA = (senderId: string) => ({
    clientId: clientA,
    platform: 'facebook',
    accountId: 'page-a',
    senderId,
  });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushRedis(app);
    clientA = (await createChatClient(app, { fbPageId: 'page-a' })).id;
    await prisma.client.update({
      where: { id: clientA },
      data: { instaAccountId: 'ig-a' },
    });
    clientB = (await createChatClient(app, { fbPageId: 'page-b' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the shared secret', () => {
    it.each([
      ['no secret', undefined],
      ['a wrong secret', 'wrong-secret'],
    ])('answers 401 UNAUTHORIZED for %s on both routes', async (_l, value) => {
      const headers: Record<string, string> =
        value === undefined ? {} : { 'x-webhook-secret': value };
      // one request at a time: supertest closes its ephemeral server after each
      const read = await request(http())
        .get('/n8n/leads/context')
        .query(keyA('c-auth'))
        .set(headers);
      const write = await request(http())
        .post('/n8n/leads')
        .set(headers)
        .send({ ...keyA('c-auth'), stage: 'new' });
      for (const res of [read, write]) {
        expect(res.status).toBe(401);
        expect((res.body as ErrorBody).errorCode).toBe('UNAUTHORIZED');
      }
      expect(await prisma.lead.count()).toBe(0);
    });

    it('checks the secret before the input: an invalid body still gets 401', async () => {
      const res = await save({ nonsense: true }, 'wrong-secret');
      expect(res.status).toBe(401);
    });
  });

  describe('ownership', () => {
    // built lazily: clientA is only known once beforeAll has run
    it.each([
      ["another client's page", { accountId: 'page-b' }],
      ['an unknown client', { clientId: randomUUID() }],
      [
        'its Facebook page used as an Instagram account',
        { platform: 'instagram' },
      ],
    ])(
      'answers 404 CLIENT_ACCOUNT_NOT_FOUND for %s, reading and writing nothing',
      async (_label, change) => {
        const scope = { ...keyA('c-own'), ...change };
        const read = await context(scope);
        const write = await save({ ...scope, stage: 'new', phone: '0100' });

        for (const res of [read, write]) {
          expect(res.status).toBe(404);
          expect((res.body as ErrorBody).errorCode).toBe(
            'CLIENT_ACCOUNT_NOT_FOUND',
          );
        }
        expect(await prisma.lead.count({ where: { senderId: 'c-own' } })).toBe(
          0,
        );
      },
    );
  });

  describe('validation', () => {
    // built lazily: clientA is only known once beforeAll has run
    it.each([
      ['a missing senderId', { senderId: undefined }, 'senderId'],
      ['historyLimit 51', { historyLimit: 51 }, 'historyLimit'],
      ['historyLimit 0', { historyLimit: 0 }, 'historyLimit'],
      ['a clientId that is not a uuid', { clientId: 'abc' }, 'clientId'],
    ])('answers 422 on the context for %s', async (_label, change, field) => {
      const res = await context({ ...keyA('x'), ...change });
      expect(res.status).toBe(422);
      expect((res.body as ErrorBody).errorCode).toBe('INPUT_VALIDATION_ERROR');
      // only the broken field is reported
      expect(
        Object.keys((res.body as ErrorBody).details?.fieldErrors ?? {}),
      ).toEqual([field]);
    });

    it.each([
      ['an unknown key', { email: 'a@b.c' }],
      ['a 3-letter country', { country: 'EGY' }],
      ['an empty stage', { stage: '' }],
      [
        '31 fields',
        {
          fields: Object.fromEntries(
            Array.from({ length: 31 }, (_, i) => [`k${i}`, 'v']),
          ),
        },
      ],
      ['a nested field value', { fields: { a: { b: 'c' } } }],
      ['a field value over 500 characters', { fields: { a: 'v'.repeat(501) } }],
    ])(
      'answers 422 on a save with %s, and saves nothing',
      async (_l, change) => {
        const res = await save({
          ...keyA('c-invalid'),
          stage: 'new',
          ...change,
        });
        expect(res.status).toBe(422);
        expect((res.body as ErrorBody).errorCode).toBe(
          'INPUT_VALIDATION_ERROR',
        );
        expect(
          await prisma.lead.count({ where: { senderId: 'c-invalid' } }),
        ).toBe(0);
      },
    );
  });

  describe('context', () => {
    it('answers lead: null and an empty history for a new customer, and creates nothing', async () => {
      const res = await context(keyA('c-new')).expect(200);

      expect(res.body).toEqual({ lead: null, history: [] });
      expect(await prisma.chat.count({ where: { senderId: 'c-new' } })).toBe(0);
      expect(await prisma.lead.count({ where: { senderId: 'c-new' } })).toBe(0);
    });

    it('returns the latest exchanges oldest first, unanswered ones included', async () => {
      const chat = await prisma.chat.create({
        data: {
          clientId: clientA,
          platform: 'FACEBOOK',
          senderId: 'c-history',
          receiverId: 'page-a',
        },
      });
      const start = Date.now() - 60 * 60 * 1000;
      // 12 exchanges; every third one arrived while the assistant was paused
      await prisma.messageReply.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          chatId: chat.id,
          message: `m${i}`,
          reply: i % 3 === 2 ? '' : `r${i}`,
          answered: i % 3 !== 2,
          createdAt: new Date(start + i * 60_000),
        })),
      });

      const byDefault = (await context(keyA('c-history')).expect(200))
        .body as ContextBody;
      expect(byDefault.history.map((h) => h.message)).toEqual([
        'm2',
        'm3',
        'm4',
        'm5',
        'm6',
        'm7',
        'm8',
        'm9',
        'm10',
        'm11',
      ]);
      expect(byDefault.history[0]).toEqual({
        message: 'm2',
        reply: '',
        answered: false,
        createdAt: new Date(start + 2 * 60_000).toISOString(),
      });
      expect(byDefault.history[1]).toMatchObject({
        reply: 'r3',
        answered: true,
      });

      const three = (
        await context({ ...keyA('c-history'), historyLimit: '3' }).expect(200)
      ).body as ContextBody;
      expect(three.history.map((h) => h.message)).toEqual(['m9', 'm10', 'm11']);
    });

    it("does not return a previous owner's conversation or lead on the same page", async () => {
      // client B owned page-a before: its conversation and lead stay B's
      const old = await prisma.chat.create({
        data: {
          clientId: clientB,
          platform: 'FACEBOOK',
          senderId: 'c-moved',
          receiverId: 'page-a',
        },
      });
      await prisma.messageReply.create({
        data: { chatId: old.id, message: 'secret of B', reply: 'x' },
      });
      await prisma.lead.create({
        data: {
          clientId: clientB,
          platform: 'FACEBOOK',
          accountId: 'page-a',
          senderId: 'c-moved',
          phone: '0999',
          notifiedAt: new Date(),
        },
      });

      const res = await context(keyA('c-moved')).expect(200);
      expect(res.body).toEqual({ lead: null, history: [] });

      // a save replaces B's lead with a new one for A, without B's data
      const saved = (
        await save({
          ...keyA('c-moved'),
          stage: 'new',
          claimNotification: true,
        }).expect(200)
      ).body as UpsertBody;
      expect(saved.lead).toMatchObject({
        clientId: clientA,
        phone: null,
        stage: 'new',
      });
      expect(saved.notifiedNow).toBe(true);
    });
  });

  describe('upsert', () => {
    const full = {
      stage: 'qualifying',
      phone: '01012345678',
      country: 'eg',
      lastIntent: 'pricing',
      summary: 'Clothes brand, wants pricing.',
      fields: { industry: 'clothes', page_link: '' },
    };

    it('creates the lead and returns its full shape', async () => {
      const res = await save({ ...keyA('c-upsert'), ...full }).expect(200);
      const body = res.body as UpsertBody;

      expect(body.notifiedNow).toBe(false);
      expect(Object.keys(body.lead).sort()).toEqual(LEAD_KEYS);
      expect(body.lead).toMatchObject({
        clientId: clientA,
        platform: 'FACEBOOK',
        accountId: 'page-a',
        senderId: 'c-upsert',
        stage: 'qualifying',
        phone: '01012345678',
        country: 'EG',
        lastIntent: 'pricing',
        summary: 'Clothes brand, wants pricing.',
        fields: { industry: 'clothes' }, // the empty value was not stored
        notifiedAt: null,
      });
    });

    it('merges a later save: empty values keep, non-empty overwrite, stage follows', async () => {
      const res = await save({
        ...keyA('c-upsert'),
        stage: 'phone_captured',
        phone: null,
        country: '',
        summary: 'Updated summary',
        fields: { industry: '', page_link: 'https://fb.test/brand' },
      }).expect(200);

      expect((res.body as UpsertBody).lead).toMatchObject({
        stage: 'phone_captured',
        phone: '01012345678',
        country: 'EG',
        lastIntent: 'pricing',
        summary: 'Updated summary',
        fields: { industry: 'clothes', page_link: 'https://fb.test/brand' },
      });
      expect(await prisma.lead.count({ where: { senderId: 'c-upsert' } })).toBe(
        1,
      );

      const ctx = (await context(keyA('c-upsert')).expect(200))
        .body as ContextBody;
      expect(ctx.lead?.stage).toBe('phone_captured');
    });

    it('gives notifiedNow: true once, then false', async () => {
      const first = (
        await save({
          ...keyA('c-notify'),
          ...full,
          claimNotification: true,
        }).expect(200)
      ).body as UpsertBody;
      expect(first.notifiedNow).toBe(true);
      expect(first.lead.notifiedAt).not.toBeNull();

      const second = (
        await save({
          ...keyA('c-notify'),
          ...full,
          claimNotification: true,
        }).expect(200)
      ).body as UpsertBody;
      expect(second.notifiedNow).toBe(false);
      expect(second.lead.notifiedAt).toBe(first.lead.notifiedAt);
    });

    it('lets exactly one of 10 concurrent claims win', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          save({
            ...keyA('c-race'),
            stage: 'phone_captured',
            claimNotification: true,
          }),
        ),
      );

      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(
        results.filter((r) => (r.body as UpsertBody).notifiedNow),
      ).toHaveLength(1);
      expect(await prisma.lead.count({ where: { senderId: 'c-race' } })).toBe(
        1,
      );
    });

    it('loses no field when concurrent saves merge into the same lead', async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          save({
            ...keyA('c-merge-race'),
            stage: 'qualifying',
            fields: { [`f${i}`]: `v${i}` },
          }).expect(200),
        ),
      );

      const lead = await prisma.lead.findFirstOrThrow({
        where: { senderId: 'c-merge-race' },
      });
      expect(Object.keys(lead.fields as object).sort()).toEqual(
        Array.from({ length: 10 }, (_, i) => `f${i}`).sort(),
      );
    });

    it('works for the Instagram account of the client', async () => {
      const res = await save({
        ...keyA('c-ig'),
        platform: 'INSTAGRAM',
        accountId: 'ig-a',
        stage: 'new',
      }).expect(200);
      expect((res.body as UpsertBody).lead.platform).toBe('INSTAGRAM');
    });
  });
});

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

interface ErrorBody {
  statusCode: number;
  errorCode: string;
  details?: { fieldErrors?: Record<string, string[]> };
}
interface Page<T> {
  data: T[];
  meta: { total: number };
}

const OFFER = {
  title: 'Sale',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  startDate: '2026-11-01',
  endDate: '2026-12-01',
};

describe('Client data: business info, services and offers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let ownerToken: string;
  let clientA: string;
  let clientB: string;

  const as = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set(bearer(token)),
    post: (p: string) =>
      request(app.getHttpServer()).post(p).set(bearer(token)),
    put: (p: string) => request(app.getHttpServer()).put(p).set(bearer(token)),
    patch: (p: string) =>
      request(app.getHttpServer()).patch(p).set(bearer(token)),
    delete: (p: string) =>
      request(app.getHttpServer()).delete(p).set(bearer(token)),
  });
  const admin = () => as(adminToken);
  const create = async (name: string) =>
    (
      await prisma.client.create({
        data: { name, businessCategory: 'Shop', accessToken: 'x' },
      })
    ).id;
  const fieldErrors = (res: request.Response) =>
    (res.body as ErrorBody).details?.fieldErrors ?? {};

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createUser(prisma, 'owner@e2e.test', ['CLIENT']);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    ownerToken = (await login(app, 'owner@e2e.test')).token;
    clientA = await create('Acme');
    clientB = await create('Beta');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    it.each([
      ['get', '/services'],
      ['get', '/offers'],
      ['get', '/business-info/client/00000000-0000-4000-8000-000000000000'],
    ] as const)('%s %s answers 401 without a token', async (method, path) => {
      await request(app.getHttpServer())[method](path).expect(401);
    });

    it.each([
      ['get', '/services'],
      ['get', '/offers'],
      ['post', '/services'],
      ['get', '/business-info/client/00000000-0000-4000-8000-000000000000'],
    ] as const)(
      '%s %s answers 403 to a CLIENT-role user',
      async (method, path) => {
        await as(ownerToken)[method](path).expect(403);
      },
    );
  });

  describe('ids are validated before the database', () => {
    it.each([
      ['get', '/services/not-a-uuid'],
      ['put', '/services/not-a-uuid'],
      ['delete', '/services/not-a-uuid'],
      ['get', '/offers/not-a-uuid'],
      ['patch', '/offers/not-a-uuid'],
      ['delete', '/offers/not-a-uuid'],
      ['get', '/business-info/client/not-a-uuid'],
      ['delete', '/business-info/client/not-a-uuid'],
    ] as const)('%s %s answers 422', async (method, path) => {
      const res = await admin()[method](path).send({}).expect(422);
      expect((res.body as ErrorBody).errorCode).toBe('INPUT_VALIDATION_ERROR');
    });

    it('answers 404 for an id that is a UUID but does not exist', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await admin().get(`/services/${id}`).expect(404);
      await admin().put(`/services/${id}`).send({ name: 'x' }).expect(404);
      await admin().patch(`/offers/${id}`).send({ title: 'x' }).expect(404);
    });
  });

  describe('business information', () => {
    it('answers 404 when the client has none yet, then creates it without a clientId in the body', async () => {
      await admin().get(`/business-info/client/${clientA}`).expect(404);

      const created = await admin()
        .post(`/business-info/client/${clientA}`)
        .send({
          phone: '0100',
          paymentMethods: ['cash', 'card'],
          workHours: { saturday: { startTime: '09:00', endTime: '22:00' } },
        })
        .expect(201);
      expect(created.body).toMatchObject({ clientId: clientA, phone: '0100' });

      await admin().get(`/business-info/client/${clientA}`).expect(200);
    });

    it('answers 409 when it already exists', async () => {
      const res = await admin()
        .post(`/business-info/client/${clientA}`)
        .send({ phone: '0200' })
        .expect(409);
      expect((res.body as ErrorBody).errorCode).toBe('DUPLICATE_KEY_ERROR');
    });

    it('updates only the fields that are sent, and null clears a nullable field', async () => {
      await admin()
        .put(`/business-info/client/${clientA}`)
        .send({ phone: '0300' })
        .expect(200);
      const kept = (
        await admin().get(`/business-info/client/${clientA}`).expect(200)
      ).body as { phone: string; paymentMethods: string[] };
      expect(kept.phone).toBe('0300');
      expect(kept.paymentMethods).toEqual(['cash', 'card']); // not reset

      await admin()
        .put(`/business-info/client/${clientA}`)
        .send({ phone: null })
        .expect(200);
      expect(
        (
          (await admin().get(`/business-info/client/${clientA}`)).body as {
            phone: unknown;
          }
        ).phone,
      ).toBeNull();
    });

    it('accepts a body clientId that matches the URL and refuses one that does not', async () => {
      await admin()
        .put(`/business-info/client/${clientA}`)
        .send({ clientId: clientA, phone: '0400' })
        .expect(200);
      const res = await admin()
        .put(`/business-info/client/${clientA}`)
        .send({ clientId: clientB, phone: '0500' })
        .expect(422);
      expect(fieldErrors(res).clientId).toBeDefined();
    });

    it('refuses an empty update and answers 404 to an update of a client without business info', async () => {
      await admin()
        .put(`/business-info/client/${clientA}`)
        .send({})
        .expect(422);
      await admin()
        .put(`/business-info/client/${clientB}`)
        .send({ phone: '1' })
        .expect(404);
    });
  });

  describe('lists are per client', () => {
    beforeAll(async () => {
      for (const [clientId, name] of [
        [clientA, 'A cut'],
        [clientA, 'A colour'],
        [clientB, 'B cut'],
      ]) {
        await admin().post('/services').send({ clientId, name }).expect(201);
      }
      await admin()
        .post('/offers')
        .send({ clientId: clientA, ...OFFER })
        .expect(201);
      await admin()
        .post('/offers')
        .send({ clientId: clientB, ...OFFER })
        .expect(201);
    });

    it('lists only the services of the client asked for', async () => {
      const a = (await admin().get(`/services?clientId=${clientA}`).expect(200))
        .body as Page<{ name: string }>;
      expect(a.meta.total).toBe(2);
      expect(a.data.map((s) => s.name).sort()).toEqual(['A colour', 'A cut']);
      const all = (await admin().get('/services').expect(200))
        .body as Page<unknown>;
      expect(all.meta.total).toBe(3);
    });

    it('lists only the offers of the client asked for', async () => {
      const b = (await admin().get(`/offers?clientId=${clientB}`).expect(200))
        .body as Page<{ clientId: string }>;
      expect(b.meta.total).toBe(1);
      expect(b.data[0].clientId).toBe(clientB);
    });

    it('answers 422 for a clientId that is not a UUID', async () => {
      await admin().get('/services?clientId=x').expect(422);
      await admin().get('/offers?clientId=x').expect(422);
    });
  });

  describe('the offer of a service', () => {
    let offerA: string;
    let offerB: string;
    let serviceA: string;

    beforeAll(async () => {
      offerA = (
        (await admin().get(`/offers?clientId=${clientA}`)).body as Page<{
          id: string;
        }>
      ).data[0].id;
      offerB = (
        (await admin().get(`/offers?clientId=${clientB}`)).body as Page<{
          id: string;
        }>
      ).data[0].id;
      serviceA = (
        (await admin().get(`/services?clientId=${clientA}`)).body as Page<{
          id: string;
        }>
      ).data[0].id;
    });

    it('can be an offer of the same client', async () => {
      const res = await admin()
        .put(`/services/${serviceA}`)
        .send({ offerId: offerA })
        .expect(200);
      expect((res.body as { offerId: string }).offerId).toBe(offerA);
    });

    it('cannot be an offer of another client: 422 on offerId, nothing saved', async () => {
      const res = await admin()
        .post('/services')
        .send({ clientId: clientA, name: 'Wrong link', offerId: offerB })
        .expect(422);
      expect(fieldErrors(res).offerId).toBeDefined();
      expect(
        await prisma.service.count({ where: { name: 'Wrong link' } }),
      ).toBe(0);

      const update = await admin()
        .put(`/services/${serviceA}`)
        .send({ offerId: offerB })
        .expect(422);
      expect(fieldErrors(update).offerId).toBeDefined();
    });

    it('cannot be an offer that does not exist', async () => {
      const res = await admin()
        .post('/services')
        .send({
          clientId: clientA,
          name: 'Ghost offer',
          offerId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(422);
      expect(fieldErrors(res).offerId).toBeDefined();
    });

    it('never moves a service or an offer to another client, but accepts the same clientId', async () => {
      const moved = await admin()
        .put(`/services/${serviceA}`)
        .send({ clientId: clientB })
        .expect(422);
      expect(fieldErrors(moved).clientId).toBeDefined();
      await admin()
        .put(`/services/${serviceA}`)
        .send({ clientId: clientA })
        .expect(200);

      const offerMoved = await admin()
        .patch(`/offers/${offerA}`)
        .send({ clientId: clientB })
        .expect(422);
      expect(fieldErrors(offerMoved).clientId).toBeDefined();
      await admin()
        .patch(`/offers/${offerA}`)
        .send({ clientId: clientA })
        .expect(200);
    });

    it('keeps its services, without an offer, when the offer is deleted', async () => {
      for (const name of ['Svc 1', 'Svc 2', 'Svc 3']) {
        await admin()
          .post('/services')
          .send({ clientId: clientA, name, offerId: offerA })
          .expect(201);
      }
      const linked = await prisma.service.count({ where: { offerId: offerA } });
      expect(linked).toBeGreaterThanOrEqual(3);

      await admin().delete(`/offers/${offerA}`).expect(200);

      expect(await prisma.service.count({ where: { offerId: offerA } })).toBe(
        0,
      );
      expect(
        await prisma.service.count({ where: { clientId: clientA } }),
      ).toBeGreaterThanOrEqual(3);
    });
  });

  describe('offer rules', () => {
    it('refuses an end date before the start date, on the end date field', async () => {
      const res = await admin()
        .post('/offers')
        .send({
          clientId: clientA,
          ...OFFER,
          startDate: '2026-12-01',
          endDate: '2026-11-01',
        })
        .expect(422);
      expect(fieldErrors(res).endDate).toBeDefined();
    });

    it('refuses a percentage above 100, on the value field', async () => {
      const res = await admin()
        .post('/offers')
        .send({ clientId: clientA, ...OFFER, discountValue: 120 })
        .expect(422);
      expect(fieldErrors(res).discountValue).toBeDefined();
    });

    it('accepts a fixed amount above 100', async () => {
      await admin()
        .post('/offers')
        .send({
          clientId: clientA,
          ...OFFER,
          discountType: 'FIXED_AMOUNT',
          discountValue: 250,
        })
        .expect(201);
    });
  });

  describe('services', () => {
    it('keeps variants with unique names and refuses duplicates', async () => {
      await admin()
        .post('/services')
        .send({
          clientId: clientA,
          name: 'With variants',
          variants: [
            { name: 'Large', price: '150' },
            { name: 'Small', price: '90' },
          ],
        })
        .expect(201);
      const res = await admin()
        .post('/services')
        .send({
          clientId: clientA,
          name: 'Dup variants',
          variants: [{ name: 'Large' }, { name: 'large' }],
        })
        .expect(422);
      expect(fieldErrors(res).variants).toBeDefined();
    });

    it('stores Arabic text unchanged', async () => {
      const res = await admin()
        .post('/services')
        .send({
          clientId: clientA,
          name: 'قص شعر',
          description: 'خدمة ممتازة',
          price: '١٢٠',
        })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'قص شعر', price: '١٢٠' });
    });
  });
});

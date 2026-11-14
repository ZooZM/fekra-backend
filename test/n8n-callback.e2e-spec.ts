import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request = require('supertest');
import { createE2eApp } from './utils/e2e-app';

/** The callback's contract, unchanged by the move of its secret check into N8nSecretGuard (004). */
describe('n8n callback (e2e)', () => {
  let app: INestApplication;
  const secret = () => process.env.N8N_WEBHOOK_SECRET as string;
  const http = () => app.getHttpServer() as Server;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['no secret', undefined],
    ['a wrong secret', 'wrong-secret'],
    ['an empty secret', ''],
  ])(
    'answers 401 UNAUTHORIZED for %s, before reading the body',
    async (_label, value) => {
      const req = request(http()).post('/n8n/callback');
      if (value !== undefined) req.set('x-webhook-secret', value);
      const res = await req.send({}); // no id: the 401 comes before the 400

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
    },
  );

  it('answers 400 without an id, with the right secret', async () => {
    const res = await request(http())
      .post('/n8n/callback')
      .set('x-webhook-secret', secret())
      .send({ text: 'hi' });
    expect(res.status).toBe(400);
  });

  it('acknowledges an unknown id with acknowledged: false', async () => {
    const res = await request(http())
      .post('/n8n/callback')
      .set('x-webhook-secret', secret())
      .send({ id: 'unknown-request', text: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acknowledged: false });
  });
});

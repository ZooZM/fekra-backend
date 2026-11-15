import { QueryServiceSchema } from './query-service.schema';
import { QueryOfferSchema } from '@app/offers/schemas/query-offer.schema';

const CLIENT = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';

describe.each([
  ['QueryServiceSchema', QueryServiceSchema, 'name'],
  ['QueryOfferSchema', QueryOfferSchema, 'title'],
])('%s', (_name, schema, orderField) => {
  it('takes an optional client filter', () => {
    expect(schema.parse({ clientId: CLIENT }).clientId).toBe(CLIENT);
    expect(schema.parse({}).clientId).toBeUndefined();
  });

  it('rejects a clientId that is not a UUID', () => {
    expect(schema.safeParse({ clientId: 'x' }).success).toBe(false);
  });

  it('keeps paging and the allowed sort fields', () => {
    const q = schema.parse({ orderBy: orderField, limit: '50' });
    expect(q.orderBy).toBe(orderField);
    expect(q.limit).toBe(50);
    expect(schema.safeParse({ orderBy: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(schema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

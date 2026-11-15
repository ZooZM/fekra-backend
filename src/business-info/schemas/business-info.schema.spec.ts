import {
  CreateBusinessInfoBodySchema,
  UpdateBusinessInfoBodySchema,
} from './business-info.schema';

const CLIENT = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';

describe('CreateBusinessInfoBodySchema', () => {
  it('needs no clientId, because the path decides, and defaults the arrays', () => {
    const body = CreateBusinessInfoBodySchema.parse({ phone: '0100' });
    expect(body).toMatchObject({
      phone: '0100',
      socialMedia: [],
      paymentMethods: [],
      installmentOptions: [],
    });
    expect(body.clientId).toBeUndefined();
  });

  it('still accepts a clientId, so older requests keep working', () => {
    expect(
      CreateBusinessInfoBodySchema.safeParse({ clientId: CLIENT }).success,
    ).toBe(true);
    expect(
      CreateBusinessInfoBodySchema.safeParse({ clientId: 'x' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys and keeps the field rules', () => {
    expect(CreateBusinessInfoBodySchema.safeParse({ nope: 1 }).success).toBe(
      false,
    );
    expect(
      CreateBusinessInfoBodySchema.safeParse({ website: 'ftp://x' }).success,
    ).toBe(false);
    expect(
      CreateBusinessInfoBodySchema.safeParse({ email: ' A@B.COM ' }).success,
    ).toBe(true);
  });
});

describe('UpdateBusinessInfoBodySchema', () => {
  it('accepts a partial body, with no defaults for what is not sent', () => {
    const body = UpdateBusinessInfoBodySchema.parse({ phone: '0100' });
    expect(body).toEqual({ phone: '0100' });
    expect(body).not.toHaveProperty('paymentMethods');
  });

  it('accepts null for a nullable field, which clears it', () => {
    expect(
      UpdateBusinessInfoBodySchema.parse({ website: null, workHours: null }),
    ).toEqual({ website: null, workHours: null });
  });

  it('accepts an optional clientId next to a real field', () => {
    expect(
      UpdateBusinessInfoBodySchema.safeParse({ clientId: CLIENT, phone: '1' })
        .success,
    ).toBe(true);
  });

  it('needs at least one field: an empty body or a clientId alone is refused', () => {
    expect(UpdateBusinessInfoBodySchema.safeParse({}).success).toBe(false);
    expect(
      UpdateBusinessInfoBodySchema.safeParse({ clientId: CLIENT }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      UpdateBusinessInfoBodySchema.safeParse({ phone: '1', nope: 1 }).success,
    ).toBe(false);
  });
});

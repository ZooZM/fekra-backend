import { LeadContextQuerySchema, UpsertLeadSchema } from './lead.schema';

const CLIENT = '3f0c2a8e-2a51-4d64-9b8e-1a2b3c4d5e6f';
const key = {
  clientId: CLIENT,
  platform: 'facebook',
  accountId: '100000000000000',
  senderId: '7000000000000001',
};

describe('LeadContextQuerySchema', () => {
  it('parses the key, upper-cases the platform and defaults historyLimit to 10', () => {
    expect(LeadContextQuerySchema.parse(key)).toEqual({
      ...key,
      platform: 'FACEBOOK',
      historyLimit: 10,
    });
  });

  it('accepts INSTAGRAM in any case and a historyLimit from the query string', () => {
    const parsed = LeadContextQuerySchema.parse({
      ...key,
      platform: 'Instagram',
      historyLimit: '50',
    });
    expect(parsed.platform).toBe('INSTAGRAM');
    expect(parsed.historyLimit).toBe(50);
  });

  it.each(['0', '51', '1.5', 'abc', '-1'])(
    'refuses historyLimit=%p',
    (historyLimit) => {
      expect(
        LeadContextQuerySchema.safeParse({ ...key, historyLimit }).success,
      ).toBe(false);
    },
  );

  it.each([
    ['a missing clientId', { ...key, clientId: undefined }],
    ['a clientId that is not a uuid', { ...key, clientId: 'abc' }],
    ['an unknown platform', { ...key, platform: 'whatsapp' }],
    ['an accountId with a slash', { ...key, accountId: '1/2' }],
    ['an empty senderId', { ...key, senderId: '' }],
    ['an unknown key', { ...key, page: '1' }],
  ])('refuses %s', (_label, query) => {
    expect(LeadContextQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('UpsertLeadSchema', () => {
  const body = {
    ...key,
    stage: 'phone_captured',
    phone: '01012345678',
    country: 'eg',
    lastIntent: 'pricing',
    summary: 'Clothes brand.',
    fields: { industry: 'clothes', page_link: '' },
    claimNotification: true,
  };

  it('parses the full body of the workflow', () => {
    expect(UpsertLeadSchema.parse(body)).toEqual({
      ...body,
      platform: 'FACEBOOK',
      country: 'EG',
    });
  });

  it('needs only the key and the stage; fields and claimNotification have defaults', () => {
    expect(UpsertLeadSchema.parse({ ...key, stage: 'new' })).toEqual({
      ...key,
      platform: 'FACEBOOK',
      stage: 'new',
      fields: {},
      claimNotification: false,
    });
  });

  it('accepts null and "" for the texts that never erase', () => {
    const parsed = UpsertLeadSchema.parse({
      ...key,
      stage: 'new',
      phone: null,
      country: '',
      lastIntent: null,
      summary: '   ',
    });
    expect(parsed).toMatchObject({
      phone: null,
      country: '',
      lastIntent: null,
      summary: '',
    });
  });

  it('trims texts and strips NUL characters, which Postgres refuses', () => {
    const parsed = UpsertLeadSchema.parse({
      ...key,
      stage: ' qualifying ',
      summary: 'a\u0000b',
      fields: { note: ' x\u0000 ' },
    });
    expect(parsed.stage).toBe('qualifying');
    expect(parsed.summary).toBe('ab');
    expect(parsed.fields).toEqual({ note: 'x' });
  });

  it('accepts 30 fields', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v']),
    );
    expect(UpsertLeadSchema.safeParse({ ...body, fields }).success).toBe(true);
  });

  it.each([
    ['an empty stage', { stage: '' }],
    ['a stage over 50 characters', { stage: 's'.repeat(51) }],
    ['a phone over 30 characters', { phone: '1'.repeat(31) }],
    ['a 3-letter country', { country: 'EGY' }],
    ['a country with digits', { country: 'E1' }],
    ['a lastIntent over 50 characters', { lastIntent: 'i'.repeat(51) }],
    ['a summary over 1000 characters', { summary: 's'.repeat(1001) }],
    [
      '31 fields',
      {
        fields: Object.fromEntries(
          Array.from({ length: 31 }, (_, i) => [`k${i}`, 'v']),
        ),
      },
    ],
    ['a field key over 50 characters', { fields: { ['k'.repeat(51)]: 'v' } }],
    ['an empty field key', { fields: { '': 'v' } }],
    ['a field value over 500 characters', { fields: { a: 'v'.repeat(501) } }],
    ['a nested field value', { fields: { a: { b: 'c' } } }],
    ['a number as field value', { fields: { budget: 5000 } }],
    ['fields as an array', { fields: ['a'] }],
    ['claimNotification as a string', { claimNotification: 'true' }],
    ['an unknown key', { email: 'x@y.z' }],
    ['a missing stage', { stage: undefined }],
  ])('refuses %s', (_label, change) => {
    expect(UpsertLeadSchema.safeParse({ ...body, ...change }).success).toBe(
      false,
    );
  });
});

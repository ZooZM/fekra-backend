import { mergeFields, mergeLead } from './merge-lead';
import { UpsertLeadInput } from '../schemas/lead.schema';
import { LeadRecord } from '../types/lead.types';

const NOW = new Date('2026-11-14T12:00:00.000Z');

const input = (over: Partial<UpsertLeadInput> = {}): UpsertLeadInput => ({
  clientId: 'client-1',
  platform: 'FACEBOOK',
  accountId: 'page-1',
  senderId: 'customer-1',
  stage: 'qualifying',
  fields: {},
  claimNotification: false,
  ...over,
});

const stored = (over: Partial<LeadRecord> = {}): LeadRecord => ({
  id: 'lead-1',
  clientId: 'client-1',
  platform: 'FACEBOOK',
  accountId: 'page-1',
  senderId: 'customer-1',
  stage: 'phone_captured',
  phone: '01012345678',
  country: 'EG',
  lastIntent: 'pricing',
  summary: 'Wants ads',
  fields: { industry: 'clothes' },
  notifiedAt: new Date('2026-11-10T00:00:00.000Z'),
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-10T00:00:00.000Z'),
  ...over,
});

describe('mergeLead', () => {
  it('builds a new lead from the sent values, empty texts as null and no empty fields', () => {
    expect(
      mergeLead(
        null,
        input({
          phone: '0100',
          country: '',
          lastIntent: null,
          fields: { industry: 'food', page_link: '' },
        }),
      ),
    ).toEqual({
      clientId: 'client-1',
      stage: 'qualifying',
      phone: '0100',
      country: null,
      lastIntent: null,
      summary: null,
      fields: { industry: 'food' },
    });
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['a missing key', undefined],
  ])(
    'keeps the stored phone, country, intent and summary for %s',
    (_label, sent) => {
      const write = mergeLead(
        stored(),
        input({ phone: sent, country: sent, lastIntent: sent, summary: sent }),
      );
      expect(write).toMatchObject({
        phone: '01012345678',
        country: 'EG',
        lastIntent: 'pricing',
        summary: 'Wants ads',
      });
    },
  );

  it('overwrites them with non-empty values', () => {
    const write = mergeLead(
      stored(),
      input({
        phone: '0111',
        country: 'SA',
        lastIntent: 'order',
        summary: 'New',
      }),
    );
    expect(write).toMatchObject({
      phone: '0111',
      country: 'SA',
      lastIntent: 'order',
      summary: 'New',
    });
  });

  it('always takes the sent stage, even one that looks like a step back', () => {
    expect(mergeLead(stored(), input({ stage: 'new' })).stage).toBe('new');
  });

  it('merges fields shallowly: adds, overwrites, and never erases with ""', () => {
    const write = mergeLead(
      stored({ fields: { industry: 'clothes', city: 'Cairo' } }),
      input({ fields: { industry: '', city: 'Giza', page_link: 'x' } }),
    );
    expect(write.fields).toEqual({
      industry: 'clothes',
      city: 'Giza',
      page_link: 'x',
    });
  });

  it('does not touch the notification or the creation time of the same client', () => {
    const write = mergeLead(stored(), input(), NOW);
    expect(write).not.toHaveProperty('notifiedAt');
    expect(write).not.toHaveProperty('createdAt');
  });

  it("replaces another client's lead instead of merging into it", () => {
    const write = mergeLead(
      stored({ clientId: 'previous-owner' }),
      input({ fields: { city: 'Alex' } }),
      NOW,
    );
    expect(write).toEqual({
      clientId: 'client-1',
      stage: 'qualifying',
      phone: null,
      country: null,
      lastIntent: null,
      summary: null,
      fields: { city: 'Alex' },
      notifiedAt: null,
      createdAt: NOW,
    });
  });
});

describe('mergeFields', () => {
  it('returns a new object and leaves the stored one unchanged', () => {
    const before = { a: '1' };
    const merged = mergeFields(before, { b: '2' });
    expect(merged).toEqual({ a: '1', b: '2' });
    expect(before).toEqual({ a: '1' });
  });
});

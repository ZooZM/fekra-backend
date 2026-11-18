import { Client } from '@app/generated/prisma/client';
import { toClientAdminRecord } from './client.mapper';

const row = (over: Partial<Client> = {}): Client =>
  ({
    id: 'c1',
    name: 'Acme',
    businessCategory: 'Cafe',
    fbPageId: '11111',
    instaAccountId: '22222',
    accessToken: 'v1:iv:tag:PAGE-CIPHERTEXT',
    instaAccessToken: 'v1:iv:tag:IG-CIPHERTEXT',
    brandLogo: null,
    chatWorkflowEndpoint: null,
    chatSubscribed: false,
    aiConfig: { language: 'ARABIC' },
    dmReplyConfig: {},
    commentReplyConfig: {},
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }) as Client;

describe('toClientAdminRecord', () => {
  it('says which tokens are stored and drops their values', () => {
    const record = toClientAdminRecord(row());

    expect(record).toMatchObject({
      id: 'c1',
      hasAccessToken: true,
      hasInstaAccessToken: true,
    });
    expect(record).not.toHaveProperty('accessToken');
    expect(record).not.toHaveProperty('instaAccessToken');
    expect(JSON.stringify(record)).not.toContain('CIPHERTEXT');
  });

  it('reports a missing token as false: an Instagram-only client, and one without an Instagram token', () => {
    expect(toClientAdminRecord(row({ accessToken: null }))).toMatchObject({
      hasAccessToken: false,
      hasInstaAccessToken: true,
    });
    expect(toClientAdminRecord(row({ instaAccessToken: null }))).toMatchObject({
      hasAccessToken: true,
      hasInstaAccessToken: false,
    });
  });

  it('parses the JSON columns like the other records', () => {
    expect(toClientAdminRecord(row()).aiConfig).toEqual({ language: 'ARABIC' });
  });
});

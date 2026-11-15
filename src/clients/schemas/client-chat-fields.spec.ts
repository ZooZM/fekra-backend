import {
  CHAT_ENDPOINT_PATTERN,
  CreateClientSchema,
  UpdateClientSchema,
} from './client.schema';
import { QueryClientSchema } from './query-client.schema';

const base = {
  name: 'Acme',
  businessCategory: 'Shop',
  accessToken: 'token',
};

describe('chat service fields on a client', () => {
  describe('chatWorkflowEndpoint', () => {
    it.each(['chat-acme', 'A_1', 'x', 'a'.repeat(100), 'Chat-Acme_2026'])(
      'accepts %s',
      (endpoint) => {
        expect(
          CreateClientSchema.safeParse({
            ...base,
            chatWorkflowEndpoint: endpoint,
          }).success,
        ).toBe(true);
      },
    );

    // SC-016: values that could change the host, escape the base path or add a query
    it.each([
      'https://evil.test/x',
      '//evil',
      'a/b',
      '..',
      '.',
      'a b',
      'a?b',
      'a#b',
      'a%2Fb',
      'a@b',
      'a:b',
      'a\\b',
      'a.b',
      '',
      ' ',
      'a'.repeat(101),
      'ñ',
      'a\nb',
      'a;b',
      'a&b',
    ])('rejects %j', (endpoint) => {
      expect(
        CreateClientSchema.safeParse({
          ...base,
          chatWorkflowEndpoint: endpoint,
        }).success,
      ).toBe(false);
      expect(
        UpdateClientSchema.safeParse({
          version: 1,
          chatWorkflowEndpoint: endpoint,
        }).success,
      ).toBe(false);
    });

    it('trims surrounding spaces before checking the format', () => {
      const parsed = CreateClientSchema.parse({
        ...base,
        chatWorkflowEndpoint: '  chat-acme  ',
      });
      expect(parsed.chatWorkflowEndpoint).toBe('chat-acme');
    });

    it('exports the pattern the form mirrors', () => {
      expect(CHAT_ENDPOINT_PATTERN.test('chat-acme')).toBe(true);
      expect(CHAT_ENDPOINT_PATTERN.test('a/b')).toBe(false);
    });

    it('can be cleared with null on an edit', () => {
      const parsed = UpdateClientSchema.parse({
        version: 3,
        chatWorkflowEndpoint: null,
      });
      expect(parsed.chatWorkflowEndpoint).toBeNull();
    });
  });

  describe('chatSubscribed', () => {
    it('is optional on create (the service default is not subscribed)', () => {
      const parsed = CreateClientSchema.parse(base);
      expect(parsed.chatSubscribed).toBeUndefined();
    });

    it('needs an endpoint on create, with the error on the endpoint field', () => {
      const result = CreateClientSchema.safeParse({
        ...base,
        chatSubscribed: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['chatWorkflowEndpoint']);
      }
    });

    it('is accepted on create together with an endpoint', () => {
      expect(
        CreateClientSchema.safeParse({
          ...base,
          chatSubscribed: true,
          chatWorkflowEndpoint: 'chat-acme',
        }).success,
      ).toBe(true);
    });

    it('can be sent alone on an edit (the service checks the stored endpoint)', () => {
      expect(
        UpdateClientSchema.safeParse({ version: 1, chatSubscribed: true })
          .success,
      ).toBe(true);
    });

    it('must be a boolean', () => {
      expect(
        UpdateClientSchema.safeParse({ version: 1, chatSubscribed: 'yes' })
          .success,
      ).toBe(false);
    });
  });
});

describe('QueryClientSchema chatSubscribed filter', () => {
  it('turns "false" and "true" into booleans', () => {
    expect(
      QueryClientSchema.parse({ chatSubscribed: 'false' }).chatSubscribed,
    ).toBe(false);
    expect(
      QueryClientSchema.parse({ chatSubscribed: 'true' }).chatSubscribed,
    ).toBe(true);
  });

  it('is optional and rejects other values', () => {
    expect(QueryClientSchema.parse({}).chatSubscribed).toBeUndefined();
    expect(
      QueryClientSchema.safeParse({ chatSubscribed: 'maybe' }).success,
    ).toBe(false);
  });

  it('keeps the existing search and ordering behavior', () => {
    const q = QueryClientSchema.parse({ search: '  acme ' });
    expect(q.search).toBe('acme');
    expect(q.orderBy).toBe('createdAt');
  });
});

import { N8nCallbackSchema } from './n8n-callback.schema';

describe('N8nCallbackSchema', () => {
  it('accepts a DM batch reply', () => {
    expect(N8nCallbackSchema.parse({ id: 'r1', text: 'hello' })).toEqual({
      id: 'r1',
      text: 'hello',
    });
  });

  it('accepts a comment answer with every text', () => {
    const body = {
      id: 'r1',
      type: 'question',
      publicReply: 'p',
      dmText: 'd',
      publicReplyIfDmSent: 's',
      publicReplyIfDmClosed: 'c',
    };
    expect(N8nCallbackSchema.parse(body)).toEqual(body);
  });

  it('keeps accepting what the live workflows send: null or "" texts, empty type, extra keys', () => {
    const parsed = N8nCallbackSchema.parse({
      id: 'r1',
      text: null,
      publicReply: '',
      dmText: null,
      type: '',
      executionId: 42,
    });
    expect(parsed.type).toBeUndefined(); // the controller falls back to engagement
    expect(parsed.text).toBeNull();
    expect(parsed).toHaveProperty('executionId', 42);
    expect(N8nCallbackSchema.parse({ id: 'r1', type: null }).type).toBe(
      undefined,
    );
  });

  it.each([
    ['no id', { text: 'hi' }],
    ['an empty id', { id: '' }],
    ['a numeric id', { id: 12 }],
    ['an unknown comment type', { id: 'r1', type: 'complaint' }],
    ['a text that is not a string', { id: 'r1', text: { a: 1 } }],
  ])('refuses %s', (_label, body) => {
    expect(N8nCallbackSchema.safeParse(body).success).toBe(false);
  });
});

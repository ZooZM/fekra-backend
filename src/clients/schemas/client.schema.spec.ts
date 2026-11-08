import { readDmConfig } from '@common/zod/json-readers';
import { CreateClientSchema, UpdateClientSchema } from './client.schema';

const base = { name: 'C', businessCategory: 'B', accessToken: 't' };
const dm = (over: object) => ({
  enabled: false,
  likes_enabled: false,
  replies: [] as string[],
  ...over,
});

describe('client schemas', () => {
  it('requires a message when private messages are on, but not when off', () => {
    const on = CreateClientSchema.safeParse({
      ...base,
      dmReplyConfig: dm({ enabled: true }),
    });
    expect(on.success).toBe(false);
    expect(on.error?.issues[0].path).toEqual(['dmReplyConfig', 'replies']);
    expect(
      CreateClientSchema.safeParse({ ...base, dmReplyConfig: dm({}) }).success,
    ).toBe(true);
    expect(
      CreateClientSchema.safeParse({
        ...base,
        dmReplyConfig: dm({ enabled: true, replies: ['hi'] }),
      }).success,
    ).toBe(true);
  });

  it('limits message lists to 50 items of at most 1000 characters', () => {
    const fails = (replies: string[]) =>
      !CreateClientSchema.safeParse({ ...base, dmReplyConfig: dm({ replies }) })
        .success;
    expect(fails(Array.from({ length: 51 }, (_, i) => `m${i}`))).toBe(true);
    expect(fails(['x'.repeat(1001)])).toBe(true);
    expect(fails(['x'.repeat(1000)])).toBe(false);
  });

  it('accepts an empty comment list', () => {
    expect(
      CreateClientSchema.safeParse({
        ...base,
        commentReplyConfig: {
          enabled: true,
          likes_enabled: false,
          inquiry_can_dm: [],
          inquiry_can_not_dm: [],
          engagement: [],
        },
      }).success,
    ).toBe(true);
  });

  it('limits the brand voice to 400 characters', () => {
    const voice = (n: number) =>
      CreateClientSchema.safeParse({
        ...base,
        aiConfig: { language: 'ARABIC', brandVoice: 'x'.repeat(n) },
      }).success;
    expect(voice(400)).toBe(true);
    expect(voice(401)).toBe(false);
  });

  it('limits the logo link to 255 characters', () => {
    const logo = (n: number) =>
      CreateClientSchema.safeParse({
        ...base,
        brandLogo: `https://example.com/${'a'.repeat(n)}`,
      }).success;
    expect(logo(235)).toBe(true);
    expect(logo(236)).toBe(false);
  });

  it('requires a version on edits and refuses a token', () => {
    expect(UpdateClientSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(
      UpdateClientSchema.safeParse({ version: 1, name: 'x' }).success,
    ).toBe(true);
    expect(
      UpdateClientSchema.safeParse({ version: 1, accessToken: 'x' }).success,
    ).toBe(false);
    expect(UpdateClientSchema.safeParse({ version: 0 }).success).toBe(false);
  });

  it('keeps reading a stored config that is on with no messages (the reader stays lenient)', () => {
    const stored = { enabled: true, likes_enabled: false, replies: [] };
    expect(readDmConfig(stored)).toEqual(stored);
  });
});

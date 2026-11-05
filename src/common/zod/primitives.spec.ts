import {
  emailField,
  httpUrl,
  IdParamSchema,
  metaId,
  nameField,
  passwordField,
  replies,
  text,
  uniqueStrings,
} from './primitives';

describe('common zod primitives', () => {
  it('trims bounded text and rejects empty or oversized values', () => {
    expect(text(5).parse('  hello  ')).toBe('hello');
    expect(text(5).safeParse('   ').success).toBe(false);
    expect(text(5).safeParse('123456').success).toBe(false);
  });

  it('accepts only http(s) URLs and valid Meta ids', () => {
    expect(httpUrl.safeParse('https://example.com').success).toBe(true);
    expect(httpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(metaId.safeParse('12345').success).toBe(true);
    expect(metaId.safeParse('1234').success).toBe(false);
    expect(metaId.safeParse('abcde').success).toBe(false);
  });

  it('enforces reply and case-insensitive uniqueness limits', () => {
    expect(replies.safeParse(['hello']).success).toBe(true);
    expect(replies.safeParse(Array.from({ length: 51 }, () => 'x')).success).toBe(false);
    expect(uniqueStrings().safeParse(['One', 'two']).success).toBe(true);
    expect(uniqueStrings().safeParse(['One', 'one']).success).toBe(false);
  });

  it('normalizes email and validates names, passwords, and UUID params', () => {
    expect(emailField.parse('  USER@Example.COM ')).toBe('user@example.com');
    expect(nameField.parse('  Alice ')).toBe('Alice');
    expect(passwordField.safeParse('short').success).toBe(false);
    expect(IdParamSchema.safeParse({ id: '00000000-0000-4000-8000-000000000000' }).success).toBe(true);
    expect(IdParamSchema.safeParse({ id: 'not-an-id', extra: true }).success).toBe(false);
  });
});

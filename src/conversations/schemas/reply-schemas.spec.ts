import { randomUUID } from 'node:crypto';
import { classificationField, platformField } from '@common/zod/meta-fields';
import { externalId, storableText } from '@common/zod/storage-fields';
import {
  ChatIdParamSchema,
  FindOrCreateChatSchema,
  QueryChatSchema,
} from './chat.schema';
import {
  CreateMessageReplySchema,
  MAX_MESSAGE_LENGTH,
  MAX_REPLY_LENGTH,
  QueryMessageReplySchema,
} from './message-reply.schema';
import {
  MAX_COMMENT_LENGTH,
  QueryCommentReplySchema,
  ReclassifyCommentSchema,
  SaveCommentReplySchema,
} from '@app/comments/schemas/comment-reply.schema';

const clientId = randomUUID();
const chatId = randomUUID();

describe('field helpers', () => {
  describe('platformField', () => {
    it.each(['facebook', 'FACEBOOK', '  Facebook  '])(
      'maps "%s" to FACEBOOK',
      (v) => {
        expect(platformField.parse(v)).toBe('FACEBOOK');
      },
    );

    it('maps instagram to INSTAGRAM', () => {
      expect(platformField.parse('instagram')).toBe('INSTAGRAM');
    });

    it.each(['twitter', '', 123, null])('rejects %p', (v) => {
      expect(platformField.safeParse(v).success).toBe(false);
    });
  });

  describe('classificationField', () => {
    it.each([
      ['inquiry', 'INQUIRY'],
      ['ENGAGEMENT', 'ENGAGEMENT'],
      [' Unsure ', 'UNSURE'],
    ])('maps "%s" to %s', (input, expected) => {
      expect(classificationField.parse(input)).toBe(expected);
    });

    it.each(['complaint', 'spam', 'insult'])(
      'maps %s for persistence',
      (input) => {
        expect(classificationField.parse(input)).toBe(input.toUpperCase());
      },
    );
  });

  describe('externalId', () => {
    it.each([
      '123456789',
      '1067280970047460_123456789',
      'abc_123',
      'ig.user:1-2',
    ])('accepts "%s"', (v) => {
      expect(externalId.safeParse(v).success).toBe(true);
    });

    it.each([
      '',
      '   ',
      'has space',
      'semi;colon',
      'new\nline',
      'a'.repeat(256),
    ])('rejects %p', (v) => {
      expect(externalId.safeParse(v).success).toBe(false);
    });

    it('trims surrounding whitespace', () => {
      expect(externalId.parse('  123  ')).toBe('123');
    });
  });

  describe('storableText', () => {
    const schema = storableText(10);

    it('trims and keeps inner line breaks', () => {
      expect(schema.parse('  a\nb  ')).toBe('a\nb');
    });

    it('strips NUL characters, which Postgres rejects', () => {
      expect(schema.parse('he\u0000llo')).toBe('hello');
    });

    it('rejects text that is empty after trimming or stripping', () => {
      expect(schema.safeParse('   ').success).toBe(false);
      expect(schema.safeParse('\u0000\u0000').success).toBe(false);
    });

    it('checks the length after cleaning', () => {
      expect(schema.safeParse('a'.repeat(10) + '   ').success).toBe(true);
      expect(schema.safeParse('a'.repeat(11)).success).toBe(false);
    });

    it('can allow empty text', () => {
      expect(storableText(10, { allowEmpty: true }).parse('   ')).toBe('');
    });

    it('rejects non-strings', () => {
      expect(schema.safeParse(42).success).toBe(false);
    });
  });
});

describe('Chat schemas', () => {
  const valid = {
    clientId,
    platform: 'facebook',
    senderId: '555',
    receiverId: '111111111111111',
  };

  it('accepts a valid chat and outputs the database enum', () => {
    expect(FindOrCreateChatSchema.parse(valid)).toEqual({
      ...valid,
      platform: 'FACEBOOK',
    });
  });

  it('rejects a sender equal to the receiver', () => {
    const result = FindOrCreateChatSchema.safeParse({
      ...valid,
      senderId: valid.receiverId,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys and a bad client id', () => {
    expect(
      FindOrCreateChatSchema.safeParse({ ...valid, extra: 1 }).success,
    ).toBe(false);
    expect(
      FindOrCreateChatSchema.safeParse({ ...valid, clientId: 'nope' }).success,
    ).toBe(false);
  });

  it('requires every field', () => {
    for (const key of Object.keys(valid)) {
      const rest = Object.fromEntries(
        Object.entries(valid).filter(([k]) => k !== key),
      );
      expect(FindOrCreateChatSchema.safeParse(rest).success).toBe(false);
    }
  });

  describe('QueryChatSchema', () => {
    it('applies defaults', () => {
      expect(QueryChatSchema.parse({})).toEqual({
        page: 1,
        limit: 20,
        orderBy: 'updatedAt',
        orderDir: 'desc',
      });
    });

    it('coerces numbers and normalizes the platform', () => {
      const q = QueryChatSchema.parse({
        page: '2',
        limit: '50',
        platform: 'Instagram',
      });
      expect(q).toMatchObject({ page: 2, limit: 50, platform: 'INSTAGRAM' });
    });

    it.each([
      ['an orderBy outside the whitelist', { orderBy: 'senderId' }],
      ['an unknown parameter', { sort: 'name' }],
      ['a page of zero', { page: '0' }],
      ['a limit over 100', { limit: '101' }],
      ['a bad client id', { clientId: 'x' }],
    ])('rejects %s', (_label, query) => {
      expect(QueryChatSchema.safeParse(query).success).toBe(false);
    });
  });

  it('ChatIdParamSchema requires a uuid', () => {
    expect(ChatIdParamSchema.safeParse({ chatId }).success).toBe(true);
    expect(ChatIdParamSchema.safeParse({ chatId: '123' }).success).toBe(false);
    expect(ChatIdParamSchema.safeParse({ chatId, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('MessageReply schemas', () => {
  describe('CreateMessageReplySchema', () => {
    it('accepts and trims a valid pair', () => {
      expect(
        CreateMessageReplySchema.parse({
          chatId,
          message: '  hi\nI want to order ',
          reply: ' Sure! ',
        }),
      ).toEqual({ chatId, message: 'hi\nI want to order', reply: 'Sure!' });
    });

    it('strips NUL characters from customer text', () => {
      const parsed = CreateMessageReplySchema.parse({
        chatId,
        message: 'a\u0000b',
        reply: 'ok',
      });
      expect(parsed.message).toBe('ab');
    });

    it.each([
      ['an empty message', { message: '  ', reply: 'ok' }],
      ['an empty reply', { message: 'hi', reply: '' }],
      [
        'a message over the limit',
        { message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1), reply: 'ok' },
      ],
      [
        'a reply over the limit',
        { message: 'hi', reply: 'a'.repeat(MAX_REPLY_LENGTH + 1) },
      ],
      ['a missing field', { message: 'hi' }],
    ])('rejects %s', (_label, body) => {
      expect(
        CreateMessageReplySchema.safeParse({ chatId, ...body }).success,
      ).toBe(false);
    });

    it('accepts text exactly at the limit', () => {
      const body = {
        chatId,
        message: 'a'.repeat(MAX_MESSAGE_LENGTH),
        reply: 'b'.repeat(MAX_REPLY_LENGTH),
      };
      expect(CreateMessageReplySchema.safeParse(body).success).toBe(true);
    });

    it('rejects a bad chat id and unknown keys', () => {
      expect(
        CreateMessageReplySchema.safeParse({
          chatId: 'x',
          message: 'a',
          reply: 'b',
        }).success,
      ).toBe(false);
      expect(
        CreateMessageReplySchema.safeParse({
          chatId,
          message: 'a',
          reply: 'b',
          id: 1,
        }).success,
      ).toBe(false);
    });
  });

  describe('QueryMessageReplySchema', () => {
    it('applies defaults', () => {
      expect(QueryMessageReplySchema.parse({})).toEqual({
        page: 1,
        limit: 20,
        orderBy: 'createdAt',
        orderDir: 'desc',
      });
    });

    it('parses date-only and full ISO dates into Date objects', () => {
      const q = QueryMessageReplySchema.parse({
        from: '2026-11-01',
        to: '2026-11-09T10:00:00Z',
      });
      expect(q.from).toEqual(new Date('2026-11-01'));
      expect(q.to).toEqual(new Date('2026-11-09T10:00:00Z'));
    });

    it.each(['yesterday', '2026-13-45', '1700000000', ''])(
      'rejects the date "%s"',
      (value) => {
        expect(QueryMessageReplySchema.safeParse({ from: value }).success).toBe(
          false,
        );
      },
    );

    it('rejects a range that ends before it starts', () => {
      const result = QueryMessageReplySchema.safeParse({
        from: '2026-11-09',
        to: '2026-11-01',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['to']);
    });

    it('accepts equal dates', () => {
      expect(
        QueryMessageReplySchema.safeParse({
          from: '2026-11-01',
          to: '2026-11-01',
        }).success,
      ).toBe(true);
    });

    it('rejects ordering by any other field', () => {
      expect(
        QueryMessageReplySchema.safeParse({ orderBy: 'reply' }).success,
      ).toBe(false);
    });
  });
});

describe('CommentReply schemas', () => {
  const valid = {
    clientId,
    platform: 'instagram',
    commentId: '17900000000000000',
    comment: 'بكام ده؟',
    classification: 'inquiry',
    reason: 'question mark',
  };

  describe('SaveCommentReplySchema', () => {
    it('accepts the classifier output and converts it to database enums', () => {
      expect(SaveCommentReplySchema.parse(valid)).toEqual({
        ...valid,
        platform: 'INSTAGRAM',
        classification: 'INQUIRY',
      });
    });

    it('accepts an empty comment (a sticker or GIF)', () => {
      expect(
        SaveCommentReplySchema.parse({ ...valid, comment: '' }).comment,
      ).toBe('');
    });

    it('accepts a Facebook-style comment id', () => {
      expect(
        SaveCommentReplySchema.safeParse({ ...valid, commentId: '111_222' })
          .success,
      ).toBe(true);
    });

    it('strips NUL characters from the comment', () => {
      expect(
        SaveCommentReplySchema.parse({ ...valid, comment: 'hi\u0000there' })
          .comment,
      ).toBe('hithere');
    });

    it('enforces the comment length limit', () => {
      expect(
        SaveCommentReplySchema.safeParse({
          ...valid,
          comment: 'a'.repeat(MAX_COMMENT_LENGTH),
        }).success,
      ).toBe(true);
      expect(
        SaveCommentReplySchema.safeParse({
          ...valid,
          comment: 'a'.repeat(MAX_COMMENT_LENGTH + 1),
        }).success,
      ).toBe(false);
    });

    it.each([
      ['a missing reason', { reason: undefined }],
      ['a blank reason', { reason: '   ' }],
      ['an unknown classification', { classification: 'other' }],
      ['an unknown platform', { platform: 'tiktok' }],
      ['a bad client id', { clientId: 'x' }],
      ['an empty comment id', { commentId: '' }],
      ['an unknown key', { raw: {} }],
    ])('rejects %s', (_label, override) => {
      expect(
        SaveCommentReplySchema.safeParse({ ...valid, ...override }).success,
      ).toBe(false);
    });
  });

  describe('ReclassifyCommentSchema', () => {
    it('accepts only a label and a reason', () => {
      expect(
        ReclassifyCommentSchema.parse({
          classification: 'engagement',
          reason: 'LLM: praise',
        }),
      ).toEqual({
        classification: 'ENGAGEMENT',
        reason: 'LLM: praise',
      });
    });

    it('rejects fields that should never change on an update', () => {
      expect(
        ReclassifyCommentSchema.safeParse({
          classification: 'inquiry',
          reason: 'x',
          comment: 'edited',
        }).success,
      ).toBe(false);
    });
  });

  describe('QueryCommentReplySchema', () => {
    it('applies defaults', () => {
      expect(QueryCommentReplySchema.parse({})).toEqual({
        page: 1,
        limit: 20,
        orderBy: 'createdAt',
        orderDir: 'desc',
      });
    });

    it('normalizes platform and classification filters', () => {
      const q = QueryCommentReplySchema.parse({
        platform: 'FACEBOOK',
        classification: 'Inquiry',
      });
      expect(q).toMatchObject({
        platform: 'FACEBOOK',
        classification: 'INQUIRY',
      });
    });

    it('validates the date range', () => {
      expect(
        QueryCommentReplySchema.safeParse({
          from: '2026-11-09',
          to: '2026-11-01',
        }).success,
      ).toBe(false);
      expect(
        QueryCommentReplySchema.safeParse({
          from: '2026-11-01',
          to: '2026-11-09',
        }).success,
      ).toBe(true);
    });

    it('rejects unknown parameters and bad filters', () => {
      expect(QueryCommentReplySchema.safeParse({ text: 'hello' }).success).toBe(
        false,
      );
      expect(
        QueryCommentReplySchema.safeParse({ classification: 'other' }).success,
      ).toBe(false);
    });
  });
});

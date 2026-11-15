import { randomUUID } from 'node:crypto';
import {
  ExportCommentsQuerySchema,
  QueryCommentReplySchema,
  ReclassifyCommentSchema,
  SaveCommentReplySchema,
} from './comment-reply.schema';

const clientId = randomUUID();

describe('QueryCommentReplySchema', () => {
  it('accepts the decision basis in any case and outputs the database value', () => {
    expect(
      QueryCommentReplySchema.parse({ decisionBasis: 'ai_model' })
        .decisionBasis,
    ).toBe('AI_MODEL');
    expect(
      QueryCommentReplySchema.parse({ decisionBasis: 'Safe_Fallback' })
        .decisionBasis,
    ).toBe('SAFE_FALLBACK');
    expect(QueryCommentReplySchema.parse({}).decisionBasis).toBeUndefined();
  });

  it('rejects an unknown decision basis and unknown keys', () => {
    expect(
      QueryCommentReplySchema.safeParse({ decisionBasis: 'x' }).success,
    ).toBe(false);
    expect(QueryCommentReplySchema.safeParse({ nope: 1 }).success).toBe(false);
  });

  it('puts a to-before-from error on the to field', () => {
    const result = QueryCommentReplySchema.safeParse({
      from: '2026-11-10',
      to: '2026-11-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['to']);
    }
  });

  it('keeps newest-first ordering as the default', () => {
    const q = QueryCommentReplySchema.parse({});
    expect(q.orderBy).toBe('createdAt');
    expect(q.orderDir).toBe('desc');
    expect(q.limit).toBe(20);
  });
});

describe('ExportCommentsQuerySchema', () => {
  it('takes the list filters and nothing about paging or order', () => {
    const q = ExportCommentsQuerySchema.parse({
      clientId,
      platform: 'facebook',
      classification: 'complaint',
      decisionBasis: 'rules',
      from: '2026-11-01',
      to: '2026-11-14',
    });
    expect(q).toMatchObject({
      clientId,
      platform: 'FACEBOOK',
      classification: 'COMPLAINT',
      decisionBasis: 'RULES',
    });
    expect(q.from).toBeInstanceOf(Date);
  });

  it.each(['page', 'limit', 'orderBy', 'orderDir'])('rejects %s', (key) => {
    expect(ExportCommentsQuerySchema.safeParse({ [key]: 1 }).success).toBe(
      false,
    );
  });

  it('applies the same date-range rule', () => {
    const result = ExportCommentsQuerySchema.safeParse({
      from: '2026-11-10',
      to: '2026-11-01',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty query (everything)', () => {
    expect(ExportCommentsQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('writing a classified comment', () => {
  const base = {
    clientId,
    platform: 'facebook',
    commentId: '1_2',
    comment: 'hi',
    classification: 'inquiry',
    reason: 'question mark',
  };

  it('defaults the decision basis to UNKNOWN', () => {
    const parsed = SaveCommentReplySchema.parse(base);
    expect(parsed.decisionBasis).toBe('UNKNOWN');
    expect(parsed.decisionModel).toBeUndefined();
  });

  it('keeps the basis and a bounded model name', () => {
    const parsed = SaveCommentReplySchema.parse({
      ...base,
      decisionBasis: 'AI_MODEL',
      decisionModel: 'gemini-x',
    });
    expect(parsed).toMatchObject({
      decisionBasis: 'AI_MODEL',
      decisionModel: 'gemini-x',
    });
    expect(
      SaveCommentReplySchema.safeParse({
        ...base,
        decisionModel: 'm'.repeat(101),
      }).success,
    ).toBe(false);
  });

  it('rejects a basis that is not in the enum', () => {
    expect(
      SaveCommentReplySchema.safeParse({ ...base, decisionBasis: 'GUESS' })
        .success,
    ).toBe(false);
  });

  it('allows an empty comment (a sticker or GIF)', () => {
    expect(
      SaveCommentReplySchema.safeParse({ ...base, comment: '' }).success,
    ).toBe(true);
  });

  it('lets a re-classification change the label, the reason and how it was decided', () => {
    const parsed = ReclassifyCommentSchema.parse({
      classification: 'spam',
      reason: 'llm failed, fallback to spam',
      decisionBasis: 'SAFE_FALLBACK',
    });
    expect(parsed.decisionBasis).toBe('SAFE_FALLBACK');
    expect(Object.keys(parsed).sort()).toEqual(
      ['classification', 'decisionBasis', 'reason'].sort(),
    );
  });
});

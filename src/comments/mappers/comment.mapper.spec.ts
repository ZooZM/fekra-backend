import { CommentRowWithClient } from '../types/comment.types';
import { toCommentRecord } from './comment.mapper';

const row = (over: Partial<CommentRowWithClient> = {}) =>
  ({
    id: 'id-1',
    clientId: 'client-1',
    platform: 'INSTAGRAM',
    commentId: 'c-9',
    comment: '',
    classification: 'ENGAGEMENT',
    reason: 'empty (probably a sticker or GIF)',
    decisionBasis: 'RULES',
    decisionModel: null,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
    client: { name: 'Acme' },
    ...over,
  }) as CommentRowWithClient;

describe('toCommentRecord', () => {
  it('copies every field and takes the client name from the joined client', () => {
    expect(toCommentRecord(row())).toEqual({
      id: 'id-1',
      clientId: 'client-1',
      clientName: 'Acme',
      platform: 'INSTAGRAM',
      commentId: 'c-9',
      comment: '',
      classification: 'ENGAGEMENT',
      reason: 'empty (probably a sticker or GIF)',
      decisionBasis: 'RULES',
      decisionModel: null,
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
    });
  });

  it('keeps the model of an AI decision', () => {
    const record = toCommentRecord(
      row({ decisionBasis: 'AI_MODEL', decisionModel: 'gemini-x' }),
    );
    expect(record.decisionBasis).toBe('AI_MODEL');
    expect(record.decisionModel).toBe('gemini-x');
  });

  it('does not leak the joined client object', () => {
    expect(toCommentRecord(row())).not.toHaveProperty('client');
  });
});

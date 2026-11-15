import { CommentRecord, CommentRowWithClient } from '../types/comment.types';

export function toCommentRecord(row: CommentRowWithClient): CommentRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    platform: row.platform,
    commentId: row.commentId,
    comment: row.comment,
    classification: row.classification,
    reason: row.reason,
    decisionBasis: row.decisionBasis,
    decisionModel: row.decisionModel,
    createdAt: row.createdAt,
  };
}

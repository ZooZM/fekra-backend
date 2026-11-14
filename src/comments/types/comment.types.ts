import { Prisma } from '@app/generated/prisma/client';

export type CommentRowWithClient = Prisma.CommentReplyGetPayload<{
  include: { client: { select: { name: true } } };
}>;

/** What the API returns for a classified comment (data-model §8). */
export interface CommentRecord {
  id: string;
  clientId: string;
  clientName: string;
  platform: CommentRowWithClient['platform'];
  commentId: string;
  /** Empty for a sticker or GIF. */
  comment: string;
  classification: CommentRowWithClient['classification'];
  reason: string;
  decisionBasis: CommentRowWithClient['decisionBasis'];
  /** The model that gave the label, for AI_MODEL only. */
  decisionModel: string | null;
  createdAt: Date;
}

/** The administrator behind a download, copied into its record. */
export interface ExportActor {
  id: string;
  name: string;
  email: string;
}

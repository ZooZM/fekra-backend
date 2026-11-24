// inbox/inbox.types.ts
export type Platform = 'facebook' | 'instagram';
export const N8N_REPLY_TYPES = ['text', 'voice'] as const;
export type N8nReplyType = (typeof N8N_REPLY_TYPES)[number];

export interface BufferedMessage {
  mid: string;
  text: string;
  timestamp: number;
}

interface Base {
  id: string;
  platform: Platform;
  accountId: string;
  timestamp: number; // milliseconds
}

export type InboxItem =
  | (Base & {
      kind: 'comment';
      senderId?: string;
      text?: string;
      postId?: string;
      raw?: unknown;
      /** Failed LLM classification attempts so far (set when the comment is scheduled for a retry). */
      llmAttempts?: number;
    })
  | (Base & {
      kind: 'message';
      senderId: string;
      text?: string;
      attachments?: InboxAttachment[];
    })
  | (Base & { kind: 'batch'; senderId: string; messages: BufferedMessage[] });

export interface InboxAttachment {
  type: 'image' | 'audio';
  url: string;
}

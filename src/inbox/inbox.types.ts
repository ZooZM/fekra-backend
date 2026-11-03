// inbox/inbox.types.ts
export type Platform = 'facebook' | 'instagram';

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

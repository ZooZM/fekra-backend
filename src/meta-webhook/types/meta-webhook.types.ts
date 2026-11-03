// meta-webhook.types.ts
export interface MetaFeedValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  message?: string;
  from?: { id: string; name?: string };
  created_time?: number;
}

// Dashboard "messages" tests arrive as changes[] with this shape
export interface MetaMessagesChangeValue {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: string | number;
  message?: { mid: string; text?: string };
}

export interface MetaChange {
  field: string;
  value: Record<string, any>; // cast to MetaFeedValue / MetaMessagesChangeValue per field
}

export interface MetaMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MetaAttachment[];
  };
  postback?: { payload: string };
}

export interface MetaEntry {
  id: string;
  time: number;
  changes?: MetaChange[];
  messaging?: MetaMessagingEvent[];
}

export interface MetaWebhookPayload {
  object: string;
  entry?: MetaEntry[];
}

export interface MetaInstagramCommentValue {
  id: string; // comment id
  text?: string;
  parent_id?: string; // set when the comment is a reply to another comment
  from?: { id: string; username?: string };
  media?: { id: string; media_product_type?: string };
}

export interface MetaAttachment {
  type: string; // image | audio | video | file | location | fallback ...
  payload?: { url?: string; sticker_id?: number };
}

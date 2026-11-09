// client-posts/types/client-post.types.ts
// Shapes of what the Graph API returns for posts and media. Only the fields we ask for.
export type { Platform } from '@app/inbox/inbox.types';

export interface FacebookPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  /** `comments.summary(true).limit(0)`: no comments, only the count of top-level ones. */
  comments?: { summary?: { total_count?: number } };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  timestamp?: string;
  permalink?: string;
  /** IMAGE, VIDEO or CAROUSEL_ALBUM; kept a string so a new media type from Meta is not a type error. */
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  /** Includes replies, unlike Facebook's top-level count. */
  comments_count?: number;
}

export interface GraphPage<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

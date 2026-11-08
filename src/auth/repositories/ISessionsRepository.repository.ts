export const SESSIONS_REPOSITORY = 'SESSIONS_REPOSITORY';

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
}

export interface ISessionsRepository {
  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  touch(id: string, at: Date): Promise<void>;
  /** Idempotent: does nothing for an unknown or already revoked session. */
  revoke(id: string, at: Date): Promise<void>;
}

// auth/session.service.ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import {
  ISessionsRepository,
  SESSIONS_REPOSITORY,
} from './repositories/ISessionsRepository.repository';
import {
  DEFAULT_SESSION_IDLE_MINUTES,
  DEFAULT_SESSION_MAX_HOURS,
} from './consts/session.constants';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const sessionExpired = () =>
  new UnauthorizedException({
    message: 'Session expired',
    errorCode: 'SESSION_EXPIRED',
  });

/**
 * Server-side sign-in sessions. The browser holds an opaque random value in an httpOnly
 * cookie; only its SHA-256 hash is stored. A session ends after `SESSION_IDLE_MINUTES`
 * without a refresh, after `SESSION_MAX_HOURS` in all cases, or when revoked at sign-out.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSIONS_REPOSITORY) private readonly repo: ISessionsRepository,
    private readonly config: ConfigService,
  ) {}

  private get idleMs(): number {
    const minutes = Number(this.config.get('SESSION_IDLE_MINUTES'));
    return (minutes > 0 ? minutes : DEFAULT_SESSION_IDLE_MINUTES) * 60_000;
  }

  private get maxMs(): number {
    const hours = Number(this.config.get('SESSION_MAX_HOURS'));
    return (hours > 0 ? hours : DEFAULT_SESSION_MAX_HOURS) * 3_600_000;
  }

  async start(userId: string) {
    const cookieValue = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.maxMs);
    const { id } = await this.repo.create({
      userId,
      tokenHash: sha256(cookieValue),
      expiresAt,
    });
    return { sessionId: id, cookieValue, expiresAt };
  }

  /** Extends the idle window. Throws SESSION_EXPIRED when the session can't be used. */
  async refresh(cookieValue: string | undefined) {
    if (!cookieValue) throw sessionExpired();
    const session = await this.repo.findByTokenHash(sha256(cookieValue));
    if (!session || session.revokedAt) throw sessionExpired();

    const now = Date.now();
    if (now >= session.expiresAt.getTime()) throw sessionExpired();
    if (now - session.lastUsedAt.getTime() >= this.idleMs) {
      throw sessionExpired();
    }

    await this.repo.touch(session.id, new Date(now));
    return {
      sessionId: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    };
  }

  /** Idempotent: unknown or missing cookies are ignored. */
  async revoke(cookieValue: string | undefined): Promise<void> {
    if (!cookieValue) return;
    const session = await this.repo.findByTokenHash(sha256(cookieValue));
    if (session) await this.repo.revoke(session.id, new Date());
  }

  /** Used for every access token that carries a `sid`. */
  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.repo.findById(sessionId);
    return (
      !!session &&
      !session.revokedAt &&
      Date.now() < session.expiresAt.getTime()
    );
  }
}

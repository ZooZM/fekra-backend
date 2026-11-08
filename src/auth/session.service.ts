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
  UNLIMITED_SESSION_MS,
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
 * Setting either variable to 0 removes that limit (0 for both: signed in until sign-out).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSIONS_REPOSITORY) private readonly repo: ISessionsRepository,
    private readonly config: ConfigService,
  ) {}

  /** null = no limit. Unset or invalid falls back to the default; an explicit 0 means none. */
  private limitMs(
    key: string,
    unitMs: number,
    fallback: number,
  ): number | null {
    const raw = this.config.get<string | number>(key);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return fallback * unitMs;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return fallback * unitMs;
    return value === 0 ? null : value * unitMs;
  }

  private get idleMs(): number | null {
    return this.limitMs(
      'SESSION_IDLE_MINUTES',
      60_000,
      DEFAULT_SESSION_IDLE_MINUTES,
    );
  }

  private get maxMs(): number | null {
    return this.limitMs(
      'SESSION_MAX_HOURS',
      3_600_000,
      DEFAULT_SESSION_MAX_HOURS,
    );
  }

  /** What the dashboard needs to follow: minutes of inactivity before it signs out, if any. */
  get policy(): { idleTimeoutMinutes?: number } {
    const idle = this.idleMs;
    return idle === null
      ? {}
      : { idleTimeoutMinutes: Math.round(idle / 60_000) };
  }

  async start(userId: string) {
    const cookieValue = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + (this.maxMs ?? UNLIMITED_SESSION_MS),
    );
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
    const idleMs = this.idleMs;
    if (idleMs !== null && now - session.lastUsedAt.getTime() >= idleMs) {
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

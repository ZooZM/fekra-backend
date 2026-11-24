import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { Platform as DbPlatform } from '@app/generated/prisma/client';
import { ClientsService } from '@app/clients/clients.service';
import { ConversationsService } from '@app/conversations/conversations.service';
import { LeadsService } from '@app/leads/leads.service';
import {
  StaleLeadCandidate,
  StaleLeadCursor,
} from '@app/leads/types/lead.types';
import { LEAD_RECOVERY_LOCK, REDIS } from './inbox.constants';
import { N8nDeliveryService } from './n8n-delivery.service';
import { Platform } from './inbox.types';

const LEAD_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;
const RECOVERY_PAGE_SIZE = 100;
const LOCK_TTL_SECONDS = 2 * 24 * 60 * 60;
const HISTORY_LIMIT = 10;

/** Replays the latest exchange for leads whose data has not changed in 24 hours. */
@Injectable()
export class LeadRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadRecoveryService.name);
  private firstRun?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly leads: LeadsService,
    private readonly clients: ClientsService,
    private readonly conversations: ConversationsService,
    private readonly delivery: N8nDeliveryService,
  ) {}

  onModuleInit(): void {
    this.firstRun = setTimeout(() => void this.runOnce(), FIRST_RUN_DELAY_MS);
    this.interval = setInterval(
      () => void this.runOnce(),
      RECOVERY_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.interval) clearInterval(this.interval);
  }

  /** A shared Redis lock prevents duplicate replays when more than one API instance is running. */
  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    const lockToken = randomUUID();
    let lockAcquired = false;
    let queued = 0;
    let skipped = 0;

    try {
      lockAcquired =
        (await this.redis.set(
          LEAD_RECOVERY_LOCK,
          lockToken,
          'EX',
          LOCK_TTL_SECONDS,
          'NX',
        )) === 'OK';
      if (!lockAcquired) return;

      const cutoff = new Date(now.getTime() - LEAD_STALE_AFTER_MS);
      let cursor: StaleLeadCursor | undefined;
      for (;;) {
        const page = await this.leads.findStaleForRecovery(
          cutoff,
          cursor,
          RECOVERY_PAGE_SIZE,
        );
        if (page.length === 0) break;

        for (const candidate of page) {
          try {
            if (await this.replay(candidate)) queued++;
            else skipped++;
          } catch (err) {
            skipped++;
            this.logger.error(
              `Lead recovery failed for lead ${candidate.id}: ${(err as Error).message}`,
              (err as Error).stack,
            );
          }
        }

        const last = page[page.length - 1];
        cursor = { id: last.id, updatedAt: last.updatedAt };
        if (page.length < RECOVERY_PAGE_SIZE) break;
      }

      this.logger.log(
        `Lead recovery run finished: queued ${queued}, skipped ${skipped} stale leads`,
      );
    } catch (err) {
      this.logger.error(
        `Lead recovery run failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      if (lockAcquired) {
        try {
          await this.redis.eval(
            `if redis.call('GET', KEYS[1]) == ARGV[1] then
               return redis.call('DEL', KEYS[1])
             end
             return 0`,
            1,
            LEAD_RECOVERY_LOCK,
            lockToken,
          );
        } catch (err) {
          this.logger.error(
            `Could not release lead recovery lock: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      }
      this.running = false;
    }
  }

  private async replay(candidate: StaleLeadCandidate): Promise<boolean> {
    if (
      candidate.clientId === null ||
      candidate.platform === null ||
      candidate.accountId === null ||
      candidate.senderId === null
    ) {
      return false;
    }
    if (
      candidate.stage !== null &&
      candidate.phone !== null &&
      candidate.country !== null &&
      candidate.lastIntent !== null &&
      candidate.summary !== null &&
      candidate.notifiedAt !== null
    ) {
      return false;
    }

    const route = await this.clients.findChatRouteById(candidate.clientId);
    if (
      !route?.chatSubscribed ||
      !route.chatWorkflowEndpoint ||
      route.clientId !== candidate.clientId
    ) {
      return false;
    }

    const client = await this.clients.findWorkflowDataFresh(
      candidate.accountId,
    );
    if (
      !client ||
      client.id !== candidate.clientId ||
      !client.chatSubscribed ||
      !client.chatWorkflowEndpoint
    ) {
      return false;
    }

    const exchanges = await this.conversations.findLastMessagesByIdForWorkflow(
      candidate.senderId,
      candidate.accountId,
      toInboxPlatform(candidate.platform),
    );
    const latest = exchanges[exchanges.length - 1];
    if (!latest || !latest.message.trim()) return false;

    const requestId = `lead-recovery-${candidate.id}-${latest.id}`;
    await this.delivery.send(requestId, {
      kind: 'batch',
      platform: toInboxPlatform(candidate.platform),
      id: requestId,
      accountId: candidate.accountId,
      senderId: candidate.senderId,
      clientId: candidate.clientId,
      client,
      messages: [
        {
          mid: latest.id,
          text: latest.message,
          timestamp: latest.createdAt.getTime(),
        },
      ],
      latestMessages: exchanges.slice(0, -1),
      recovery: true,
    });
    return true;
  }
}

const toInboxPlatform = (platform: DbPlatform): Platform =>
  platform === 'FACEBOOK' ? 'facebook' : 'instagram';

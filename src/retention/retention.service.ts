import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommentsService } from '@app/comments/comments.service';
import { ConversationsService } from '@app/conversations/conversations.service';
import { LeadsService } from '@app/leads/leads.service';

const DEFAULT_MONTHS = 12;
const FIRST_RUN_DELAY_MS = 60_000;
const RUN_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes customer messages, classified comments and leads (phone numbers) that are older than
 * RETENTION_MONTHS (FR-049, FR-050; research R15; feature 004 for leads). Once a day, in batches, through the services that own the
 * tables. A run is safe to repeat and safe on several instances: deleting what is already gone is
 * a no-op.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private readonly months: number;
  private firstRun?: NodeJS.Timeout;
  private daily?: NodeJS.Timeout;

  constructor(
    config: ConfigService,
    private readonly conversations: ConversationsService,
    private readonly comments: CommentsService,
    private readonly leads: LeadsService,
  ) {
    // A bad value fails at boot, not on the first night it would have deleted the wrong thing
    const raw = config.get<string | number>('RETENTION_MONTHS');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      this.months = DEFAULT_MONTHS;
    } else {
      const months = Number(raw);
      if (!Number.isInteger(months) || months < 1) {
        throw new Error('RETENTION_MONTHS must be an integer of at least 1');
      }
      this.months = months;
    }
  }

  onModuleInit() {
    this.firstRun = setTimeout(() => void this.runOnce(), FIRST_RUN_DELAY_MS);
    this.daily = setInterval(() => void this.runOnce(), RUN_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.daily) clearInterval(this.daily);
  }

  /** Never throws, so the schedule keeps running after a failed run. */
  async runOnce(now: Date = new Date()): Promise<void> {
    try {
      const cutoff = this.cutoff(now);
      const { chats, exchanges } = await this.conversations.purgeBefore(cutoff);
      const comments = await this.comments.purgeBefore(cutoff);
      // a lead counts from its last update: an active conversation keeps its lead
      const leads = await this.leads.purgeBefore(cutoff);
      // counts only: never any customer text (FR-050)
      this.logger.log(
        `Retention run: deleted ${chats} conversations, ${exchanges} exchanges, ${comments} comments and ${leads} leads older than ${this.months} months`,
      );
    } catch (err) {
      this.logger.error(
        `Retention run failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /** `now` minus RETENTION_MONTHS calendar months in UTC (31 March minus 1 month = 28 February). */
  cutoff(now: Date): Date {
    const date = new Date(now);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - this.months);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date;
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from './conversations.service';

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Records the end of timed pauses. The pause itself ends on time without it (the state is
 * computed on every read); this only writes the automatic RESUMED entry and clears the columns.
 */
@Injectable()
export class ChatPauseSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatPauseSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly conversations: ConversationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const configured = Number(this.config.get('PAUSE_SWEEP_INTERVAL_MS'));
    const interval =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => void this.sweep(), interval);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Never throws, so the interval keeps running after a failed tick. */
  async sweep(): Promise<void> {
    try {
      const released = await this.conversations.releaseExpiredPauses();
      if (released > 0) {
        this.logger.log(`Released ${released} expired conversation pause(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Pause sweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}

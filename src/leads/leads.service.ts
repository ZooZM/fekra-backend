import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Platform } from '@app/generated/prisma/client';
import { ClientsService } from '@app/clients/clients.service';
import { ConversationsService } from '@app/conversations/conversations.service';
import {
  ILeadsRepository,
  LEADS_REPOSITORY,
} from './repositories/ILeadsRepository.repository';
import { LeadContextQuery, UpsertLeadInput } from './schemas/lead.schema';
import { LeadContext, UpsertLeadResult } from './types/lead.types';
import { LeadKey } from './interfaces/lead-write.interface';
import { mergeLead } from './helpers/merge-lead';

/** The lead endpoints' 404: unknown client, or an account that is not the client's. */
export const CLIENT_ACCOUNT_NOT_FOUND = 'CLIENT_ACCOUNT_NOT_FOUND';

interface Scope {
  clientId: string;
  platform: Platform;
  accountId: string;
  senderId: string;
}

/**
 * What the n8n chat workflows read and save about a customer (feature 004). Every call is scoped:
 * the account must be the client's, and only that client's lead and conversation are read or
 * written, so a workflow (even one shared by several clients) never touches another client's data.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @Inject(LEADS_REPOSITORY) private readonly repo: ILeadsRepository,
    private readonly clients: ClientsService,
    private readonly conversations: ConversationsService,
  ) {}

  /** The lead (or null) and the latest exchanges, oldest first. Creates nothing. */
  async context(query: LeadContextQuery): Promise<LeadContext> {
    await this.assertOwnsAccount(query);
    const [lead, history] = await Promise.all([
      this.repo.findByKey(keyOf(query), query.clientId),
      this.conversations.recentExchanges({
        clientId: query.clientId,
        platform: query.platform,
        receiverId: query.accountId,
        senderId: query.senderId,
        limit: query.historyLimit,
      }),
    ]);
    return { lead, history };
  }

  /** Creates or merges the lead (rules in mergeLead) and claims the notification when asked. */
  async upsert(input: UpsertLeadInput): Promise<UpsertLeadResult> {
    await this.assertOwnsAccount(input);
    const result = await this.repo.upsert(
      keyOf(input),
      input.clientId,
      (current) => mergeLead(current, input),
      input.claimNotification,
    );
    // ids only: never the phone, the summary or the fields
    if (result.notifiedNow) {
      this.logger.log(
        `Lead ${result.lead.id} of client ${input.clientId}: notification claimed`,
      );
    } else {
      this.logger.debug(
        `Lead ${result.lead.id} of client ${input.clientId} saved`,
      );
    }
    return result;
  }

  /** Called by the retention run. Returns how many leads were deleted. */
  purgeBefore(cutoff: Date): Promise<number> {
    return this.repo.purgeBefore(cutoff);
  }

  private async assertOwnsAccount(scope: Scope): Promise<void> {
    const owned = await this.clients.ownsAccount(
      scope.clientId,
      scope.platform,
      scope.accountId,
    );
    if (!owned) {
      // the same answer for both cases, so it does not reveal which ids exist
      throw new NotFoundException({
        message: 'Client or account not found',
        errorCode: CLIENT_ACCOUNT_NOT_FOUND,
      });
    }
  }
}

const keyOf = (scope: Scope): LeadKey => ({
  platform: scope.platform,
  accountId: scope.accountId,
  senderId: scope.senderId,
});

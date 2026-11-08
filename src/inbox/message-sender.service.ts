// inbox/message-sender.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ClientsService } from '@app/clients/clients.service';
import {
  GraphApiService,
  GraphError,
  SendableRequest,
} from './graph-api.service';

const DM_LIMIT = 2000; // Messenger text limit per message

@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger(MessageSenderService.name);

  constructor(
    private readonly graph: GraphApiService,
    private readonly clients: ClientsService,
  ) {}

  /** Never throws, so callers can use `void sender.reply(...)`. */
  async reply(req: SendableRequest, text: string): Promise<void> {
    try {
      if (!req.client) throw new GraphError('client is missing', false);
      const token = await this.clients.getAccessToken(req.client.id);
      if (!token)
        throw new GraphError('No access token stored for this client', false);
      if (!req.senderId) throw new GraphError('senderId is missing', false);

      this.logger.log(req.client);
      const url = `${this.graph.host(req.platform)}/${req.accountId}/messages`;
      for (let i = 0; i < text.length; i += DM_LIMIT) {
        await this.graph.post(
          url,
          {
            recipient: { id: req.senderId },
            messaging_type: 'RESPONSE',
            message: { text: text.slice(i, i + DM_LIMIT) },
          },
          token,
        );
      }
      this.logger.log(`DM sent to ${req.senderId} (${req.platform})`);
    } catch (err) {
      this.logger.error(
        `DM failed for ${req.senderId}: ${(err as Error).message}`,
      );
      await this.graph.deadLetter({
        service: 'message',
        request: req,
        text,
        error: (err as Error).message,
      });
    }
  }
}

// inbox/message-sender.service.ts
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientsService } from '@app/clients/clients.service';
import {
  GraphApiService,
  GraphError,
  SendableRequest,
} from './graph-api.service';
import { ConversationsService } from '@app/conversations/conversations.service';

const DM_LIMIT = 2000; // Messenger text limit per message

@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger(MessageSenderService.name);

  constructor(
    private readonly graph: GraphApiService,
    @Inject(forwardRef(() => ClientsService))
    private readonly clients: ClientsService,
    private readonly conversations: ConversationsService,
  ) {}

  /** Never throws, so callers can use `void sender.reply(...)`. */
  async reply(req: SendableRequest, text: string): Promise<void> {
    let messages: NonNullable<SendableRequest['messages']>;
    try {
      if (!req.client) throw new GraphError('client is missing', false);
      const token = await this.clients.getAccessToken(req.client.id);
      if (!token)
        throw new GraphError('No access token stored for this client', false);
      if (!req.senderId) throw new GraphError('senderId is missing', false);
      if (req.kind !== 'batch' || !req.messages?.length) {
        throw new GraphError('message batch is missing', false);
      }
      messages = req.messages;

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
      return;
    }

    try {
      const chat = await this.conversations.findOrCreate({
        clientId: req.clientId,
        platform: req.platform,
        senderId: req.senderId,
        receiverId: req.accountId,
      });
      await this.conversations.createMessage({
        chatId: chat.id,
        message: messages.map((message) => message.text).join('\n'),
        reply: text,
      });
      this.logger.log(
        `DM sent and recorded for ${req.senderId} (${req.platform})`,
      );
    } catch (err) {
      this.logger.error(
        `DM sent to ${req.senderId}, but conversation ${req.id} could not be recorded: ${(err as Error).message}`,
      );
    }
  }
}

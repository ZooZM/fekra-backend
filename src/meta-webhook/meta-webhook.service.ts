import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger(MetaWebhookService.name);

  verifyChallenge(mode: string | undefined, token: string | undefined): void {
    const expectedToken = process.env.META_VERIFY_TOKEN;

    if (!expectedToken) {
      throw new InternalServerErrorException(
        'META_VERIFY_TOKEN is not configured',
      );
    }

    if (mode !== 'subscribe' || token !== expectedToken) {
      throw new BadRequestException('Invalid Meta webhook verification');
    }
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const appSecret = process.env.META_APP_SECRET;

    if (!appSecret) {
      throw new InternalServerErrorException(
        'META_APP_SECRET is not configured',
      );
    }

    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new BadRequestException('Missing Meta webhook signature');
    }

    const received = Buffer.from(signature.slice('sha256='.length), 'hex');
    const expected = createHmac('sha256', appSecret).update(rawBody).digest();

    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new BadRequestException('Invalid Meta webhook signature');
    }
  }

  handleEvent(payload: unknown): void {
    this.logger.log(
      `Received Meta webhook event: ${
        typeof payload === 'object' && payload !== null
          ? JSON.stringify(payload)
          : 'invalid payload'
      }`,
    );
  }
}

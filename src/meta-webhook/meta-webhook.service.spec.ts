import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MetaWebhookService } from './meta-webhook.service';

describe('MetaWebhookService', () => {
  let service: MetaWebhookService;

  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'verify-token';
    process.env.META_APP_SECRET = 'app-secret';
    service = new MetaWebhookService();
  });

  it('accepts a valid verification challenge', () => {
    expect(() =>
      service.verifyChallenge('subscribe', 'verify-token'),
    ).not.toThrow();
  });

  it('rejects an invalid verification challenge', () => {
    expect(() => service.verifyChallenge('subscribe', 'wrong-token')).toThrow(
      BadRequestException,
    );
  });

  it('accepts a signature generated from the raw body', () => {
    const rawBody = Buffer.from('{"entry":[]}');
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(rawBody)
      .digest('hex')}`;

    expect(() => service.verifySignature(rawBody, signature)).not.toThrow();
  });

  it('rejects an invalid signature', () => {
    expect(() =>
      service.verifySignature(Buffer.from('{"entry":[]}'), 'sha256=invalid'),
    ).toThrow(BadRequestException);
  });
});

import { MetaWebhookController } from './meta-webhook.controller';
import { MetaWebhookService } from './meta-webhook.service';

describe('MetaWebhookController', () => {
  const service = {
    verifyChallenge: jest.fn(),
    verifySignature: jest.fn(),
    handleEvent: jest.fn(),
  } as unknown as MetaWebhookService;
  let controller: MetaWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MetaWebhookController(service);
  });

  it('returns Meta challenge after verification', () => {
    expect(
      controller.verify('subscribe', 'verify-token', 'challenge-value'),
    ).toBe('challenge-value');
    expect(service.verifyChallenge).toHaveBeenCalledWith(
      'subscribe',
      'verify-token',
    );
  });

  it('verifies and acknowledges webhook events', () => {
    const request = {
      rawBody: Buffer.from('{}'),
      body: { object: 'page' },
    } as Parameters<MetaWebhookController['receive']>[0];

    expect(controller.receive(request, 'sha256=signature')).toEqual({
      received: true,
    });
    expect(service.verifySignature).toHaveBeenCalledWith(
      request.rawBody,
      'sha256=signature',
    );
    expect(service.handleEvent).toHaveBeenCalledWith(request.body);
  });
});

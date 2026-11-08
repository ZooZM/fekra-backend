import { ClientsService } from '@app/clients/clients.service';
import { GraphApiService, SendableRequest } from './graph-api.service';
import { MessageSenderService } from './message-sender.service';

describe('MessageSenderService', () => {
  let service: MessageSenderService;
  let graph: Record<string, jest.Mock>;
  let clients: { getAccessToken: jest.Mock };
  const request = {
    kind: 'batch',
    platform: 'facebook',
    id: 'dm-1',
    accountId: 'page-1',
    senderId: 'user-1',
    clientId: 'client-1',
    client: { id: 'client-1' },
  } as unknown as SendableRequest;

  beforeEach(() => {
    graph = {
      host: jest.fn().mockReturnValue('https://graph.test'),
      post: jest.fn(),
      deadLetter: jest.fn().mockResolvedValue(undefined),
    };
    clients = { getAccessToken: jest.fn().mockResolvedValue('token') };
    service = new MessageSenderService(
      graph as unknown as GraphApiService,
      clients as unknown as ClientsService,
    );
  });

  it('sends short messages with the expected request body', async () => {
    await service.reply(request, 'hello');
    expect(graph.post).toHaveBeenCalledWith(
      'https://graph.test/page-1/messages',
      {
        recipient: { id: 'user-1' },
        messaging_type: 'RESPONSE',
        message: { text: 'hello' },
      },
      'token',
    );
    expect(graph.deadLetter).not.toHaveBeenCalled();
  });

  it('splits messages at the platform limit', async () => {
    await service.reply(request, 'x'.repeat(2001));
    expect(graph.post).toHaveBeenCalledTimes(2);
    expect(graph.post.mock.calls[0][1].message.text).toHaveLength(2000);
    expect(graph.post.mock.calls[1][1].message.text).toHaveLength(1);
  });

  it.each([
    ['missing client', { ...request, client: undefined }],
    ['missing token', request],
    ['missing sender', { ...request, senderId: undefined }],
  ])('dead-letters %s without throwing', async (_label, input) => {
    if (_label === 'missing token')
      clients.getAccessToken.mockResolvedValue(null);
    await expect(
      service.reply(input as SendableRequest, 'hello'),
    ).resolves.toBeUndefined();
    expect(graph.deadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'message', text: 'hello' }),
    );
    expect(graph.post).not.toHaveBeenCalled();
  });
});

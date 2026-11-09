import { ClientsService } from '@app/clients/clients.service';
import { GraphApiService, SendableRequest } from './graph-api.service';
import { MessageSenderService } from './message-sender.service';
import { ConversationsService } from '@app/conversations/conversations.service';

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
    messages: [
      { mid: 'm1', text: 'customer message', timestamp: 1 },
      { mid: 'm2', text: 'follow-up', timestamp: 2 },
    ],
  } as unknown as SendableRequest;
  let conversations: {
    findOrCreate: jest.Mock;
    createMessage: jest.Mock;
  };

  beforeEach(() => {
    graph = {
      host: jest.fn().mockReturnValue('https://graph.test'),
      post: jest.fn(),
      deadLetter: jest.fn().mockResolvedValue(undefined),
    };
    clients = { getAccessToken: jest.fn().mockResolvedValue('token') };
    conversations = {
      findOrCreate: jest.fn().mockResolvedValue({ id: 'chat-1' }),
      createMessage: jest.fn().mockResolvedValue(undefined),
    };
    service = new MessageSenderService(
      graph as unknown as GraphApiService,
      clients as unknown as ClientsService,
      conversations as unknown as ConversationsService,
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
    expect(conversations.findOrCreate).toHaveBeenCalledWith({
      clientId: 'client-1',
      platform: 'facebook',
      senderId: 'user-1',
      receiverId: 'page-1',
    });
    expect(conversations.createMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      message: 'customer message\nfollow-up',
      reply: 'hello',
    });
  });

  it('splits messages at the platform limit', async () => {
    await service.reply(request, 'x'.repeat(2001));
    expect(graph.post).toHaveBeenCalledTimes(2);
    expect(graph.post.mock.calls[0][1].message.text).toHaveLength(2000);
    expect(graph.post.mock.calls[1][1].message.text).toHaveLength(1);
    expect(conversations.createMessage).toHaveBeenCalledTimes(1);
  });

  it('does not report a sent DM as failed when conversation persistence fails', async () => {
    conversations.findOrCreate.mockRejectedValue(new Error('database down'));

    await expect(service.reply(request, 'hello')).resolves.toBeUndefined();

    expect(graph.post).toHaveBeenCalled();
    expect(graph.deadLetter).not.toHaveBeenCalled();
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

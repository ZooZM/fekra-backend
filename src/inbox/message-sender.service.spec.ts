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
    createUnansweredMessage: jest.Mock;
    isPaused: jest.Mock;
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
      createUnansweredMessage: jest.fn().mockResolvedValue(undefined),
      isPaused: jest.fn().mockReturnValue(false),
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

  it('continues voice replies through the normal send and persistence flow', async () => {
    jest
      .spyOn(service, 'handleVoiceReply')
      .mockResolvedValue('handled voice reply');

    await service.reply(request, 'voice reply', 'voice');

    expect(service.handleVoiceReply).toHaveBeenCalledWith('voice reply');
    expect(graph.post).toHaveBeenCalledWith(
      'https://graph.test/page-1/messages',
      expect.objectContaining({
        message: { text: 'handled voice reply' },
      }),
      'token',
    );
    expect(conversations.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'handled voice reply' }),
    );
  });

  describe('a request that was pending before clientId travelled with it', () => {
    const legacy = {
      ...request,
      clientId: undefined,
    } as unknown as SendableRequest;

    it('uses the id of its client to record the exchange', async () => {
      await service.reply(legacy, 'hello');

      expect(conversations.findOrCreate).toHaveBeenCalledWith({
        clientId: 'client-1',
        platform: 'facebook',
        senderId: 'user-1',
        receiverId: 'page-1',
      });
      expect(conversations.createMessage).toHaveBeenCalledTimes(1);
    });

    it('still honours a pause, instead of failing open on the missing id', async () => {
      conversations.isPaused.mockReturnValue(true);

      await service.reply(legacy, 'hello');

      expect(graph.post).not.toHaveBeenCalled();
      expect(conversations.createUnansweredMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('when an administrator paused the conversation (checkpoint 4)', () => {
    beforeEach(() => conversations.isPaused.mockReturnValue(true));

    it('does not send the reply and stores the batch as unanswered', async () => {
      await service.reply(request, 'hello');

      expect(graph.post).not.toHaveBeenCalled();
      expect(graph.deadLetter).not.toHaveBeenCalled();
      expect(conversations.createMessage).not.toHaveBeenCalled();
      expect(conversations.createUnansweredMessage).toHaveBeenCalledWith({
        chatId: 'chat-1',
        message: 'customer message\nfollow-up',
      });
    });

    it('checks the pause on the chat it just read, so a timed pause that ended is not paused', async () => {
      conversations.isPaused.mockReturnValue(false);
      await service.reply(request, 'hello');
      expect(conversations.isPaused).toHaveBeenCalledWith({ id: 'chat-1' });
      expect(graph.post).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the unanswered batch cannot be stored', async () => {
      conversations.createUnansweredMessage.mockRejectedValue(
        new Error('database down'),
      );
      await expect(service.reply(request, 'hello')).resolves.toBeUndefined();
      expect(graph.post).not.toHaveBeenCalled();
    });
  });

  it('sends the reply anyway when the pause cannot be checked (fails open)', async () => {
    conversations.findOrCreate.mockRejectedValue(new Error('database down'));

    await service.reply(request, 'hello');

    expect(graph.post).toHaveBeenCalledTimes(1);
    expect(conversations.createUnansweredMessage).not.toHaveBeenCalled();
  });

  it('never logs the client data or the message text above debug', async () => {
    const log = jest
      .spyOn(
        (service as unknown as { logger: { log: () => void } }).logger,
        'log',
      )
      .mockImplementation();
    await service.reply(request, 'a private reply');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('private reply');
    expect(logged).not.toContain('customer message');
    expect(logged).not.toContain('"client"');
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

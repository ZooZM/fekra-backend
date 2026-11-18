import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ClientsService } from '@app/clients/clients.service';
import { PriorityInboxService } from './priority-inbox.service';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { AttachmentHandlerService } from './attachment-handler.service';
import {
  Classification,
  CommentClassifierService,
} from './comment-classifier.service';
import { CommentLlmClassifierService } from './comment-llm-classifier.service';
import { CommentReplyService } from './comment-reply.service';
import { COMMENT_QUEUE_KEY, COMMENT_RETRY_KEY } from './inbox.constants';
import { InboxItem } from './inbox.types';

type CommentItem = Extract<InboxItem, { kind: 'comment' }>;

const comment = (
  text: string,
  over: Partial<CommentItem> = {},
): CommentItem => ({
  kind: 'comment',
  platform: 'facebook',
  id: 'c-1',
  accountId: 'page-1',
  senderId: 'user-1',
  text,
  timestamp: 1_000,
  ...over,
});

const client = {
  id: 'client-1',
  name: 'Shop',
  businessCategory: 'Clothes',
  commentReplyConfig: { enabled: true, likes_enabled: true },
};

describe('PriorityInboxService (comments)', () => {
  let service: PriorityInboxService;
  let redis: { zadd: jest.Mock; eval: jest.Mock };
  let delivery: { send: jest.Mock };
  let llm: { classify: jest.Mock<Promise<Classification>, [string, unknown]> };
  let reply: { handle: jest.Mock };
  let comments: { save: jest.Mock };
  let conversations: {
    findOrCreate: jest.Mock;
    isPaused: jest.Mock;
    findLastMessagesByIdForWorkflow: jest.Mock;
    createUnansweredMessage: jest.Mock;
  };
  let clients: {
    findChatRoute: jest.Mock;
    findWorkflowDataFresh: jest.Mock;
    getClientDataForWorkFlow: jest.Mock;
  };
  let attachments: { handleImage: jest.Mock; handleVoiceRecord: jest.Mock };
  let dmBuffer: { add: jest.Mock };
  let env: Record<string, string>;

  const handle = (item: InboxItem) => service['handle'](item);
  const repliedWith = () =>
    reply.handle.mock.calls.map(([, type]) => type as string);

  beforeEach(() => {
    env = {};
    redis = {
      zadd: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(0),
    };
    delivery = { send: jest.fn() };
    llm = { classify: jest.fn<Promise<Classification>, [string, unknown]>() };
    reply = { handle: jest.fn().mockResolvedValue(undefined) };
    comments = { save: jest.fn().mockResolvedValue(undefined) };
    conversations = {
      findOrCreate: jest.fn().mockResolvedValue({ id: 'chat-1' }),
      isPaused: jest.fn().mockReturnValue(false),
      findLastMessagesByIdForWorkflow: jest.fn().mockResolvedValue([]),
      createUnansweredMessage: jest.fn().mockResolvedValue(undefined),
    };
    clients = {
      findChatRoute: jest.fn().mockResolvedValue({
        clientId: client.id,
        name: client.name,
        chatSubscribed: true,
        chatWorkflowEndpoint: 'chat-shop',
      }),
      findWorkflowDataFresh: jest
        .fn()
        .mockResolvedValue({ ...client, chatSubscribed: true }),
      getClientDataForWorkFlow: jest.fn().mockResolvedValue(client),
    };
    attachments = {
      handleImage: jest.fn().mockResolvedValue('an image text'),
      handleVoiceRecord: jest.fn().mockResolvedValue('a voice text'),
    };
    dmBuffer = { add: jest.fn().mockResolvedValue(undefined) };

    service = new PriorityInboxService(
      redis as unknown as Redis,
      dmBuffer as unknown as DmBufferService,
      delivery as unknown as N8nDeliveryService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
      clients as unknown as ClientsService,
      attachments as unknown as AttachmentHandlerService,
      new CommentClassifierService(),
      llm as unknown as CommentLlmClassifierService,
      reply as unknown as CommentReplyService,
      comments as never,
      conversations as never,
    );
  });

  it('acts on the keyword rules without calling the LLM', async () => {
    await handle(comment('بكام'));

    expect(llm.classify).not.toHaveBeenCalled();
    expect(repliedWith()).toEqual(['inquiry']);
    expect(comments.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: client.id,
        commentId: 'c-1',
        comment: 'بكام',
        classification: 'inquiry',
      }),
    );
  });

  it('still handles a comment if saving its classification fails', async () => {
    comments.save.mockRejectedValue(new Error('database unavailable'));

    await handle(comment('بكام'));

    expect(reply.handle).toHaveBeenCalled();
  });

  it('asks the LLM when the rules are unsure, and acts on its answer', async () => {
    llm.classify.mockResolvedValue({ type: 'complaint', reason: 'llm' });
    await handle(comment('random words here'));

    expect(llm.classify).toHaveBeenCalledWith('random words here', client);
    expect(repliedWith()).toEqual(['complaint']);
    expect(comments.save).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'complaint',
        reason: 'llm',
      }),
    );
  });

  it('creates a conversation as soon as a customer message is processed', async () => {
    await handle({
      kind: 'message',
      platform: 'instagram',
      id: 'message-1',
      accountId: 'account-1',
      senderId: 'sender-1',
      text: 'Hello',
      timestamp: 1_000,
    });

    expect(clients.findChatRoute).toHaveBeenCalledWith('account-1');
    expect(conversations.findOrCreate).toHaveBeenCalledWith({
      clientId: client.id,
      platform: 'instagram',
      senderId: 'sender-1',
      receiverId: 'account-1',
    });
    expect(dmBuffer.add).toHaveBeenCalled();
  });

  it('never sends comments to n8n', async () => {
    llm.classify.mockResolvedValue({
      type: 'unsure',
      reason: 'llm failed: request error',
      retryable: true,
    });
    await handle(comment('random words here', { llmAttempts: 5 }));
    await handle(comment('بكام'));

    expect(delivery.send).not.toHaveBeenCalled();
  });

  describe('when the LLM call fails', () => {
    const failure: Classification = {
      type: 'unsure',
      reason: 'llm failed: request error',
      retryable: true,
    };

    beforeEach(() => llm.classify.mockResolvedValue(failure));

    it('parks the comment for a retry in 5 minutes instead of acting', async () => {
      const before = Date.now();
      await handle(comment('random words here'));

      expect(reply.handle).not.toHaveBeenCalled();
      expect(comments.save).not.toHaveBeenCalled();
      const [key, score, member] = redis.zadd.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(key).toBe(COMMENT_RETRY_KEY);
      expect(score).toBeGreaterThanOrEqual(before + 300_000);
      expect(JSON.parse(member)).toMatchObject({ id: 'c-1', llmAttempts: 1 });
    });

    it('waits longer before each next attempt', async () => {
      const before = Date.now();
      await handle(comment('random words here', { llmAttempts: 1 }));

      const [, score, member] = redis.zadd.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(score).toBeGreaterThanOrEqual(before + 600_000);
      expect(JSON.parse(member)).toMatchObject({ llmAttempts: 2 });
    });

    it('falls back to spam (like only) after the last attempt', async () => {
      await handle(comment('random words here', { llmAttempts: 2 }));

      expect(redis.zadd).not.toHaveBeenCalled();
      expect(repliedWith()).toEqual(['spam']);
      expect(comments.save).toHaveBeenCalledWith(
        expect.objectContaining({ classification: 'spam' }),
      );
    });

    it('respects COMMENT_LLM_MAX_ATTEMPTS and COMMENT_LLM_RETRY_DELAY_MS', async () => {
      env.COMMENT_LLM_MAX_ATTEMPTS = '1';
      await handle(comment('random words here'));
      expect(repliedWith()).toEqual(['spam']);

      env.COMMENT_LLM_MAX_ATTEMPTS = '5';
      env.COMMENT_LLM_RETRY_DELAY_MS = '1000';
      const before = Date.now();
      await handle(comment('random words here', { id: 'c-2' }));
      const [, score] = redis.zadd.mock.calls[0] as [string, number];
      expect(score).toBeLessThan(before + 5_000);
    });

    it('falls back to spam right away when retrying cannot help (no API key)', async () => {
      llm.classify.mockResolvedValue({
        type: 'unsure',
        reason: 'llm disabled: no key',
      });
      await handle(comment('random words here'));

      expect(redis.zadd).not.toHaveBeenCalled();
      expect(repliedWith()).toEqual(['spam']);
    });
  });

  it('moves due retries back to the comment queue in one atomic script', async () => {
    const before = Date.now();
    await service['promoteDueRetries']();

    const [script, numKeys, from, to, now] = redis.eval.mock.calls[0] as [
      string,
      number,
      string,
      string,
      number,
    ];
    expect(script).toContain('ZRANGEBYSCORE');
    expect([numKeys, from, to]).toEqual([
      2,
      COMMENT_RETRY_KEY,
      COMMENT_QUEUE_KEY,
    ]);
    expect(now).toBeGreaterThanOrEqual(before);
  });
});

type MessageItem = Extract<InboxItem, { kind: 'message' }>;
type BatchItem = Extract<InboxItem, { kind: 'batch' }>;

const dm = (over: Partial<MessageItem> = {}): MessageItem => ({
  kind: 'message',
  platform: 'facebook',
  id: 'm-1',
  accountId: 'page-1',
  senderId: 'customer-1',
  text: 'a SECRET customer message',
  timestamp: 1_000,
  ...over,
});

const batch = (over: Partial<BatchItem> = {}): BatchItem => ({
  kind: 'batch',
  platform: 'facebook',
  id: 'dm-1',
  accountId: 'page-1',
  senderId: 'customer-1',
  timestamp: 1_000,
  messages: [
    { mid: 'a', text: 'first SECRET', timestamp: 1 },
    { mid: 'b', text: 'second', timestamp: 2 },
  ],
  ...over,
});

describe('PriorityInboxService (chat service: subscription and pause)', () => {
  let service: PriorityInboxService;
  let delivery: { send: jest.Mock };
  let comments: { save: jest.Mock };
  let conversations: {
    findOrCreate: jest.Mock;
    isPaused: jest.Mock;
    findLastMessagesByIdForWorkflow: jest.Mock;
    createUnansweredMessage: jest.Mock;
  };
  let clients: {
    findChatRoute: jest.Mock;
    findWorkflowDataFresh: jest.Mock;
  };
  let attachments: { handleImage: jest.Mock; handleVoiceRecord: jest.Mock };
  let dmBuffer: { add: jest.Mock };
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const subscribedRoute = {
    clientId: 'client-1',
    name: 'Shop',
    chatSubscribed: true,
    chatWorkflowEndpoint: 'chat-shop',
  };
  const handle = (item: InboxItem) => service['handle'](item);
  const logged = () =>
    JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    delivery = { send: jest.fn().mockResolvedValue(undefined) };
    comments = { save: jest.fn().mockResolvedValue(undefined) };
    conversations = {
      findOrCreate: jest.fn().mockResolvedValue({ id: 'chat-1' }),
      isPaused: jest.fn().mockReturnValue(false),
      findLastMessagesByIdForWorkflow: jest.fn().mockResolvedValue([]),
      createUnansweredMessage: jest.fn().mockResolvedValue(undefined),
    };
    clients = {
      findChatRoute: jest.fn().mockResolvedValue(subscribedRoute),
      findWorkflowDataFresh: jest.fn().mockResolvedValue({
        id: 'client-1',
        name: 'Shop',
        chatSubscribed: true,
        services: [{ name: 'Cut', price: '120' }],
      }),
    };
    attachments = {
      handleImage: jest.fn().mockResolvedValue('an image text'),
      handleVoiceRecord: jest.fn().mockResolvedValue('a voice text'),
    };
    dmBuffer = { add: jest.fn().mockResolvedValue(undefined) };
    service = new PriorityInboxService(
      {} as unknown as Redis,
      dmBuffer as unknown as DmBufferService,
      delivery as unknown as N8nDeliveryService,
      { get: () => undefined } as unknown as ConfigService,
      clients as unknown as ClientsService,
      attachments as unknown as AttachmentHandlerService,
      new CommentClassifierService(),
      {} as unknown as CommentLlmClassifierService,
      {} as unknown as CommentReplyService,
      comments as never,
      conversations as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  describe('a DM (checkpoint 1)', () => {
    it('is stored and buffered for a subscribed client', async () => {
      await handle(dm());

      expect(conversations.findOrCreate).toHaveBeenCalledWith({
        clientId: 'client-1',
        platform: 'facebook',
        senderId: 'customer-1',
        receiverId: 'page-1',
      });
      expect(dmBuffer.add).toHaveBeenCalledTimes(1);
      expect(conversations.createUnansweredMessage).not.toHaveBeenCalled();
    });

    it.each([
      ['not subscribed', { ...subscribedRoute, chatSubscribed: false }],
      ['an unknown account', null],
    ])(
      'is ignored for %s: nothing stored, buffered or sent to Gemini',
      async (_label, route) => {
        clients.findChatRoute.mockResolvedValue(route);

        await handle(
          dm({ attachments: [{ type: 'image', url: 'https://x/y.jpg' }] }),
        );

        expect(conversations.findOrCreate).not.toHaveBeenCalled();
        expect(conversations.createUnansweredMessage).not.toHaveBeenCalled();
        expect(dmBuffer.add).not.toHaveBeenCalled();
        expect(attachments.handleImage).not.toHaveBeenCalled();
      },
    );

    it('logs the drop with ids only, never the message text', async () => {
      clients.findChatRoute.mockResolvedValue({
        ...subscribedRoute,
        chatSubscribed: false,
      });

      await handle(dm());

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropped DM m-1 for account page-1'),
      );
      expect(logged()).not.toContain('SECRET');
    });

    it('reads the route fresh on every message, so a subscribe applies at once', async () => {
      clients.findChatRoute
        .mockResolvedValueOnce({ ...subscribedRoute, chatSubscribed: false })
        .mockResolvedValueOnce(subscribedRoute);

      await handle(dm({ id: 'm-1' }));
      await handle(dm({ id: 'm-2' }));

      expect(clients.findChatRoute).toHaveBeenCalledTimes(2);
      expect(dmBuffer.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('a DM in a paused conversation', () => {
    beforeEach(() => conversations.isPaused.mockReturnValue(true));

    it('is stored as not answered and is not buffered', async () => {
      await handle(dm());

      expect(conversations.createUnansweredMessage).toHaveBeenCalledWith({
        chatId: 'chat-1',
        message: 'a SECRET customer message',
      });
      expect(dmBuffer.add).not.toHaveBeenCalled();
    });

    it('stores a placeholder for each attachment and spends no Gemini call on them', async () => {
      await handle(
        dm({
          text: undefined,
          attachments: [
            { type: 'image', url: 'https://x/y.jpg' },
            { type: 'audio', url: 'https://x/y.mp4' },
          ],
        }),
      );

      expect(
        conversations.createUnansweredMessage.mock.calls.map(
          ([arg]) => (arg as { message: string }).message,
        ),
      ).toEqual(['[image]', '[voice message]']);
      expect(attachments.handleImage).not.toHaveBeenCalled();
      expect(attachments.handleVoiceRecord).not.toHaveBeenCalled();
    });

    it('stores the text and the placeholders as separate exchanges', async () => {
      await handle(
        dm({ attachments: [{ type: 'image', url: 'https://x/y.jpg' }] }),
      );
      expect(conversations.createUnansweredMessage).toHaveBeenCalledTimes(2);
    });

    it('logs and carries on when an unanswered message cannot be stored (FR-025)', async () => {
      conversations.createUnansweredMessage.mockRejectedValue(
        new Error('database down'),
      );
      await expect(handle(dm())).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
      expect(logged()).not.toContain('SECRET');
    });
  });

  it('answers as if the chat were not paused when the chat cannot be read (fails open)', async () => {
    conversations.findOrCreate.mockRejectedValue(new Error('database down'));

    await handle(dm());

    expect(error).toHaveBeenCalled();
    expect(conversations.createUnansweredMessage).not.toHaveBeenCalled();
    expect(dmBuffer.add).toHaveBeenCalledTimes(1);
  });

  describe('a DM batch (checkpoint 2)', () => {
    it('is delivered with the fresh client data for a subscribed, active conversation', async () => {
      conversations.findLastMessagesByIdForWorkflow.mockResolvedValue([
        { message: 'prior message', reply: 'prior reply' },
      ]);

      await handle(batch());

      expect(
        conversations.findLastMessagesByIdForWorkflow,
      ).toHaveBeenCalledWith('customer-1', 'page-1', 'facebook');
      expect(clients.findWorkflowDataFresh).toHaveBeenCalledWith('page-1');
      expect(delivery.send).toHaveBeenCalledWith(
        'dm-1',
        expect.objectContaining({
          id: 'dm-1',
          // the reply is recorded and the pause is re-checked with this id when n8n answers
          clientId: 'client-1',
          client: expect.objectContaining({
            services: [{ name: 'Cut', price: '120' }],
          }),
          // the history goes to n8n as the stored exchanges, oldest first, not as one string
          latestMessages: [{ message: 'prior message', reply: 'prior reply' }],
        }),
      );
    });

    it('sends an empty history for a conversation with no earlier exchanges', async () => {
      conversations.findLastMessagesByIdForWorkflow.mockResolvedValue([]);

      await handle(batch());

      expect(delivery.send).toHaveBeenCalledWith(
        'dm-1',
        expect.objectContaining({ latestMessages: [] }),
      );
    });

    it('is dropped when the client was unsubscribed while it waited', async () => {
      clients.findWorkflowDataFresh.mockResolvedValue({
        id: 'client-1',
        chatSubscribed: false,
      });

      await handle(batch());

      expect(delivery.send).not.toHaveBeenCalled();
      expect(conversations.createUnansweredMessage).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropped batch dm-1'),
      );
      expect(logged()).not.toContain('SECRET');
    });

    it('is dropped for an unknown account', async () => {
      clients.findWorkflowDataFresh.mockResolvedValue(null);
      await handle(batch());
      expect(delivery.send).not.toHaveBeenCalled();
    });

    it('is stored as one unanswered exchange, and not delivered, when the conversation was paused', async () => {
      conversations.isPaused.mockReturnValue(true);

      await handle(batch());

      expect(delivery.send).not.toHaveBeenCalled();
      expect(conversations.createUnansweredMessage).toHaveBeenCalledWith({
        chatId: 'chat-1',
        message: 'first SECRET\nsecond',
      });
    });

    it('is delivered when the pause cannot be checked (fails open)', async () => {
      conversations.findOrCreate.mockRejectedValue(new Error('database down'));

      await handle(batch());

      expect(delivery.send).toHaveBeenCalledTimes(1);
      expect(logged()).not.toContain('SECRET');
    });

    it('still ends without throwing when the paused batch cannot be stored', async () => {
      conversations.isPaused.mockReturnValue(true);
      conversations.createUnansweredMessage.mockRejectedValue(
        new Error('database down'),
      );
      await expect(handle(batch())).resolves.toBeUndefined();
      expect(delivery.send).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });
  });
});

describe('PriorityInboxService (how a comment was decided)', () => {
  let service: PriorityInboxService;
  let llm: { classify: jest.Mock };
  let comments: { save: jest.Mock };
  let reply: { handle: jest.Mock };
  const savedWith = () =>
    comments.save.mock.calls[0][0] as {
      classification: string;
      reason: string;
      decisionBasis: string;
      decisionModel: string | null;
    };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    llm = { classify: jest.fn() };
    comments = { save: jest.fn().mockResolvedValue(undefined) };
    reply = { handle: jest.fn().mockResolvedValue(undefined) };
    service = new PriorityInboxService(
      { zadd: jest.fn().mockResolvedValue(1) } as unknown as Redis,
      {} as unknown as DmBufferService,
      {} as unknown as N8nDeliveryService,
      { get: () => undefined } as unknown as ConfigService,
      {
        getClientDataForWorkFlow: jest.fn().mockResolvedValue(client),
      } as unknown as ClientsService,
      {} as unknown as AttachmentHandlerService,
      new CommentClassifierService(),
      llm as unknown as CommentLlmClassifierService,
      reply as unknown as CommentReplyService,
      comments as never,
      {} as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const handle = (item: InboxItem) => service['handle'](item);

  it('records RULES, with no model, when the keyword rules decide', async () => {
    await handle(comment('بكام'));
    expect(savedWith()).toMatchObject({
      classification: 'inquiry',
      decisionBasis: 'RULES',
      decisionModel: null,
    });
    expect(llm.classify).not.toHaveBeenCalled();
  });

  it('records AI_MODEL and the model that answered when the LLM labels the comment', async () => {
    llm.classify.mockResolvedValue({
      type: 'complaint',
      reason: 'llm gemini-3.8-flash',
      model: 'gemini-3.8-flash',
    });

    await handle(comment('random words here'));

    expect(savedWith()).toMatchObject({
      classification: 'complaint',
      decisionBasis: 'AI_MODEL',
      decisionModel: 'gemini-3.8-flash',
    });
  });

  it('records RULES when an answer came without a model (an empty comment never reached a model)', async () => {
    llm.classify.mockResolvedValue({
      type: 'engagement',
      reason: 'llm skipped: empty',
    });

    await handle(comment('random words here'));

    expect(savedWith()).toMatchObject({
      decisionBasis: 'RULES',
      decisionModel: null,
    });
  });

  it('records SAFE_FALLBACK, with no model, when the LLM failed and spam is the safe default', async () => {
    llm.classify.mockResolvedValue({
      type: 'unsure',
      reason: 'llm failed: invalid output',
    });

    await handle(comment('random words here'));

    expect(savedWith()).toMatchObject({
      classification: 'spam',
      decisionBasis: 'SAFE_FALLBACK',
      decisionModel: null,
    });
    expect(savedWith().reason).toMatch(/, fallback to spam$/);
  });

  it('keeps a real spam verdict apart from the fallback', async () => {
    await handle(comment('http://spam.example.com'));
    expect(savedWith()).toMatchObject({
      classification: 'spam',
      decisionBasis: 'RULES',
    });
  });

  it('still answers the comment when its classification cannot be stored (SC-010)', async () => {
    comments.save.mockRejectedValue(new Error('database down'));
    await handle(comment('بكام'));
    expect(reply.handle).toHaveBeenCalledTimes(1);
  });
});

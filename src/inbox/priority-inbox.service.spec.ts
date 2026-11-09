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
  let conversations: { findOrCreate: jest.Mock };
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
    };
    dmBuffer = { add: jest.fn().mockResolvedValue(undefined) };

    service = new PriorityInboxService(
      redis as unknown as Redis,
      dmBuffer as unknown as DmBufferService,
      delivery as unknown as N8nDeliveryService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
      {
        findByAccountId: jest.fn().mockResolvedValue(client),
        getClientDataForWorkFlow: jest.fn().mockResolvedValue(client),
      } as unknown as ClientsService,
      {} as AttachmentHandlerService,
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

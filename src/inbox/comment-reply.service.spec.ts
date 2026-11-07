import { ClientsService } from '@app/clients/clients.service';
import {
  CommentReplyConfig,
  DmReplyConfig,
} from '@common/zod/json-columns.schema';
import { CommentReplyService } from './comment-reply.service';
import { GraphApiService, SendableRequest } from './graph-api.service';

const HOST = 'https://graph.test';

const commentConfig = (
  over: Partial<CommentReplyConfig> = {},
): CommentReplyConfig => ({
  enabled: true,
  likes_enabled: true,
  inquiry_can_dm: ['check your inbox'],
  inquiry_can_not_dm: ['please message us'],
  engagement: ['thanks!'],
  ...over,
});

const dmConfig = (over: Partial<DmReplyConfig> = {}): DmReplyConfig => ({
  enabled: true,
  likes_enabled: false,
  replies: ['hi, here are the details'],
  ...over,
});

const makeRequest = (
  over: {
    platform?: 'facebook' | 'instagram';
    comment?: Partial<CommentReplyConfig>;
    dm?: Partial<DmReplyConfig>;
  } = {},
): SendableRequest =>
  ({
    kind: 'comment',
    platform: over.platform ?? 'facebook',
    id: 'c-1',
    accountId: 'page-1',
    senderId: 'user-1',
    clientId: 'client-1',
    client: {
      id: 'client-1',
      commentReplyConfig: commentConfig(over.comment),
      dmReplyConfig: dmConfig(over.dm),
    },
  }) as unknown as SendableRequest;

describe('CommentReplyService', () => {
  let service: CommentReplyService;
  let graph: {
    host: jest.Mock;
    post: jest.Mock<Promise<void>, [string, unknown, string]>;
    deadLetter: jest.Mock;
  };
  let clients: { getAccessToken: jest.Mock };

  /** [url, body] of every POST, in order. */
  const posts = () =>
    graph.post.mock.calls.map(([url, body]) => [url, body] as const);
  const postedTo = (suffix: string) =>
    graph.post.mock.calls.filter(([url]) => url.endsWith(suffix));

  beforeEach(() => {
    graph = {
      // a different Instagram host proves IG comments go through graph.facebook.com
      host: jest.fn((platform: string) =>
        platform === 'facebook' ? HOST : 'https://graph.instagram.test',
      ),
      post: jest
        .fn<Promise<void>, [string, unknown, string]>()
        .mockResolvedValue(undefined),
      deadLetter: jest.fn().mockResolvedValue(undefined),
    };
    clients = { getAccessToken: jest.fn().mockResolvedValue('token') };
    service = new CommentReplyService(
      graph as unknown as GraphApiService,
      clients as unknown as ClientsService,
    );
  });

  // ─────────────────────────── inquiry ───────────────────────────

  describe('inquiry', () => {
    it('sends a private DM, then the "DM sent" reply, then likes', async () => {
      await service.handle(makeRequest(), 'inquiry');

      expect(posts()).toEqual([
        [
          `${HOST}/page-1/messages`,
          {
            recipient: { comment_id: 'c-1' },
            message: { text: 'hi, here are the details' },
          },
        ],
        [`${HOST}/c-1/comments`, { message: 'check your inbox' }],
        [`${HOST}/c-1/likes`, {}],
      ]);
      expect(graph.deadLetter).not.toHaveBeenCalled();
    });

    it('uses the "DMs closed" reply when the DM fails', async () => {
      graph.post.mockRejectedValueOnce(new Error('closed'));
      await service.handle(makeRequest(), 'inquiry');

      expect(postedTo('/comments')).toEqual([
        [`${HOST}/c-1/comments`, { message: 'please message us' }, 'token'],
      ]);
      expect(postedTo('/likes')).toHaveLength(1);
      expect(graph.deadLetter).not.toHaveBeenCalled();
    });

    it('skips the DM when DM replies are disabled', async () => {
      await service.handle(makeRequest({ dm: { enabled: false } }), 'inquiry');

      expect(postedTo('/messages')).toHaveLength(0);
      expect(postedTo('/comments')[0][1]).toEqual({
        message: 'please message us',
      });
    });

    it('skips the DM when the client has no DM texts', async () => {
      await service.handle(makeRequest({ dm: { replies: [] } }), 'inquiry');

      expect(postedTo('/messages')).toHaveLength(0);
      expect(postedTo('/comments')[0][1]).toEqual({
        message: 'please message us',
      });
    });

    it('falls back to the default replies when the client lists are empty', async () => {
      await service.handle(
        makeRequest({ comment: { inquiry_can_dm: [] } }),
        'inquiry',
      );
      const { message } = postedTo('/comments')[0][1] as { message: string };
      expect(message).toMatch(/خاص|رسالة|الانبوكس/);
    });
  });

  // ─────────────────────────── Instagram ───────────────────────────

  describe('Instagram', () => {
    const ig = () => makeRequest({ platform: 'instagram' });

    it('inquiry: DM via /me/messages, then reply via /replies, no like', async () => {
      await service.handle(ig(), 'inquiry');

      expect(posts()).toEqual([
        [
          `${HOST}/me/messages`,
          {
            recipient: { comment_id: 'c-1' },
            message: { text: 'hi, here are the details' },
          },
        ],
        [`${HOST}/c-1/replies`, { message: 'check your inbox' }],
      ]);
    });

    it('inquiry: "DMs closed" reply also goes to /replies', async () => {
      graph.post.mockRejectedValueOnce(new Error('closed'));
      await service.handle(ig(), 'inquiry');

      expect(postedTo('/replies')[0][1]).toEqual({
        message: 'please message us',
      });
      expect(postedTo('/comments')).toHaveLength(0);
    });

    it('engagement: reply via /replies, no like', async () => {
      await service.handle(ig(), 'engagement');
      expect(posts()).toEqual([
        [`${HOST}/c-1/replies`, { message: 'thanks!' }],
      ]);
    });

    it('spam: does nothing', async () => {
      await service.handle(ig(), 'spam');
      expect(graph.post).not.toHaveBeenCalled();
    });

    it.each(['complaint', 'insult'] as const)(
      '%s: hides the comment with hide=true',
      async (category) => {
        await service.handle(ig(), category);
        expect(posts()).toEqual([[`${HOST}/c-1`, { hide: true }]]);
      },
    );
  });

  // ─────────────────────────── engagement ───────────────────────────

  describe('engagement', () => {
    it('posts a thank-you reply, then likes', async () => {
      await service.handle(makeRequest(), 'engagement');

      expect(posts()).toEqual([
        [`${HOST}/c-1/comments`, { message: 'thanks!' }],
        [`${HOST}/c-1/likes`, {}],
      ]);
    });

    it('picks randomly from the client list', async () => {
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
      await service.handle(
        makeRequest({ comment: { engagement: ['a', 'b', 'c'] } }),
        'engagement',
      );
      expect(postedTo('/comments')[0][1]).toEqual({ message: 'c' });
      spy.mockRestore();
    });

    it('falls back to the default replies when the list is empty', async () => {
      await service.handle(
        makeRequest({ comment: { engagement: [] } }),
        'engagement',
      );
      expect(postedTo('/comments')).toHaveLength(1);
    });

    it('still likes when the reply fails, and dead-letters the failure', async () => {
      graph.post.mockRejectedValueOnce(new Error('reply failed'));
      await expect(
        service.handle(makeRequest(), 'engagement'),
      ).resolves.toBeUndefined();

      expect(postedTo('/likes')).toHaveLength(1);
      expect(graph.deadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'comment',
          input: { category: 'engagement' },
          error: 'reply failed',
        }),
      );
    });
  });

  // ─────────────────────────── spam ───────────────────────────

  describe('spam', () => {
    it('only likes the comment', async () => {
      await service.handle(makeRequest(), 'spam');

      expect(posts()).toEqual([[`${HOST}/c-1/likes`, {}]]);
    });
  });

  // ─────────────────────────── complaint / insult ───────────────────────────

  describe.each(['complaint', 'insult'] as const)('%s', (category) => {
    it('hides the comment without replying or liking', async () => {
      await service.handle(makeRequest(), category);

      expect(graph.post.mock.calls).toEqual([
        [`${HOST}/c-1`, { is_hidden: true }, 'token'],
      ]);
    });

    it('dead-letters a failed hide without throwing', async () => {
      graph.post.mockRejectedValueOnce(new Error('no permission'));
      await expect(
        service.handle(makeRequest(), category),
      ).resolves.toBeUndefined();
      expect(graph.deadLetter).toHaveBeenCalledWith(
        expect.objectContaining({ input: { category } }),
      );
    });
  });

  // ─────────────────────────── client settings ───────────────────────────

  describe('client settings', () => {
    it('does not reply, DM or hide when comment replies are disabled', async () => {
      const req = makeRequest({ comment: { enabled: false } });
      for (const category of [
        'inquiry',
        'engagement',
        'spam',
        'complaint',
        'insult',
      ] as const) {
        await service.handle(req, category);
      }

      // only likes remain, they are a separate setting: inquiry, engagement and spam
      expect(graph.post.mock.calls.map(([url]) => url)).toEqual([
        `${HOST}/c-1/likes`,
        `${HOST}/c-1/likes`,
        `${HOST}/c-1/likes`,
      ]);
    });

    it('does not like when likes are disabled', async () => {
      const req = makeRequest({ comment: { likes_enabled: false } });
      await service.handle(req, 'engagement');
      await service.handle(req, 'spam');

      expect(postedTo('/likes')).toHaveLength(0);
      expect(postedTo('/comments')).toHaveLength(1);
    });

    it.each([
      ['missing client', { ...makeRequest(), client: undefined }],
      ['missing token', makeRequest()],
    ])('dead-letters %s without throwing', async (label, req) => {
      if (label === 'missing token')
        clients.getAccessToken.mockResolvedValue(null);
      await expect(service.handle(req, 'engagement')).resolves.toBeUndefined();
      expect(graph.post).not.toHaveBeenCalled();
      expect(graph.deadLetter).toHaveBeenCalled();
    });
  });

  // ─────────────────────────── n8n callback ───────────────────────────

  describe('handleN8nReply', () => {
    it('applies the n8n question replies', async () => {
      await service.handleN8nReply(makeRequest(), {
        type: 'question',
        dmText: 'dm from n8n',
        publicReplyIfDmSent: 'sent',
        publicReplyIfDmClosed: 'closed',
      });

      expect(posts()).toEqual([
        [
          `${HOST}/page-1/messages`,
          {
            recipient: { comment_id: 'c-1' },
            message: { text: 'dm from n8n' },
          },
        ],
        [`${HOST}/c-1/comments`, { message: 'sent' }],
        [`${HOST}/c-1/likes`, {}],
      ]);
    });

    it('applies the n8n engagement reply', async () => {
      await service.handleN8nReply(makeRequest(), {
        type: 'engagement',
        publicReply: 'from n8n',
      });
      expect(postedTo('/comments')[0][1]).toEqual({ message: 'from n8n' });
    });
  });
});

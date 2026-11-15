import { Logger } from '@nestjs/common';
import { DEAD_LIST, PENDING_HASH, REQ_TTL } from './inbox.constants';
import { N8nDeliveryService } from './n8n-delivery.service';

type Reply = [Error | null, unknown];

/** A tiny fake of ioredis' multi(): records the commands and answers each from `answers`. */
function fakeRedis() {
  const hash = new Map<string, string>();
  const dead: string[] = [];
  const multiCalls: string[][] = [];

  const redis = {
    hash,
    dead,
    multiCalls,
    lpush: jest.fn((_key: string, value: string) => {
      dead.push(value);
      return Promise.resolve(dead.length);
    }),
    multi: jest.fn(() => {
      const ops: (() => unknown)[] = [];
      const names: string[] = [];
      const chain: Record<string, any> = {
        hset: (_k: string, field: string, value: string) => {
          names.push('hset');
          ops.push(() => {
            hash.set(field, value);
            return 1;
          });
          return chain;
        },
        hget: (_k: string, field: string) => {
          names.push('hget');
          ops.push(() => hash.get(field) ?? null);
          return chain;
        },
        hdel: (_k: string, field: string) => {
          names.push('hdel');
          ops.push(() => (hash.delete(field) ? 1 : 0));
          return chain;
        },
        set: () => {
          names.push('set');
          ops.push(() => 'OK');
          return chain;
        },
        del: () => {
          names.push('del');
          ops.push(() => 1);
          return chain;
        },
        exec: () => {
          multiCalls.push(names);
          return Promise.resolve(ops.map((op): Reply => [null, op()]));
        },
      };
      return chain;
    }),
  };
  return redis;
}

const payload = (clientId = 'c1') => ({
  kind: 'batch',
  id: 'b1',
  accountId: 'page-1',
  client: { id: clientId },
});

describe('N8nDeliveryService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let clients: { findChatRouteById: jest.Mock };
  let config: Record<string, string | number | undefined>;
  let fetchMock: jest.SpyInstance;

  const build = () =>
    new N8nDeliveryService(
      redis as never,
      { get: (name: string) => config[name] } as never,
      clients as never,
    );

  /** `send` starts `post` without awaiting it, so let the microtasks finish. */
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    redis = fakeRedis();
    clients = {
      findChatRouteById: jest.fn().mockResolvedValue({
        clientId: 'c1',
        chatSubscribed: true,
        chatWorkflowEndpoint: 'chat-acme',
      }),
    };
    config = {
      N8N_BASE_URL: 'http://n8n.test/webhook/',
      N8N_WEBHOOK_SECRET: 'shh',
      N8N_MAX_ATTEMPTS: 3,
      N8N_ACK_TTL_SEC: 90,
    };
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => jest.restoreAllMocks());

  describe('construction', () => {
    it('rejects a malformed base address at boot', () => {
      config.N8N_BASE_URL = 'ftp://n8n.test/';
      expect(build).toThrow(/http or https/);
      config.N8N_BASE_URL = 'nonsense';
      expect(build).toThrow(/valid URL/);
    });

    it('requires the base address in production', () => {
      config.N8N_BASE_URL = undefined;
      config.NODE_ENV = 'production';
      expect(build).toThrow(/required in production/);
    });

    it('only warns about a missing base address outside production', () => {
      config.N8N_BASE_URL = undefined;
      config.NODE_ENV = 'development';
      expect(build).not.toThrow();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('registers the request before posting it, then posts to base + endpoint', async () => {
      const service = build();

      await service.send('r1', payload());
      await flush();

      expect(redis.hash.has('r1')).toBe(true);
      expect(clients.findChatRouteById).toHaveBeenCalledWith('c1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://n8n.test/webhook/chat-acme');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['x-webhook-secret']).toBe(
        'shh',
      );
      expect(JSON.parse(init.body as string)).toMatchObject({
        requestId: 'r1',
        attempt: 1,
        kind: 'batch',
        client: { id: 'c1' },
      });
    });

    it('logs a non-2xx answer and leaves the request pending for the TTL resend', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
      const service = build();

      await service.send('r1', payload());
      await flush();

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('n8n responded 500'),
      );
      expect(redis.hash.has('r1')).toBe(true);
      expect(redis.dead).toHaveLength(0);
    });

    it('keeps the request pending when the route cannot be read (database error)', async () => {
      clients.findChatRouteById.mockRejectedValue(new Error('db down'));
      const service = build();

      await service.send('r1', payload());
      await flush();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(redis.hash.has('r1')).toBe(true);
      expect(redis.dead).toHaveLength(0);
    });
  });

  describe('terminal cases go to the dead list with a reason', () => {
    const deadReason = () =>
      (JSON.parse(redis.dead[0]) as { reason: string }).reason;

    it('not subscribed: nothing is sent and the request leaves the pending set', async () => {
      clients.findChatRouteById.mockResolvedValue({
        clientId: 'c1',
        chatSubscribed: false,
        chatWorkflowEndpoint: 'chat-acme',
      });
      const service = build();

      await service.send('r1', payload());
      await flush();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(redis.hash.has('r1')).toBe(false);
      expect(deadReason()).toBe('UNSUBSCRIBED');
      expect(JSON.parse(redis.dead[0])).toMatchObject({
        id: 'r1',
        attempts: 1,
        payload: { kind: 'batch' },
      });
    });

    it('unknown client: treated as not subscribed', async () => {
      clients.findChatRouteById.mockResolvedValue(null);
      await build().send('r1', payload());
      await flush();
      expect(deadReason()).toBe('UNSUBSCRIBED');
    });

    it('a payload without a client is treated as not subscribed', async () => {
      await build().send('r1', { kind: 'batch' });
      await flush();
      expect(clients.findChatRouteById).not.toHaveBeenCalled();
      expect(deadReason()).toBe('UNSUBSCRIBED');
    });

    it('subscribed but no endpoint', async () => {
      clients.findChatRouteById.mockResolvedValue({
        clientId: 'c1',
        chatSubscribed: true,
        chatWorkflowEndpoint: null,
      });
      await build().send('r1', payload());
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(deadReason()).toBe('NO_ENDPOINT');
    });

    it('no base address configured', async () => {
      config.N8N_BASE_URL = undefined;
      await build().send('r1', payload());
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(deadReason()).toBe('NO_BASE_URL');
    });

    it('does not dead-letter twice when the request was already taken', async () => {
      clients.findChatRouteById.mockImplementation(() => {
        redis.hash.delete('r1'); // an ack or an expiry won the race
        return Promise.resolve({ clientId: 'c1', chatSubscribed: false });
      });
      await build().send('r1', payload());
      await flush();
      expect(redis.dead).toHaveLength(0);
    });
  });

  describe('resends', () => {
    it('use the endpoint the client has at that moment', async () => {
      const service = build();
      await service.send('r1', payload());
      await flush();
      expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
        'http://n8n.test/webhook/chat-acme',
      );

      clients.findChatRouteById.mockResolvedValue({
        clientId: 'c1',
        chatSubscribed: true,
        chatWorkflowEndpoint: 'chat-new',
      });
      await service.onExpire('r1');
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('http://n8n.test/webhook/chat-new');
      expect(JSON.parse(init.body as string).attempt).toBe(2);
    });

    it('stop when the client is unsubscribed in between', async () => {
      const service = build();
      await service.send('r1', payload());
      await flush();

      clients.findChatRouteById.mockResolvedValue({
        clientId: 'c1',
        chatSubscribed: false,
        chatWorkflowEndpoint: 'chat-acme',
      });
      await service.onExpire('r1');
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((JSON.parse(redis.dead[0]) as { reason: string }).reason).toBe(
        'UNSUBSCRIBED',
      );
    });

    it('end in the dead list after the maximum attempts', async () => {
      config.N8N_MAX_ATTEMPTS = 2;
      const service = build();
      redis.hash.set('r1', JSON.stringify({ payload: payload(), attempts: 2 }));

      await service.onExpire('r1');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.parse(redis.dead[0])).toMatchObject({
        id: 'r1',
        attempts: 2,
        reason: 'MAX_ATTEMPTS',
      });
    });

    it('ignore an id that is no longer pending', async () => {
      await build().onExpire('gone');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(redis.dead).toHaveLength(0);
    });
  });

  describe('ack and take', () => {
    it('ack is true only while the id is pending', async () => {
      const service = build();
      redis.hash.set('r1', '{}');
      await expect(service.ack('r1')).resolves.toBe(true);
      await expect(service.ack('r1')).resolves.toBe(false);
    });

    it('take returns the stored payload once, then null', async () => {
      const service = build();
      redis.hash.set('r1', JSON.stringify({ payload: { a: 1 }, attempts: 2 }));
      await expect(service.take('r1')).resolves.toEqual({
        payload: { a: 1 },
        attempts: 2,
      });
      await expect(service.take('r1')).resolves.toBeNull();
    });
  });

  it('uses the pending and ttl keys of the inbox constants', async () => {
    const service = build();
    await service.send('r1', payload());
    await flush();
    expect(PENDING_HASH).toBe('n8n:pending');
    expect(REQ_TTL).toBe('n8n:ttl:');
    expect(DEAD_LIST).toBe('n8n:dead');
    expect(redis.multiCalls[0]).toEqual(['hset', 'set']);
  });
});

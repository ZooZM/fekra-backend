import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ClientsService } from '@app/clients/clients.service';
import { ConversationsService } from '@app/conversations/conversations.service';
import { LeadsService } from '@app/leads/leads.service';
import { LEAD_RECOVERY_LOCK } from './inbox.constants';
import { N8nDeliveryService } from './n8n-delivery.service';
import { LeadRecoveryService } from './lead-recovery.service';

const candidate = {
  id: 'lead-1',
  clientId: 'client-1',
  platform: 'FACEBOOK' as const,
  accountId: 'page-1',
  senderId: 'customer-1',
  stage: 'qualifying',
  phone: null,
  country: 'US',
  lastIntent: 'product inquiry',
  summary: 'Interested customer',
  notifiedAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
};

describe('LeadRecoveryService', () => {
  let service: LeadRecoveryService;
  let redis: { set: jest.Mock; eval: jest.Mock };
  let leads: { findStaleForRecovery: jest.Mock };
  let clients: {
    findChatRouteById: jest.Mock;
    findWorkflowDataFresh: jest.Mock;
  };
  let conversations: { findLastMessagesByIdForWorkflow: jest.Mock };
  let delivery: { send: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    leads = {
      findStaleForRecovery: jest.fn().mockResolvedValue([]),
    };
    clients = {
      findChatRouteById: jest.fn().mockResolvedValue({
        clientId: 'client-1',
        chatSubscribed: true,
        chatWorkflowEndpoint: 'chat-shop',
      }),
      findWorkflowDataFresh: jest.fn().mockResolvedValue({
        id: 'client-1',
        chatSubscribed: true,
        chatWorkflowEndpoint: 'chat-shop',
      }),
    };
    conversations = {
      findLastMessagesByIdForWorkflow: jest.fn().mockResolvedValue([
        {
          id: 'exchange-1',
          message: 'previous question',
          reply: 'previous answer',
          answered: true,
          createdAt: new Date('2026-11-10T00:00:00.000Z'),
        },
        {
          id: 'exchange-2',
          message: 'latest question',
          reply: 'latest answer',
          answered: true,
          createdAt: new Date('2026-11-11T00:00:00.000Z'),
        },
      ]),
    };
    delivery = { send: jest.fn().mockResolvedValue(undefined) };
    service = new LeadRecoveryService(
      redis as unknown as Redis,
      leads as unknown as LeadsService,
      clients as unknown as ClientsService,
      conversations as unknown as ConversationsService,
      delivery as unknown as N8nDeliveryService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('replays the latest exchange of leads stale for 24 hours every two days', async () => {
    const now = new Date('2026-11-14T12:00:00.000Z');
    leads.findStaleForRecovery.mockResolvedValueOnce([candidate]);

    await service.runOnce(now);

    expect(redis.set).toHaveBeenCalledWith(
      LEAD_RECOVERY_LOCK,
      expect.any(String),
      'EX',
      172800,
      'NX',
    );
    expect(leads.findStaleForRecovery).toHaveBeenNthCalledWith(
      1,
      new Date('2026-11-13T12:00:00.000Z'),
      undefined,
      100,
    );
    expect(clients.findChatRouteById).toHaveBeenCalledWith('client-1');
    expect(clients.findWorkflowDataFresh).toHaveBeenCalledWith('page-1');
    expect(delivery.send).toHaveBeenCalledWith(
      'lead-recovery-lead-1-exchange-2',
      expect.objectContaining({
        kind: 'batch',
        id: 'lead-recovery-lead-1-exchange-2',
        platform: 'facebook',
        accountId: 'page-1',
        senderId: 'customer-1',
        clientId: 'client-1',
        messages: [
          {
            mid: 'exchange-2',
            text: 'latest question',
            timestamp: new Date('2026-11-11T00:00:00.000Z').getTime(),
          },
        ],
        latestMessages: [expect.objectContaining({ id: 'exchange-1' })],
        recovery: true,
      }),
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      LEAD_RECOVERY_LOCK,
      expect.any(String),
    );
  });

  it('does not send to clients that are not subscribed', async () => {
    clients.findChatRouteById.mockResolvedValue({
      clientId: 'client-1',
      chatSubscribed: false,
      chatWorkflowEndpoint: 'chat-shop',
    });
    leads.findStaleForRecovery.mockResolvedValueOnce([candidate]);

    await service.runOnce();

    expect(clients.findWorkflowDataFresh).not.toHaveBeenCalled();
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('skips leads with no stored conversation messages', async () => {
    conversations.findLastMessagesByIdForWorkflow.mockResolvedValue([]);
    leads.findStaleForRecovery.mockResolvedValueOnce([candidate]);

    await service.runOnce();

    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('does not replay a stale lead when all required lead values are populated', async () => {
    const completeLead = { ...candidate, phone: '+12025550123' };
    leads.findStaleForRecovery.mockResolvedValueOnce([completeLead]);

    await service.runOnce();

    expect(clients.findChatRouteById).not.toHaveBeenCalled();
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('skips the run when another instance owns the distributed lock', async () => {
    redis.set.mockResolvedValue(null);

    await service.runOnce();

    expect(leads.findStaleForRecovery).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('schedules a first run after boot and then every two days', async () => {
    jest.useFakeTimers();
    const run = jest.spyOn(service, 'runOnce').mockResolvedValue();
    service.onModuleInit();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.useRealTimers();
  });
});

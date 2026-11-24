import { Logger, NotFoundException } from '@nestjs/common';
import { CLIENT_ACCOUNT_NOT_FOUND, LeadsService } from './leads.service';
import { UpsertLeadInput } from './schemas/lead.schema';
import { LeadWrite } from './interfaces/lead-write.interface';
import { LeadRecord } from './types/lead.types';

const scope = {
  clientId: 'client-1',
  platform: 'FACEBOOK' as const,
  accountId: 'page-1',
  senderId: 'customer-1',
};
const key = {
  platform: 'FACEBOOK',
  accountId: 'page-1',
  senderId: 'customer-1',
};

const upsertInput = (over: Partial<UpsertLeadInput> = {}): UpsertLeadInput => ({
  ...scope,
  stage: 'qualifying',
  phone: '01012345678',
  fields: { industry: 'clothes' },
  claimNotification: false,
  ...over,
});

const lead = (over: Partial<LeadRecord> = {}) =>
  ({ id: 'lead-1', ...scope, stage: 'new', fields: {}, ...over }) as LeadRecord;

describe('LeadsService', () => {
  let repo: {
    findByKey: jest.Mock;
    upsert: jest.Mock;
    findStale: jest.Mock;
    purgeBefore: jest.Mock;
  };
  let clients: { ownsAccount: jest.Mock };
  let conversations: { recentExchanges: jest.Mock };
  let log: jest.SpyInstance;
  let debug: jest.SpyInstance;
  let service: LeadsService;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    repo = {
      findByKey: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      findStale: jest.fn(),
      purgeBefore: jest.fn(),
    };
    clients = { ownsAccount: jest.fn().mockResolvedValue(true) };
    conversations = { recentExchanges: jest.fn().mockResolvedValue([]) };
    service = new LeadsService(
      repo as never,
      clients as never,
      conversations as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const expectNotFound = async (promise: Promise<unknown>) => {
    const error = (await promise.catch((e: unknown) => e)) as NotFoundException;
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toMatchObject({
      errorCode: CLIENT_ACCOUNT_NOT_FOUND,
    });
  };

  describe('ownership', () => {
    it('refuses the context of an account the client does not own, reading nothing', async () => {
      clients.ownsAccount.mockResolvedValue(false);

      await expectNotFound(service.context({ ...scope, historyLimit: 10 }));

      expect(clients.ownsAccount).toHaveBeenCalledWith(
        'client-1',
        'FACEBOOK',
        'page-1',
      );
      expect(repo.findByKey).not.toHaveBeenCalled();
      expect(conversations.recentExchanges).not.toHaveBeenCalled();
    });

    it('refuses a save on an account the client does not own, writing nothing', async () => {
      clients.ownsAccount.mockResolvedValue(false);
      await expectNotFound(service.upsert(upsertInput()));
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('context', () => {
    it("returns the client's lead and the conversation scoped to the client", async () => {
      const stored = lead();
      const history = [
        {
          message: 'hi',
          reply: 'hello',
          answered: true,
          createdAt: new Date(),
        },
      ];
      repo.findByKey.mockResolvedValue(stored);
      conversations.recentExchanges.mockResolvedValue(history);

      await expect(
        service.context({ ...scope, historyLimit: 7 }),
      ).resolves.toEqual({ lead: stored, history });

      expect(repo.findByKey).toHaveBeenCalledWith(key, 'client-1');
      expect(conversations.recentExchanges).toHaveBeenCalledWith({
        clientId: 'client-1',
        platform: 'FACEBOOK',
        receiverId: 'page-1',
        senderId: 'customer-1',
        limit: 7,
      });
    });

    it('returns lead: null and an empty history for a new customer', async () => {
      await expect(
        service.context({ ...scope, historyLimit: 10 }),
      ).resolves.toEqual({ lead: null, history: [] });
    });
  });

  describe('upsert', () => {
    it('saves through the repository with the merge rules', async () => {
      repo.upsert.mockResolvedValue({ lead: lead(), notifiedNow: false });

      await service.upsert(upsertInput({ claimNotification: true }));

      const [k, clientId, build, claim] = repo.upsert.mock.calls[0] as [
        unknown,
        string,
        (current: LeadRecord | null) => LeadWrite,
        boolean,
      ];
      expect(k).toEqual(key);
      expect(clientId).toBe('client-1');
      expect(claim).toBe(true);
      // build is mergeLead over the input: an empty phone keeps the stored one
      expect(build(null)).toMatchObject({
        stage: 'qualifying',
        phone: '01012345678',
        fields: { industry: 'clothes' },
      });
    });

    it('logs the claim with ids only, never the phone or the fields', async () => {
      repo.upsert.mockResolvedValue({ lead: lead(), notifiedNow: true });

      await service.upsert(upsertInput({ claimNotification: true }));

      expect(log).toHaveBeenCalledWith(
        'Lead lead-1 of client client-1: notification claimed',
      );
      const logged = JSON.stringify([...log.mock.calls, ...debug.mock.calls]);
      expect(logged).not.toContain('01012345678');
      expect(logged).not.toContain('clothes');
    });

    it('gives notifiedNow: true to exactly one of several concurrent claims', async () => {
      // a repository whose claim is a conditional update, like the database's
      let notifiedAt: Date | null = null;
      repo.upsert.mockImplementation(
        async (
          _k: unknown,
          _c: string,
          build: () => LeadWrite,
          claim: boolean,
        ) => {
          await new Promise((resolve) => setImmediate(resolve));
          build();
          let notifiedNow = false;
          if (claim && notifiedAt === null) {
            notifiedAt = new Date();
            notifiedNow = true;
          }
          return { lead: lead({ notifiedAt }), notifiedNow };
        },
      );

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.upsert(upsertInput({ claimNotification: true })),
        ),
      );

      expect(results.filter((r) => r.notifiedNow)).toHaveLength(1);
      const later = await service.upsert(
        upsertInput({ claimNotification: true }),
      );
      expect(later.notifiedNow).toBe(false);
    });
  });

  it('delegates recovery scans to the repository', async () => {
    const cutoff = new Date('2026-11-13T00:00:00.000Z');
    const cursor = { id: 'lead-0', updatedAt: cutoff };
    const candidates = [{ id: 'lead-1' }];
    repo.findStale.mockResolvedValue(candidates);

    await expect(
      service.findStaleForRecovery(cutoff, cursor, 100),
    ).resolves.toBe(candidates);
    expect(repo.findStale).toHaveBeenCalledWith(cutoff, cursor, 100);
  });

  it('deletes old leads through the repository (retention)', async () => {
    repo.purgeBefore.mockResolvedValue(4);
    const cutoff = new Date('2025-11-14T00:00:00.000Z');
    await expect(service.purgeBefore(cutoff)).resolves.toBe(4);
    expect(repo.purgeBefore).toHaveBeenCalledWith(cutoff);
  });
});

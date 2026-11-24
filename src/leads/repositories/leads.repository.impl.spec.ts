import { Logger } from '@nestjs/common';
import { LeadsRepository } from './leads.repository.impl';
import { LeadWrite } from '../interfaces/lead-write.interface';

const key = {
  platform: 'FACEBOOK' as const,
  accountId: 'page-1',
  senderId: 'customer-1',
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  clientId: 'client-1',
  ...key,
  stage: 'new',
  phone: null,
  country: null,
  lastIntent: null,
  summary: null,
  fields: {},
  notifiedAt: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  ...over,
});

const write: LeadWrite = {
  clientId: 'client-1',
  stage: 'qualifying',
  phone: '0100',
  country: 'EG',
  lastIntent: null,
  summary: null,
  fields: { industry: 'clothes' },
};

describe('LeadsRepository', () => {
  let tx: {
    lead: {
      createMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    lead: { findFirst: jest.Mock; findMany: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let repo: LeadsRepository;

  beforeEach(() => {
    tx = {
      lead: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        update: jest.fn((args: { data: LeadWrite }) =>
          Promise.resolve(row(args.data as never)),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'lead-1' }]),
    };
    prisma = {
      lead: { findFirst: jest.fn(), findMany: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    repo = new LeadsRepository(prisma as never);
  });

  describe('findStale', () => {
    it('pages stale leads in stable order and selects only recovery identifiers', async () => {
      const cutoff = new Date('2026-11-14T00:00:00.000Z');
      const cursor = {
        id: 'lead-0',
        updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      };
      const candidates = [
        {
          id: 'lead-1',
          clientId: 'client-1',
          ...key,
          updatedAt: new Date('2026-11-02T00:00:00.000Z'),
        },
      ];
      prisma.lead.findMany.mockResolvedValue(candidates);

      await expect(repo.findStale(cutoff, cursor, 100)).resolves.toEqual(
        candidates,
      );
      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            { updatedAt: { lt: cutoff } },
            {
              OR: [
                { phone: null },
                { country: null },
                { lastIntent: null },
                { summary: null },
                { notifiedAt: null },
              ],
            },
            {
              OR: [
                { updatedAt: { gt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
              ],
            },
          ],
        },
        select: {
          id: true,
          clientId: true,
          platform: true,
          accountId: true,
          senderId: true,
          stage: true,
          phone: true,
          country: true,
          lastIntent: true,
          summary: true,
          notifiedAt: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
    });
  });

  describe('findByKey', () => {
    it("reads only this client's lead and parses its fields", async () => {
      prisma.lead.findFirst.mockResolvedValue(row({ fields: { a: 'b' } }));

      const lead = await repo.findByKey(key, 'client-1');

      expect(prisma.lead.findFirst).toHaveBeenCalledWith({
        where: { ...key, clientId: 'client-1' },
      });
      expect(lead?.fields).toEqual({ a: 'b' });
    });

    it('never trusts stored JSON: invalid fields read as {}', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      prisma.lead.findFirst.mockResolvedValue(row({ fields: { a: 1 } }));
      expect((await repo.findByKey(key, 'client-1'))?.fields).toEqual({});
    });

    it('returns null when there is none', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(repo.findByKey(key, 'client-1')).resolves.toBeNull();
    });
  });

  describe('upsert', () => {
    it('inserts if missing, locks the row, then writes: a new lead is built from nothing', async () => {
      tx.lead.createMany.mockResolvedValue({ count: 1 });
      const build = jest.fn().mockReturnValue(write);

      const result = await repo.upsert(key, 'client-1', build, false);

      expect(tx.lead.createMany).toHaveBeenCalledWith({
        data: [{ ...key, clientId: 'client-1' }],
        skipDuplicates: true,
      });
      const lockSql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(lockSql).toMatch(/FOR UPDATE/);
      expect(build).toHaveBeenCalledWith(null);
      expect(tx.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: write,
      });
      expect(tx.lead.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        lead: expect.objectContaining({ stage: 'qualifying' }) as unknown,
        notifiedNow: false,
      });
    });

    it('merges into an existing lead: build gets the stored record', async () => {
      tx.lead.findUniqueOrThrow.mockResolvedValue(
        row({ stage: 'phone_captured', fields: { city: 'Cairo' } }),
      );
      const build = jest.fn().mockReturnValue(write);

      await repo.upsert(key, 'client-1', build, false);

      expect(build).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'phone_captured',
          fields: { city: 'Cairo' },
        }),
      );
    });

    it('claims the notification with a conditional update, and says so', async () => {
      const notifiedAt = new Date();
      tx.lead.updateMany.mockResolvedValue({ count: 1 });
      tx.lead.findUniqueOrThrow
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row({ ...write, notifiedAt }));

      const result = await repo.upsert(key, 'client-1', () => write, true);

      expect(tx.lead.updateMany).toHaveBeenCalledWith({
        where: { id: 'lead-1', notifiedAt: null },
        data: { notifiedAt: expect.any(Date) as unknown },
      });
      expect(result.notifiedNow).toBe(true);
      expect(result.lead.notifiedAt).toBe(notifiedAt);
    });

    it('answers notifiedNow: false when the notification was already claimed', async () => {
      tx.lead.updateMany.mockResolvedValue({ count: 0 });

      const result = await repo.upsert(key, 'client-1', () => write, true);

      expect(result.notifiedNow).toBe(false);
      expect(tx.lead.findUniqueOrThrow).toHaveBeenCalledTimes(1); // no re-read
    });

    it('lets only one of two concurrent claims win', async () => {
      // the database's conditional update: the first one to run finds notified_at empty
      let notified = false;
      tx.lead.updateMany.mockImplementation(() => {
        const count = notified ? 0 : 1;
        notified = true;
        return Promise.resolve({ count });
      });

      const results = await Promise.all([
        repo.upsert(key, 'client-1', () => write, true),
        repo.upsert(key, 'client-1', () => write, true),
      ]);

      expect(results.map((r) => r.notifiedNow).sort()).toEqual([false, true]);
    });
  });

  describe('purgeBefore', () => {
    it('deletes in batches until a batch is not full', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      const cutoff = new Date('2025-11-14T00:00:00.000Z');

      await expect(repo.purgeBefore(cutoff, 2)).resolves.toBe(5);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
      const [sql, ...params] = prisma.$executeRaw.mock.calls[0] as [
        string[],
        ...unknown[],
      ];
      expect(sql.join('?')).toMatch(/DELETE FROM leads/);
      expect(sql.join('?')).toMatch(/updated_at < \?/);
      expect(params).toEqual([cutoff, 2]);
    });
  });
});

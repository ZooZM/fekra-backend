import { CommentsRepository } from './comments.repository.impl';

const SNAPSHOT = new Date('2026-11-14T12:00:00.000Z');
const CLIENT = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';

const row = (n: number, createdAt = SNAPSHOT) => ({
  id: `id-${n}`,
  createdAt,
  client: { name: 'Acme' },
});

describe('CommentsRepository (feature 003)', () => {
  let prisma: {
    commentReply: {
      findMany: jest.Mock;
      count: jest.Mock;
      upsert: jest.Mock;
    };
    commentExportRecord: { create: jest.Mock; update: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let repo: CommentsRepository;

  const listQuery = (over: Record<string, unknown> = {}) =>
    ({
      page: 1,
      limit: 20,
      orderBy: 'createdAt',
      orderDir: 'desc',
      ...over,
    }) as never;

  beforeEach(() => {
    prisma = {
      commentReply: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn().mockResolvedValue({}),
      },
      commentExportRecord: {
        create: jest.fn().mockResolvedValue({ id: 'record-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn(),
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    repo = new CommentsRepository(prisma as never);
  });

  describe('findAll', () => {
    it('includes the client name and ends the order with the id', async () => {
      await repo.findAll(listQuery());
      expect(prisma.commentReply.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { client: { select: { name: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );
    });

    it('filters by label, decision basis, platform, client and date range, for the page and the total', async () => {
      const from = new Date('2026-11-01T00:00:00Z');
      const to = new Date('2026-11-10T00:00:00Z');
      await repo.findAll(
        listQuery({
          platform: 'FACEBOOK',
          classification: 'COMPLAINT',
          decisionBasis: 'AI_MODEL',
          from,
          to,
        }),
        CLIENT,
      );
      const where = {
        clientId: CLIENT,
        platform: 'FACEBOOK',
        classification: 'COMPLAINT',
        decisionBasis: 'AI_MODEL',
        createdAt: { gte: from, lte: to },
      };
      expect(prisma.commentReply.count).toHaveBeenCalledWith({ where });
      expect(prisma.commentReply.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
    });

    it('does not filter when nothing is given', async () => {
      await repo.findAll(listQuery());
      expect(prisma.commentReply.count).toHaveBeenCalledWith({ where: {} });
    });
  });

  describe('save', () => {
    const data = {
      clientId: CLIENT,
      platform: 'FACEBOOK',
      commentId: '1_2',
      comment: 'hi',
      classification: 'INQUIRY',
      reason: 'question mark',
      decisionBasis: 'AI_MODEL',
      decisionModel: 'gemini-x',
    } as never;

    it('creates with everything, including how the label was decided', async () => {
      await repo.save(data);
      expect(prisma.commentReply.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            platform_commentId: { platform: 'FACEBOOK', commentId: '1_2' },
          },
          create: data,
        }),
      );
    });

    it('a re-classification updates the label, the reason and the basis, and keeps only the latest', async () => {
      await repo.save(data);
      expect(
        (prisma.commentReply.upsert.mock.calls[0] as [{ update: unknown }])[0]
          .update,
      ).toEqual({
        classification: 'INQUIRY',
        reason: 'question mark',
        decisionBasis: 'AI_MODEL',
        decisionModel: 'gemini-x',
      });
    });

    it('clears the model when the new basis has none', async () => {
      await repo.save({
        ...(data as object),
        decisionBasis: 'SAFE_FALLBACK',
        decisionModel: undefined,
      } as never);
      expect(
        (
          prisma.commentReply.upsert.mock.calls[0] as [
            { update: { decisionModel: unknown } },
          ]
        )[0].update.decisionModel,
      ).toBeNull();
    });
  });

  describe('iterateForExport', () => {
    const collect = async (
      gen: AsyncGenerator<{ id: string }>,
    ): Promise<string[]> => {
      const ids: string[] = [];
      for await (const r of gen) ids.push(r.id);
      return ids;
    };

    it('reads in keyset pages until a page comes back short, and yields every row', async () => {
      const t1 = new Date('2026-11-14T11:00:00Z');
      const t2 = new Date('2026-11-14T10:00:00Z');
      prisma.commentReply.findMany
        .mockResolvedValueOnce([row(1, t1), row(2, t1)])
        .mockResolvedValueOnce([row(3, t2), row(4, t2)])
        .mockResolvedValueOnce([row(5, t2)]);

      const ids = await collect(
        repo.iterateForExport({}, SNAPSHOT, 2) as AsyncGenerator<{
          id: string;
        }>,
      );

      expect(ids).toEqual(['id-1', 'id-2', 'id-3', 'id-4', 'id-5']);
      expect(prisma.commentReply.findMany).toHaveBeenCalledTimes(3);
    });

    it('continues after the last row of a page with a (createdAt, id) keyset, not an offset', async () => {
      const t1 = new Date('2026-11-14T11:00:00Z');
      prisma.commentReply.findMany
        .mockResolvedValueOnce([row(1, t1), row(2, t1)])
        .mockResolvedValueOnce([]);

      await collect(
        repo.iterateForExport({}, SNAPSHOT, 2) as AsyncGenerator<{
          id: string;
        }>,
      );

      const second = prisma.commentReply.findMany.mock.calls[1][0] as {
        where: { AND: unknown[] };
        skip?: number;
        take: number;
        orderBy: unknown;
      };
      expect(second.skip).toBeUndefined();
      expect(second.take).toBe(2);
      expect(second.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      expect(second.where.AND[1]).toEqual({
        OR: [{ createdAt: { lt: t1 } }, { createdAt: t1, id: { gt: 'id-2' } }],
      });
    });

    it('applies the filters and the snapshot to every page', async () => {
      prisma.commentReply.findMany.mockResolvedValue([]);

      await collect(
        repo.iterateForExport(
          { clientId: CLIENT, classification: 'SPAM', decisionBasis: 'RULES' },
          SNAPSHOT,
          10,
        ) as AsyncGenerator<{ id: string }>,
      );

      expect(
        (prisma.commentReply.findMany.mock.calls[0] as [{ where: unknown }])[0]
          .where,
      ).toEqual({
        clientId: CLIENT,
        classification: 'SPAM',
        decisionBasis: 'RULES',
        createdAt: { lte: SNAPSHOT },
      });
    });

    it('never goes past the snapshot, even when the filter asks for a later end date', async () => {
      prisma.commentReply.findMany.mockResolvedValue([]);
      const later = new Date('2027-01-01T00:00:00Z');
      const earlier = new Date('2026-11-01T00:00:00Z');

      await collect(
        repo.iterateForExport({ to: later }, SNAPSHOT, 10) as AsyncGenerator<{
          id: string;
        }>,
      );
      await collect(
        repo.iterateForExport({ to: earlier }, SNAPSHOT, 10) as AsyncGenerator<{
          id: string;
        }>,
      );

      const upper = (call: number) =>
        (
          prisma.commentReply.findMany.mock.calls[call] as [
            { where: { createdAt: { lte: Date } } },
          ]
        )[0].where.createdAt.lte;
      expect(upper(0)).toEqual(SNAPSHOT);
      expect(upper(1)).toEqual(earlier);
    });

    it('yields nothing for an empty result', async () => {
      prisma.commentReply.findMany.mockResolvedValue([]);
      await expect(
        collect(
          repo.iterateForExport({}, SNAPSHOT, 10) as AsyncGenerator<{
            id: string;
          }>,
        ),
      ).resolves.toEqual([]);
    });
  });

  describe('the download record', () => {
    it('is created when the download starts, not completed, with the actor and filters only', async () => {
      const id = await repo.startExport({
        actor: { id: 'a1', name: 'Admin', email: 'admin@example.com' },
        filters: { snapshotAt: SNAPSHOT.toISOString() },
      });

      expect(id).toBe('record-1');
      expect(prisma.commentExportRecord.create).toHaveBeenCalledWith({
        data: {
          actorId: 'a1',
          actorName: 'Admin',
          actorEmail: 'admin@example.com',
          filters: { snapshotAt: SNAPSHOT.toISOString() },
          completed: false,
        },
        select: { id: true },
      });
    });

    it('is updated with the rows written and whether the download finished', async () => {
      await repo.finishExport('record-1', 42, true);
      expect(prisma.commentExportRecord.update).toHaveBeenCalledWith({
        where: { id: 'record-1' },
        data: { rowCount: 42, completed: true },
      });
    });
  });

  describe('purgeBefore (retention)', () => {
    const cutoff = new Date('2025-11-14T12:00:00.000Z');

    it('deletes by first classification time, in batches, until a batch comes back short', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2);

      await expect(repo.purgeBefore(cutoff, 5)).resolves.toBe(12);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
      const sql = (prisma.$executeRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('DELETE FROM comment_replies');
      expect(sql).toContain('created_at <');
      expect(prisma.$executeRaw.mock.calls[0][1]).toBe(cutoff);
      expect(prisma.$executeRaw.mock.calls[0][2]).toBe(5);
    });

    it('stops after one pass when nothing is old enough', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      await expect(repo.purgeBefore(cutoff)).resolves.toBe(0);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});

import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { CommentsService } from './comments.service';
import { CommentRowWithClient } from './types/comment.types';

const admin = {
  id: 'admin-1',
  name: 'Admin One',
  email: 'admin@example.com',
  roles: [UserRole.ADMIN],
  clientId: null,
} as SafeUser;
const clientUser = {
  id: 'user-1',
  name: 'Owner',
  email: 'owner@example.com',
  roles: [UserRole.CLIENT],
  clientId: 'client-1',
} as SafeUser;

const row = (n: number, over: Partial<CommentRowWithClient> = {}) =>
  ({
    id: `id-${n}`,
    clientId: 'client-1',
    platform: 'FACEBOOK',
    commentId: `100_${n}`,
    comment: `comment ${n}`,
    classification: 'INQUIRY',
    reason: 'keyword "how"',
    decisionBasis: 'RULES',
    decisionModel: null,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
    client: { name: 'Acme' },
    ...over,
  }) as CommentRowWithClient;

async function* rows(items: CommentRowWithClient[], failAfter?: number) {
  let i = 0;
  for (const item of items) {
    if (failAfter !== undefined && i === failAfter) throw new Error('db down');
    i++;
    await Promise.resolve();
    yield item;
  }
}

const collect = async (stream: Readable) => {
  let out = '';
  for await (const chunk of stream) out += String(chunk);
  return out;
};

describe('CommentsService', () => {
  let service: CommentsService;
  let repo: Record<string, jest.Mock>;
  let config: { get: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repo = Object.fromEntries(
      [
        'findAll',
        'save',
        'iterateForExport',
        'startExport',
        'finishExport',
      ].map((m) => [m, jest.fn()]),
    );
    repo.startExport.mockResolvedValue('record-1');
    repo.finishExport.mockResolvedValue(undefined);
    config = { get: jest.fn() };
    service = new CommentsService(repo as never, config as never);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('findAll', () => {
    it('forces CLIENT users to their assigned client when listing comments', async () => {
      const query = {
        page: 1,
        limit: 20,
        orderBy: 'createdAt',
        orderDir: 'desc',
        clientId: 'client-2',
      } as const;
      repo.findAll.mockResolvedValue({ data: [], meta: {} });

      await service.findAll(query, clientUser);

      expect(repo.findAll).toHaveBeenCalledWith(query, 'client-1');
    });

    it('passes the requested client and the decision-basis filter through for an ADMIN', async () => {
      const query = {
        page: 1,
        limit: 20,
        clientId: 'client-2',
        decisionBasis: 'AI_MODEL',
      } as never;
      repo.findAll.mockResolvedValue({ data: [], meta: {} });

      await service.findAll(query, admin);

      expect(repo.findAll).toHaveBeenCalledWith(query, 'client-2');
    });

    it('maps rows to records with the client name and the decision basis', async () => {
      repo.findAll.mockResolvedValue({
        data: [
          row(1, { decisionBasis: 'AI_MODEL', decisionModel: 'gemini-x' }),
        ],
        meta: { total: 1 },
      });

      const page = await service.findAll({} as never, admin);

      expect(page.meta).toEqual({ total: 1 });
      expect(page.data[0]).toMatchObject({
        clientName: 'Acme',
        decisionBasis: 'AI_MODEL',
        decisionModel: 'gemini-x',
      });
      expect(page.data[0]).not.toHaveProperty('client');
    });
  });

  describe('save', () => {
    const base = {
      clientId: 'ac8f7ab8-399f-4ae4-84e8-0ee2f4bef3a2',
      platform: 'facebook',
      commentId: '123_456',
      comment: '  Hello\u0000  ',
      classification: 'inquiry',
      reason: '  Question  ',
    };

    it('validates and normalizes an internal comment write before saving', async () => {
      repo.save.mockResolvedValue({});

      await service.save(base);

      expect(repo.save).toHaveBeenCalledWith({
        clientId: base.clientId,
        platform: 'FACEBOOK',
        commentId: '123_456',
        comment: 'Hello',
        classification: 'INQUIRY',
        reason: 'Question',
        // a caller that does not say how it decided is stored as UNKNOWN
        decisionBasis: 'UNKNOWN',
      });
    });

    it('keeps the decision basis and the model it was given', async () => {
      repo.save.mockResolvedValue({});

      await service.save({
        ...base,
        decisionBasis: 'AI_MODEL',
        decisionModel: ' gemini-3.5-flash-lite ',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionBasis: 'AI_MODEL',
          decisionModel: 'gemini-3.5-flash-lite',
        }),
      );
    });
  });

  describe('purgeBefore (retention)', () => {
    it('deletes through the repository and returns how many it deleted', async () => {
      const cutoff = new Date('2025-11-14T12:00:00.000Z');
      repo.purgeBefore = jest.fn().mockResolvedValue(7);

      await expect(service.purgeBefore(cutoff)).resolves.toBe(7);
      expect(repo.purgeBefore).toHaveBeenCalledWith(cutoff);
    });
  });

  describe('export', () => {
    const query = { classification: 'COMPLAINT' } as never;

    it('records the download before the first byte, with the admin and the filters', async () => {
      repo.iterateForExport.mockReturnValue(rows([]));

      const { stream } = await service.export(query, admin);

      expect(repo.startExport).toHaveBeenCalledTimes(1);
      expect(repo.iterateForExport).not.toHaveBeenCalled(); // nothing is read yet
      const arg = repo.startExport.mock.calls[0][0] as {
        actor: unknown;
        filters: Record<string, unknown>;
      };
      expect(arg.actor).toEqual({
        id: 'admin-1',
        name: 'Admin One',
        email: 'admin@example.com',
      });
      expect(arg.filters).toMatchObject({ classification: 'COMPLAINT' });
      expect(arg.filters.snapshotAt).toEqual(expect.any(String));
      await collect(stream);
    });

    it('streams the BOM, the header and one line per comment, then marks the record completed', async () => {
      repo.iterateForExport.mockReturnValue(rows([row(1), row(2)]));

      const { stream, filename } = await service.export(query, admin);
      const text = await collect(stream);
      const lines = text.split('\r\n');

      expect(text.startsWith('﻿id,clientId,clientName,platform')).toBe(true);
      expect(lines).toHaveLength(4); // header, 2 rows, trailing empty
      expect(lines[1]).toContain('comment 1');
      expect(repo.finishExport).toHaveBeenCalledWith('record-1', 2, true);
      expect(filename).toMatch(/^comments-\d{8}-\d{6}\.csv$/);
    });

    it('reads with the snapshot instant and the batch size from the configuration', async () => {
      config.get.mockReturnValue('250');
      repo.iterateForExport.mockReturnValue(rows([]));

      const { stream } = await service.export(query, admin);
      await collect(stream);

      const [filters, snapshotAt, batch] = repo.iterateForExport.mock
        .calls[0] as [unknown, Date, number];
      expect(filters).toMatchObject({ classification: 'COMPLAINT' });
      expect(snapshotAt).toBeInstanceOf(Date);
      expect(batch).toBe(250);
    });

    it('uses 1,000 rows per read when the setting is missing or invalid', async () => {
      config.get.mockReturnValue('not a number');
      repo.iterateForExport.mockReturnValue(rows([]));
      const { stream } = await service.export(query, admin);
      await collect(stream);
      expect((repo.iterateForExport.mock.calls[0] as unknown[])[2]).toBe(1000);
    });

    it('marks the record not completed, with the rows written so far, when the database fails', async () => {
      repo.iterateForExport.mockReturnValue(rows([row(1), row(2)], 1));

      const { stream } = await service.export(query, admin);

      await expect(collect(stream)).rejects.toThrow('db down');
      expect(repo.finishExport).toHaveBeenCalledWith('record-1', 1, false);
    });

    it('marks the record not completed when the client stops reading', async () => {
      repo.iterateForExport.mockReturnValue(rows([row(1), row(2), row(3)]));

      const { stream } = await service.export(query, admin);
      for await (const chunk of stream) {
        void chunk;
        break; // the header arrived, then the download was abandoned
      }
      await new Promise((r) => setImmediate(r));

      expect(repo.finishExport).toHaveBeenCalledWith(
        'record-1',
        expect.any(Number),
        false,
      );
    });

    it('still ends the stream if the record cannot be finished', async () => {
      repo.finishExport.mockRejectedValue(new Error('db down'));
      repo.iterateForExport.mockReturnValue(rows([row(1)]));

      const { stream } = await service.export(query, admin);

      await expect(collect(stream)).resolves.toContain('comment 1');
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('scopes a CLIENT-role user to their own client', async () => {
      // the download record stores the client id, which is a UUID in the database
      const ownClient = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';
      const otherClient = '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
      repo.iterateForExport.mockReturnValue(rows([]));

      const { stream } = await service.export(
        { clientId: otherClient } as never,
        { ...clientUser, clientId: ownClient } as SafeUser,
      );
      await collect(stream);

      expect(
        (repo.iterateForExport.mock.calls[0] as [{ clientId: string }])[0]
          .clientId,
      ).toBe(ownClient);
      expect(
        (
          repo.startExport.mock.calls[0] as [{ filters: { clientId: string } }]
        )[0].filters.clientId,
      ).toBe(ownClient);
    });

    it('never puts comment text in the download record or in the logs', async () => {
      repo.iterateForExport.mockReturnValue(
        rows([row(1, { comment: 'SECRET customer words' })]),
      );
      const { stream } = await service.export(query, admin);
      await collect(stream);

      expect(JSON.stringify(repo.startExport.mock.calls)).not.toContain(
        'SECRET',
      );
      const logged = [
        ...(Logger.prototype.log as jest.Mock).mock.calls,
        ...(Logger.prototype.error as jest.Mock).mock.calls,
      ].flat();
      expect(logged.join(' ')).not.toContain('SECRET');
    });
  });
});

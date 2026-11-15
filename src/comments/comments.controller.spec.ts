import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { ROLES_KEY } from '@app/auth/decorators/roles.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

describe('CommentsController', () => {
  let controller: CommentsController;
  let service: { findAll: jest.Mock; export: jest.Mock };
  const user = { id: 'u1', name: 'Admin' } as SafeUser;

  beforeEach(() => {
    service = { findAll: jest.fn(), export: jest.fn() };
    controller = new CommentsController(service as unknown as CommentsService);
  });

  it('delegates the list with the signed-in user', () => {
    void controller.findAll({ page: 1 } as never, user);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 }, user);
  });

  it('returns the export as a downloadable CSV stream', async () => {
    service.export.mockResolvedValue({
      filename: 'comments-20261114-153012.csv',
      stream: Readable.from(['a']),
    });

    const file = await controller.export(
      { classification: 'SPAM' } as never,
      user,
    );

    expect(service.export).toHaveBeenCalledWith(
      { classification: 'SPAM' },
      user,
    );
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual({
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="comments-20261114-153012.csv"',
      length: undefined,
    });
  });

  it('allows ADMIN and CLIENT to read the list, and ADMIN only to export', () => {
    const roles = (target: object) =>
      Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined;

    expect(roles(CommentsController)).toEqual(['ADMIN', 'CLIENT']);
    expect(roles(CommentsController.prototype.findAll)).toBeUndefined();
    expect(roles(CommentsController.prototype.export)).toEqual(['ADMIN']);
  });

  it('asks the browser not to cache the export', () => {
    const headers = Reflect.getMetadata(
      '__headers__',
      CommentsController.prototype.export,
    ) as { name: string; value: string }[];
    expect(headers).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
  });
});

import { UnprocessableEntityException } from '@nestjs/common';
import { AppZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { ClientPostsController } from './client-posts.controller';
import { ClientPostsService } from './client-posts.service';
import {
  ClientPostParamsDto,
  ClientPostsQueryDto,
} from './schemas/client-posts-query.schema';

const ID = '8ed9f96d-c790-4279-ba5f-88feec1c68e3';

describe('ClientPostsController', () => {
  let controller: ClientPostsController;
  let service: { list: jest.Mock; unrepliedCount: jest.Mock };

  beforeEach(() => {
    service = { list: jest.fn(), unrepliedCount: jest.fn() };
    controller = new ClientPostsController(
      service as unknown as ClientPostsService,
    );
  });

  it('forwards the client id and the parsed query to list', async () => {
    const page = { data: [], meta: {} };
    service.list.mockResolvedValue(page);
    const query = { platform: 'facebook', limit: 10, after: 'abc' } as const;

    await expect(controller.list({ id: ID }, query)).resolves.toBe(page);
    expect(service.list).toHaveBeenCalledWith(ID, query);
  });

  it('forwards the ids and the platform to unrepliedCount', async () => {
    const result = { unrepliedCount: 3 };
    service.unrepliedCount.mockResolvedValue(result);

    await expect(
      controller.unrepliedCount(
        { id: ID, postId: '12345_67890' },
        { platform: 'instagram' },
      ),
    ).resolves.toBe(result);
    expect(service.unrepliedCount).toHaveBeenCalledWith(
      ID,
      '12345_67890',
      'instagram',
    );
  });

  describe('input validation (the pipe is global, so this is what a request meets)', () => {
    const pipe = new AppZodValidationPipe();

    it('rejects an invalid platform or limit with 422', () => {
      const validate = (value: unknown): unknown =>
        pipe.transform(value, {
          type: 'query',
          metatype: ClientPostsQueryDto,
        });

      expect(() => validate({ platform: 'x' })).toThrow(
        UnprocessableEntityException,
      );
      expect(() => validate({ platform: 'facebook', limit: '26' })).toThrow(
        UnprocessableEntityException,
      );
      expect(validate({ platform: 'facebook' })).toEqual({
        platform: 'facebook',
        limit: 25,
      });
    });

    it('rejects a client id that is a Facebook page id, and a bad post id', () => {
      const validate = (value: unknown): unknown =>
        pipe.transform(value, {
          type: 'param',
          metatype: ClientPostParamsDto,
        });

      expect(() =>
        validate({ id: '114022207011543', postId: '12345_67890' }),
      ).toThrow(UnprocessableEntityException);
      expect(() => validate({ id: ID, postId: 'abc' })).toThrow(
        UnprocessableEntityException,
      );
    });
  });
});

describe('ClientPostsController access rules', () => {
  it('requires the ADMIN role and both guards for every route', () => {
    expect(Reflect.getMetadata('roles', ClientPostsController)).toEqual([
      'ADMIN',
    ]);
    const guards = Reflect.getMetadata('__guards__', ClientPostsController) as {
      name: string;
    }[];
    expect(guards.map((g) => g.name)).toEqual(['JwtAuthGuard', 'RolesGuard']);
  });

  it('is mounted under the client, so posts are always read for one client', () => {
    expect(Reflect.getMetadata('path', ClientPostsController)).toBe(
      'clients/:id/posts',
    );
  });
});

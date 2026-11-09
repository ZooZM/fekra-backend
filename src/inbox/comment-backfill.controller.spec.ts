import { UnprocessableEntityException } from '@nestjs/common';
import { AppZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { IdParamDto } from '@common/zod/dtos';
import { CommentBackfillController } from './comment-backfill.controller';
import { CommentBackfillService } from './comment-backfill.service';
import { CommentBackfillDto } from './schemas/comment-backfill.schema';

const RUN_ID = '3f0e1c2a-8a43-4c55-9b55-0d7b0c7b1e11';
const user = {
  id: 'a1111111-1111-4111-8111-111111111111',
  name: 'Admin',
  email: 'admin@example.com',
  roles: ['ADMIN'],
  passwordHash: 'must-not-be-forwarded',
} as never;
const actor = {
  id: 'a1111111-1111-4111-8111-111111111111',
  name: 'Admin',
  email: 'admin@example.com',
};

describe('CommentBackfillController', () => {
  let controller: CommentBackfillController;
  let service: { start: jest.Mock; getRun: jest.Mock; stopRun: jest.Mock };

  beforeEach(() => {
    service = { start: jest.fn(), getRun: jest.fn(), stopRun: jest.fn() };
    controller = new CommentBackfillController(
      service as unknown as CommentBackfillService,
    );
  });

  it('starts a run with the body and only the admin’s id, name and email', async () => {
    const result = { pending: 3, run: { id: RUN_ID } };
    service.start.mockResolvedValue(result);
    const dto = { accountId: '12345', postId: '12345_67890' };

    await expect(controller.start(dto, user)).resolves.toBe(result);

    expect(service.start).toHaveBeenCalledWith(dto, actor);
    expect(JSON.stringify(service.start.mock.calls)).not.toContain(
      'must-not-be-forwarded',
    );
  });

  it('reads a run by id', async () => {
    const run = { id: RUN_ID, state: 'running' };
    service.getRun.mockResolvedValue(run);
    await expect(controller.getRun({ id: RUN_ID })).resolves.toBe(run);
    expect(service.getRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('stops a run with the acting admin', async () => {
    const run = { id: RUN_ID, state: 'stopped' };
    service.stopRun.mockResolvedValue(run);
    await expect(controller.stopRun({ id: RUN_ID }, user)).resolves.toBe(run);
    expect(service.stopRun).toHaveBeenCalledWith(RUN_ID, actor);
  });

  it('answers 202 to a start (the run continues in the background) and 200 to a stop', () => {
    const code = (method: keyof CommentBackfillController) =>
      Reflect.getMetadata(
        '__httpCode__',
        CommentBackfillController.prototype[method],
      ) as number;
    expect(code('start')).toBe(202);
    expect(code('stopRun')).toBe(200);
  });

  describe('input validation (the pipe is global, so this is what a request meets)', () => {
    const pipe = new AppZodValidationPipe();

    it('rejects a run id that is not a UUID with 422', () => {
      const validate = (id: string): unknown =>
        pipe.transform({ id }, { type: 'param', metatype: IdParamDto });
      expect(() => validate('abc')).toThrow(UnprocessableEntityException);
      expect(validate(RUN_ID)).toEqual({ id: RUN_ID });
    });

    it('still rejects a bad post id and unknown keys in the start body', () => {
      const validate = (body: unknown): unknown =>
        pipe.transform(body, { type: 'body', metatype: CommentBackfillDto });
      expect(() => validate({ accountId: '12345678', postId: 'abc' })).toThrow(
        UnprocessableEntityException,
      );
      expect(() =>
        validate({ accountId: '12345678', postId: '12345_67890', x: 1 }),
      ).toThrow(UnprocessableEntityException);
      expect(
        validate({ accountId: '12345678', postId: '12345_67890' }),
      ).toEqual({ accountId: '12345678', postId: '12345_67890' });
    });
  });
});

describe('CommentBackfillController access rules', () => {
  it('requires the ADMIN role and both guards for every route', () => {
    expect(Reflect.getMetadata('roles', CommentBackfillController)).toEqual([
      'ADMIN',
    ]);
    const guards = Reflect.getMetadata(
      '__guards__',
      CommentBackfillController,
    ) as { name: string }[];
    expect(guards.map((g) => g.name)).toEqual(['JwtAuthGuard', 'RolesGuard']);
  });
});

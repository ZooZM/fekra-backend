import { AppZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { IdParamDto } from '@common/zod/dtos';
import { ROLES_KEY } from '@app/auth/decorators/roles.decorator';
import { UnprocessableEntityException } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

describe('ServicesController', () => {
  let controller: ServicesController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'remove'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    controller = new ServicesController(service as unknown as ServicesService);
  });

  it('forwards every service endpoint argument', async () => {
    await controller.create({ name: 'A' } as never);
    await controller.findAll({ page: 1 } as never);
    await controller.findById({ id: 's1' });
    await controller.update({ id: 's1' }, { name: 'B' } as never);
    await controller.remove({ id: 's1' });
    expect(service.create).toHaveBeenCalledWith({ name: 'A' });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('s1');
    expect(service.update).toHaveBeenCalledWith('s1', { name: 'B' });
    expect(service.remove).toHaveBeenCalledWith('s1');
  });

  it('rejects an :id that is not a UUID with a 422 before the database', () => {
    const pipe = new AppZodValidationPipe();
    expect(() =>
      pipe.transform(
        { id: 'not-a-uuid' },
        { type: 'param', metatype: IdParamDto },
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('is ADMIN only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ServicesController)).toEqual([
      'ADMIN',
    ]);
  });
});

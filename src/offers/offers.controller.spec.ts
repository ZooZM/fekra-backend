import { UnprocessableEntityException } from '@nestjs/common';
import { AppZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { IdParamDto } from '@common/zod/dtos';
import { ROLES_KEY } from '@app/auth/decorators/roles.decorator';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

describe('OffersController', () => {
  let controller: OffersController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'remove'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    controller = new OffersController(service as unknown as OffersService);
  });

  it('forwards every offer endpoint argument', async () => {
    await controller.create({ title: 'Sale' } as never);
    await controller.findAll({ page: 1 } as never);
    await controller.findById({ id: 'o1' });
    await controller.update({ id: 'o1' }, { title: 'New' } as never);
    await controller.remove({ id: 'o1' });
    expect(service.create).toHaveBeenCalledWith({ title: 'Sale' });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('o1');
    expect(service.update).toHaveBeenCalledWith('o1', { title: 'New' });
    expect(service.remove).toHaveBeenCalledWith('o1');
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
    expect(Reflect.getMetadata(ROLES_KEY, OffersController)).toEqual(['ADMIN']);
  });
});

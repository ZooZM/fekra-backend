import { UnprocessableEntityException } from '@nestjs/common';
import { AppZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { IdParamDto } from '@common/zod/dtos';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

describe('ClientsController', () => {
  let controller: ClientsController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      [
        'create',
        'findAll',
        'findById',
        'update',
        'remove',
        'setAccessToken',
      ].map((name) => [name, jest.fn()]),
    );
    controller = new ClientsController(service as unknown as ClientsService);
  });

  it('forwards client CRUD arguments', async () => {
    await controller.create({ name: 'A' } as never);
    await controller.findAll({ page: 1 } as never);
    await controller.findById({ id: 'c1' });
    await controller.update({ id: 'c1' }, { name: 'B' } as never);
    await controller.remove({ id: 'c1' });
    expect(service.create).toHaveBeenCalledWith({ name: 'A' });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('c1');
    expect(service.update).toHaveBeenCalledWith('c1', { name: 'B' });
    expect(service.remove).toHaveBeenCalledWith('c1');
  });

  it('forwards access-token updates', async () => {
    await controller.setAccessToken({ id: 'c1' }, 'token');
    expect(service.setAccessToken).toHaveBeenCalledWith('c1', 'token');
  });

  it('rejects an :id that is not a UUID (e.g. a Facebook page id) before the database', () => {
    const pipe = new AppZodValidationPipe();
    const validate = (id: string): unknown =>
      pipe.transform({ id }, { type: 'param', metatype: IdParamDto });

    expect(() => validate('114022207011543')).toThrow(
      UnprocessableEntityException,
    );
    expect(validate('8ed9f96d-c790-4279-ba5f-88feec1c68e3')).toEqual({
      id: '8ed9f96d-c790-4279-ba5f-88feec1c68e3',
    });
  });
});

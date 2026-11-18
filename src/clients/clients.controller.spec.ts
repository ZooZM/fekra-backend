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
        'setInstaAccessToken',
      ].map((name) => [name, jest.fn()]),
    );
    controller = new ClientsController(service as unknown as ClientsService);
  });

  const user = { id: 'a1', name: 'Admin', email: 'admin@example.com' } as never;
  const actor = { id: 'a1', name: 'Admin', email: 'admin@example.com' };

  it('forwards client CRUD arguments with the acting admin', async () => {
    await controller.create({ name: 'A' } as never, user);
    await controller.findAll({ page: 1 } as never);
    await controller.findById({ id: 'c1' });
    await controller.update({ id: 'c1' }, { name: 'B', version: 2 }, user);
    await controller.remove({ id: 'c1' }, user);
    expect(service.create).toHaveBeenCalledWith({ name: 'A' }, actor);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('c1');
    expect(service.update).toHaveBeenCalledWith(
      'c1',
      { name: 'B', version: 2 },
      actor,
    );
    expect(service.remove).toHaveBeenCalledWith('c1', actor);
  });

  it('forwards access-token replacement with the acting admin', async () => {
    await controller.setAccessToken({ id: 'c1' }, { token: 'token' }, user);
    expect(service.setAccessToken).toHaveBeenCalledWith('c1', 'token', actor);
  });

  it('forwards Instagram token replacement with the acting admin, never to the Page token', async () => {
    await controller.setInstaAccessToken({ id: 'c1' }, { token: 'ig' }, user);
    expect(service.setInstaAccessToken).toHaveBeenCalledWith('c1', 'ig', actor);
    expect(service.setAccessToken).not.toHaveBeenCalled();
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

describe('ClientsController access rules', () => {
  it('requires the ADMIN role and both guards for every route', () => {
    expect(Reflect.getMetadata('roles', ClientsController)).toEqual(['ADMIN']);
    const guards = Reflect.getMetadata('__guards__', ClientsController) as {
      name: string;
    }[];
    expect(guards.map((g) => g.name)).toEqual(['JwtAuthGuard', 'RolesGuard']);
  });
});

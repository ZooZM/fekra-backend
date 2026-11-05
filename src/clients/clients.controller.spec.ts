import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

describe('ClientsController', () => {
  let controller: ClientsController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'remove', 'setAccessToken']
        .map((name) => [name, jest.fn()]),
    );
    controller = new ClientsController(service as unknown as ClientsService);
  });

  it('forwards client CRUD arguments', async () => {
    await controller.create({ name: 'A' } as never);
    await controller.findAll({ page: 1 } as never);
    await controller.findById('c1');
    await controller.update('c1', { name: 'B' } as never);
    await controller.remove('c1');
    expect(service.create).toHaveBeenCalledWith({ name: 'A' });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('c1');
    expect(service.update).toHaveBeenCalledWith('c1', { name: 'B' });
    expect(service.remove).toHaveBeenCalledWith('c1');
  });

  it('forwards access-token updates', async () => {
    await controller.setAccessToken('c1', 'token');
    expect(service.setAccessToken).toHaveBeenCalledWith('c1', 'token');
  });
});

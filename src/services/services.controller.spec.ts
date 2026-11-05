import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

describe('ServicesController', () => {
  let controller: ServicesController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'remove'].map((name) => [name, jest.fn()]),
    );
    controller = new ServicesController(service as unknown as ServicesService);
  });

  it('forwards every service endpoint argument', async () => {
    await controller.create({ name: 'A' } as never);
    await controller.findAll({ page: 1 } as never);
    await controller.findById('s1');
    await controller.update('s1', { name: 'B' } as never);
    await controller.remove('s1');
    expect(service.create).toHaveBeenCalledWith({ name: 'A' });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('s1');
    expect(service.update).toHaveBeenCalledWith('s1', { name: 'B' });
    expect(service.remove).toHaveBeenCalledWith('s1');
  });
});

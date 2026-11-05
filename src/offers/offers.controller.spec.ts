import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

describe('OffersController', () => {
  let controller: OffersController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'remove'].map((name) => [name, jest.fn()]),
    );
    controller = new OffersController(service as unknown as OffersService);
  });

  it('forwards every offer endpoint argument', async () => {
    await controller.create({ title: 'Sale' } as never);
    await controller.findAll({ page: 1 } as never);
    await controller.findById('o1');
    await controller.update('o1', { title: 'New' } as never);
    await controller.remove('o1');
    expect(service.create).toHaveBeenCalledWith({ title: 'Sale' });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(service.findById).toHaveBeenCalledWith('o1');
    expect(service.update).toHaveBeenCalledWith('o1', { title: 'New' });
    expect(service.remove).toHaveBeenCalledWith('o1');
  });
});

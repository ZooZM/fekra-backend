import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['findById', 'findAll', 'findByEmail', 'adminCreate', 'update', 'adminUpdate', 'remove']
        .map((name) => [name, jest.fn()]),
    );
    controller = new UsersController(service as unknown as UsersService);
  });

  it('routes reads and writes to the corresponding service methods', async () => {
    const id = { id: 'u1' };
    await controller.getMe(id);
    await controller.adminFindAll({ page: 1 } as never);
    await controller.adminGetUserById(id);
    await controller.getUserByEmail('a@b.com');
    await controller.adminCreate({ name: 'A' } as never);
    await controller.updateMe(id, { name: 'B' } as never);
    await controller.adminUpdate(id, { name: 'B' } as never);
    await controller.adminDelete(id);
    expect(service.findById).toHaveBeenNthCalledWith(1, 'u1');
    expect(service.findAll).toHaveBeenCalled();
    expect(service.findByEmail).toHaveBeenCalledWith('a@b.com');
    expect(service.adminCreate).toHaveBeenCalled();
    expect(service.update).toHaveBeenCalledWith('u1', { name: 'B' });
    expect(service.adminUpdate).toHaveBeenCalledWith('u1', { name: 'B' });
    expect(service.remove).toHaveBeenCalledWith('u1');
  });
});

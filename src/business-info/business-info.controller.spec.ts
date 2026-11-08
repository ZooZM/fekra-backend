import { BusinessInfoController } from './business-info.controller';
import { BusinessInfoService } from './business-info.service';

describe('BusinessInfoController', () => {
  let controller: BusinessInfoController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = Object.fromEntries(
      ['create', 'findByClientId', 'update', 'remove'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    controller = new BusinessInfoController(
      service as unknown as BusinessInfoService,
    );
  });

  it('adds the route client id when creating business info', async () => {
    const dto = { description: 'about' };
    await controller.create('c1', dto as never);
    expect(service.create).toHaveBeenCalledWith({
      description: 'about',
      clientId: 'c1',
    });
  });

  it('forwards lookup, update, and removal', async () => {
    const dto = { description: 'updated' };
    await controller.findByClientId('c1');
    await controller.updateByClientId('c1', dto as never);
    await controller.removeByClientId('c1');
    expect(service.findByClientId).toHaveBeenCalledWith('c1');
    expect(service.update).toHaveBeenCalledWith('c1', dto);
    expect(service.remove).toHaveBeenCalledWith('c1');
  });
});

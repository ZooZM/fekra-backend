import { UnprocessableEntityException } from '@nestjs/common';
import { AppZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { ClientIdParamDto } from '@common/zod/dtos';
import { ROLES_KEY } from '@app/auth/decorators/roles.decorator';
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

  it('passes the route client and the body when creating business info', async () => {
    const dto = { phone: '0100' };
    await controller.create({ clientId: 'c1' }, dto as never);
    expect(service.create).toHaveBeenCalledWith('c1', dto);
  });

  it('forwards lookup, update, and removal', async () => {
    const dto = { phone: '0200' };
    await controller.findByClientId({ clientId: 'c1' });
    await controller.updateByClientId({ clientId: 'c1' }, dto as never);
    await controller.removeByClientId({ clientId: 'c1' });
    expect(service.findByClientId).toHaveBeenCalledWith('c1');
    expect(service.update).toHaveBeenCalledWith('c1', dto);
    expect(service.remove).toHaveBeenCalledWith('c1');
  });

  it('rejects a :clientId that is not a UUID with a 422 before the database', () => {
    const pipe = new AppZodValidationPipe();
    expect(() =>
      pipe.transform(
        { clientId: 'x' },
        { type: 'param', metatype: ClientIdParamDto },
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('is ADMIN only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, BusinessInfoController)).toEqual([
      'ADMIN',
    ]);
  });
});

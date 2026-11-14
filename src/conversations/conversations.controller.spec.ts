import { ROLES_KEY } from '@app/auth/decorators/roles.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let service: Record<string, jest.Mock>;
  const user = { id: 'u1', name: 'Admin' } as SafeUser;

  beforeEach(() => {
    service = Object.fromEntries(
      ['findAll', 'findOne', 'findMessages', 'pause', 'resume'].map((m) => [
        m,
        jest.fn(),
      ]),
    );
    controller = new ConversationsController(
      service as unknown as ConversationsService,
    );
  });

  it('delegates the read routes with the signed-in user', () => {
    void controller.findAll({ page: 1 } as never, user);
    void controller.findOne({ chatId: 'c1' }, user);
    void controller.findMessages({ chatId: 'c1' }, { page: 2 } as never, user);

    expect(service.findAll).toHaveBeenCalledWith({ page: 1 }, user);
    expect(service.findOne).toHaveBeenCalledWith('c1', user);
    expect(service.findMessages).toHaveBeenCalledWith('c1', { page: 2 }, user);
  });

  it('delegates pause and resume with the acting admin', () => {
    void controller.pause({ chatId: 'c1' }, { duration: '24h' }, user);
    void controller.resume({ chatId: 'c1' }, user);

    expect(service.pause).toHaveBeenCalledWith('c1', { duration: '24h' }, user);
    expect(service.resume).toHaveBeenCalledWith('c1', user);
  });

  it('allows ADMIN and CLIENT to read, and ADMIN only to pause or resume', () => {
    const roles = (target: object) =>
      Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined;

    expect(roles(ConversationsController)).toEqual(['ADMIN', 'CLIENT']);
    expect(roles(ConversationsController.prototype.findAll)).toBeUndefined();
    expect(roles(ConversationsController.prototype.pause)).toEqual(['ADMIN']);
    expect(roles(ConversationsController.prototype.resume)).toEqual(['ADMIN']);
  });
});

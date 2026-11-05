import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalGuard } from './guards/local.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let service: { registerUser: jest.Mock };

  beforeEach(() => {
    service = { registerUser: jest.fn() };
    controller = new AuthController(service as unknown as AuthService);
  });

  it('registers through the auth service', async () => {
    const dto = { name: 'A' };
    service.registerUser.mockResolvedValue('result');
    await expect(controller.register(dto as never)).resolves.toBe('result');
    expect(service.registerUser).toHaveBeenCalledWith(dto);
  });

  it('returns the authenticated request user on login', () => {
    const request = { user: { id: 'u1' } };
    expect(controller.login(request as never)).toBe(request.user);
  });

  it('uses the local guard on login', () => {
    const guards = Reflect.getMetadata('__guards__', AuthController.prototype.login);
    expect(guards).toContain(LocalGuard);
  });
});

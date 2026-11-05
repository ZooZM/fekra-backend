import { BusinessInfoService } from './business-info.service';
import { BUSINESS_INFO_REPOSITORY } from './repositories/IBusinessInfoRepository.repository';

describe('BusinessInfoService', () => {
  let service: BusinessInfoService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findByClientId', 'update', 'delete'].map((name) => [name, jest.fn()]),
    );
    service = new BusinessInfoService(repo as never);
  });

  it('delegates create, lookup, update, and delete unchanged', async () => {
    const input = { clientId: 'c1', description: 'about' };
    repo.create.mockResolvedValue(input);
    repo.findByClientId.mockResolvedValue(input);
    repo.update.mockResolvedValue(input);
    await expect(service.create(input as never)).resolves.toBe(input);
    await expect(service.findByClientId('c1')).resolves.toBe(input);
    await expect(service.update('c1', input as never)).resolves.toBe(input);
    await service.remove('c1');
    expect(repo.create).toHaveBeenCalledWith(input);
    expect(repo.update).toHaveBeenCalledWith('c1', input);
    expect(repo.delete).toHaveBeenCalledWith('c1');
  });
});

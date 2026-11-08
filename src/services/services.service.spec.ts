import { ServicesService } from './services.service';
import { NotFoundException } from '@nestjs/common';

describe('ServicesService', () => {
  let service: ServicesService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'delete'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    service = new ServicesService(repo as never);
  });

  it('passes create and update data while preserving variants', async () => {
    repo.create.mockResolvedValue({});
    repo.update.mockResolvedValue({});
    const input = { name: 'Photography', variants: [{ name: 'Basic' }] };
    await service.create(input as never);
    await service.update('s1', input as never);
    expect(repo.create).toHaveBeenCalledWith(input);
    expect(repo.update).toHaveBeenCalledWith('s1', input);
  });

  it('delegates list and delete operations', async () => {
    repo.findAll.mockResolvedValue({ data: [], meta: {} });
    await expect(service.findAll({} as never)).resolves.toEqual({
      data: [],
      meta: {},
    });
    await service.remove('s1');
    expect(repo.delete).toHaveBeenCalledWith('s1');
  });

  it('throws when a service is missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

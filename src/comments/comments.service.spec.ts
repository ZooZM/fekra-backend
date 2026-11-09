import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { CommentsService } from './comments.service';

describe('CommentsService', () => {
  let service: CommentsService;
  let repo: { findAll: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    repo = { findAll: jest.fn(), save: jest.fn() };
    service = new CommentsService(repo as never);
  });

  it('forces CLIENT users to their assigned client when listing comments', async () => {
    const user = {
      id: 'user-1',
      roles: [UserRole.CLIENT],
      clientId: 'client-1',
    } as SafeUser;
    const query = {
      page: 1,
      limit: 20,
      orderBy: 'createdAt',
      orderDir: 'desc',
      clientId: 'client-2',
    } as const;
    repo.findAll.mockResolvedValue({ data: [], meta: {} });

    await service.findAll(query, user);

    expect(repo.findAll).toHaveBeenCalledWith(query, 'client-1');
  });

  it('validates and normalizes an internal comment write before saving', async () => {
    repo.save.mockResolvedValue({});

    await service.save({
      clientId: 'ac8f7ab8-399f-4ae4-84e8-0ee2f4bef3a2',
      platform: 'facebook',
      commentId: '123_456',
      comment: '  Hello\u0000  ',
      classification: 'inquiry',
      reason: '  Question  ',
    });

    expect(repo.save).toHaveBeenCalledWith({
      clientId: 'ac8f7ab8-399f-4ae4-84e8-0ee2f4bef3a2',
      platform: 'FACEBOOK',
      commentId: '123_456',
      comment: 'Hello',
      classification: 'INQUIRY',
      reason: 'Question',
    });
  });
});

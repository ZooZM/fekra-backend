import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { ConversationsService } from './conversations.service';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      [
        'findAll',
        'findById',
        'findMessages',
        'findOrCreate',
        'createMessage',
      ].map((method) => [method, jest.fn()]),
    );
    service = new ConversationsService(repo as never);
  });

  it('forces CLIENT users to their assigned client when listing chats', async () => {
    const user = {
      id: 'user-1',
      roles: [UserRole.CLIENT],
      clientId: 'client-1',
    } as SafeUser;
    const query = {
      page: 1,
      limit: 20,
      orderBy: 'updatedAt',
      orderDir: 'desc',
      clientId: 'client-2',
    } as const;
    repo.findAll.mockResolvedValue({ data: [], meta: {} });

    await service.findAll(query, user);

    expect(repo.findAll).toHaveBeenCalledWith(query, 'client-1');
  });

  it('does not return messages from a conversation outside the client scope', async () => {
    const user = {
      id: 'user-1',
      roles: [UserRole.CLIENT],
      clientId: 'client-1',
    } as SafeUser;
    repo.findById.mockResolvedValue(null);

    await expect(
      service.findMessages(
        'f83d1a96-b637-49a7-b66a-4db47ae12345',
        {
          page: 1,
          limit: 20,
          orderBy: 'createdAt',
          orderDir: 'desc',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findMessages).not.toHaveBeenCalled();
  });

  it('validates and normalizes internal chat writes', async () => {
    const input = {
      clientId: 'ac8f7ab8-399f-4ae4-84e8-0ee2f4bef3a2',
      platform: 'instagram',
      senderId: 'customer-1',
      receiverId: 'account-1',
    };
    repo.findOrCreate.mockResolvedValue({});

    await service.findOrCreate(input);

    expect(repo.findOrCreate).toHaveBeenCalledWith({
      ...input,
      platform: 'INSTAGRAM',
    });
  });
});

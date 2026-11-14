import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';

const actor = { id: 'a1', name: 'Admin', email: 'admin@example.com' };

describe('ClientsService chat service rules (features 003 and 004)', () => {
  let service: ClientsService;
  let repo: Record<string, jest.Mock>;

  const stored = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'Acme',
    version: 4,
    chatWorkflowEndpoint: null,
    chatSubscribed: false,
    ...over,
  });

  beforeEach(() => {
    repo = Object.fromEntries(
      [
        'create',
        'findById',
        'update',
        'findMetaAccountConflict',
        'findChatRoute',
        'findChatRouteById',
        'findWorkflowDataFresh',
      ].map((name) => [name, jest.fn()]),
    );
    repo.findMetaAccountConflict.mockResolvedValue(null);
    repo.update.mockResolvedValue({ status: 'updated', record: stored() });
    service = new ClientsService(
      {
        encrypt: jest.fn((v: string) => `enc:${v}`),
        decrypt: jest.fn(),
      } as never,
      repo as never,
    );
  });

  const fieldError = async (promise: Promise<unknown>) => {
    const error = (await promise.catch((e: unknown) => e)) as {
      getResponse: () => {
        errorCode: string;
        details: { fieldErrors: Record<string, string[]> };
      };
    };
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return error.getResponse();
  };

  describe('create', () => {
    it('saves an endpoint without checking other clients: several clients may share a workflow (004)', async () => {
      repo.create.mockResolvedValue({ id: 'new' });

      await service.create(
        {
          name: 'A',
          businessCategory: 'B',
          accessToken: 't',
          chatWorkflowEndpoint: 'chat-shared',
        },
        actor,
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ chatWorkflowEndpoint: 'chat-shared' }),
        actor,
      );
    });
  });

  describe('update', () => {
    it('does not read the client for edits that leave the chat fields alone', async () => {
      await service.update('c1', { name: 'B', version: 4 }, actor);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('refuses to subscribe a client that has no endpoint, with a field error', async () => {
      repo.findById.mockResolvedValue(stored());

      const body = await fieldError(
        service.update('c1', { chatSubscribed: true, version: 4 }, actor),
      );

      expect(body.errorCode).toBe('INPUT_VALIDATION_ERROR');
      expect(body.details.fieldErrors.chatWorkflowEndpoint).toHaveLength(1);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('subscribes a client that already has a stored endpoint', async () => {
      repo.findById.mockResolvedValue(
        stored({ chatWorkflowEndpoint: 'chat-acme' }),
      );
      await service.update('c1', { chatSubscribed: true, version: 4 }, actor);
      expect(repo.update).toHaveBeenCalledWith(
        'c1',
        { chatSubscribed: true },
        4,
        actor,
      );
    });

    it('accepts the endpoint and the subscription in the same edit', async () => {
      repo.findById.mockResolvedValue(stored());
      await service.update(
        'c1',
        { chatWorkflowEndpoint: 'chat-acme', chatSubscribed: true, version: 4 },
        actor,
      );
      expect(repo.update).toHaveBeenCalled();
    });

    it('refuses to remove the endpoint of a subscribed client', async () => {
      repo.findById.mockResolvedValue(
        stored({ chatWorkflowEndpoint: 'chat-acme', chatSubscribed: true }),
      );

      const body = await fieldError(
        service.update('c1', { chatWorkflowEndpoint: null, version: 4 }, actor),
      );

      expect(body.details.fieldErrors.chatWorkflowEndpoint[0]).toMatch(
        /unsubscribe/i,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets an unsubscribed client lose its endpoint, and unsubscribing keeps it', async () => {
      repo.findById.mockResolvedValue(
        stored({ chatWorkflowEndpoint: 'chat-acme', chatSubscribed: true }),
      );
      await service.update('c1', { chatSubscribed: false, version: 4 }, actor);
      await service.update(
        'c1',
        { chatSubscribed: false, chatWorkflowEndpoint: null, version: 4 },
        actor,
      );
      expect(repo.update).toHaveBeenCalledTimes(2);
    });

    it('saves an endpoint another client already uses: workflows can be shared (004)', async () => {
      repo.findById.mockResolvedValue(stored());

      await service.update(
        'c1',
        { chatWorkflowEndpoint: 'chat-shared', version: 4 },
        actor,
      );

      expect(repo.update).toHaveBeenCalledWith(
        'c1',
        { chatWorkflowEndpoint: 'chat-shared' },
        4,
        actor,
      );
    });

    it('answers 404 when the client does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update('c9', { chatSubscribed: false, version: 1 }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('chat route reads', () => {
    it('delegates the three fresh reads to the repository', async () => {
      const route = { clientId: 'c1', chatSubscribed: true };
      repo.findChatRoute.mockResolvedValue(route);
      repo.findChatRouteById.mockResolvedValue(route);
      repo.findWorkflowDataFresh.mockResolvedValue({ id: 'c1' });

      await expect(service.findChatRoute('page-1')).resolves.toBe(route);
      await expect(service.findChatRouteById('c1')).resolves.toBe(route);
      await expect(service.findWorkflowDataFresh('page-1')).resolves.toEqual({
        id: 'c1',
      });
      expect(repo.findChatRoute).toHaveBeenCalledWith('page-1');
      expect(repo.findChatRouteById).toHaveBeenCalledWith('c1');
      expect(repo.findWorkflowDataFresh).toHaveBeenCalledWith('page-1');
    });
  });
});

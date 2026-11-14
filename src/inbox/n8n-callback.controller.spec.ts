import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { N8nSecretGuard } from '@common/guards/n8n-secret.guard';
import { N8nCallbackController } from './n8n-callback.controller';

describe('N8nCallbackController', () => {
  let delivery: { take: jest.Mock };
  let sender: { reply: jest.Mock };
  let commentReply: { handleN8nReply: jest.Mock };
  let controller: N8nCallbackController;

  beforeEach(() => {
    delivery = { take: jest.fn() };
    sender = { reply: jest.fn().mockResolvedValue(undefined) };
    commentReply = { handleN8nReply: jest.fn().mockResolvedValue(undefined) };
    controller = new N8nCallbackController(
      delivery as never,
      sender as never,
      commentReply as never,
    );
  });

  it('is guarded by the shared secret (cases in n8n-secret.guard.spec.ts)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      N8nCallbackController,
    ) as unknown[];
    expect(guards).toEqual([N8nSecretGuard]);
  });

  describe('the body', () => {
    it('needs an id', async () => {
      await expect(controller.callback({ text: 'hi' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts only the two comment types', async () => {
      await expect(
        controller.callback({ id: 'r1', type: 'complaint' as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('handling a callback', () => {
    it('answers acknowledged: false for an unknown or expired id, without sending anything', async () => {
      delivery.take.mockResolvedValue(null);
      await expect(
        controller.callback({ id: 'gone', text: 'hi' }),
      ).resolves.toEqual({ acknowledged: false });
      expect(sender.reply).not.toHaveBeenCalled();
    });

    it('sends the trimmed DM reply of a batch', async () => {
      const payload = { kind: 'batch', id: 'dm-1' };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await expect(
        controller.callback({ id: 'r1', text: '  hello  ' }),
      ).resolves.toEqual({ acknowledged: true });
      expect(sender.reply).toHaveBeenCalledWith(payload, 'hello');
    });

    it('sends nothing when the DM reply is blank, but still acknowledges', async () => {
      delivery.take.mockResolvedValue({
        payload: { kind: 'batch' },
        attempts: 1,
      });
      await expect(
        controller.callback({ id: 'r1', text: '   ' }),
      ).resolves.toEqual({ acknowledged: true });
      expect(sender.reply).not.toHaveBeenCalled();
    });

    it('hands a comment answer to the comment reply service', async () => {
      const payload = { kind: 'comment', id: 'c-1' };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await controller.callback({
        id: 'r1',
        type: 'question',
        publicReply: ' public ',
        dmText: ' dm ',
      });

      expect(commentReply.handleN8nReply).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({
          type: 'question',
          publicReply: 'public',
          dmText: 'dm',
        }),
      );
    });
  });
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { N8nSecretGuard } from '@common/guards/n8n-secret.guard';
import { N8nCallbackController } from './n8n-callback.controller';
import { N8nCallbackDto } from './schemas/n8n-callback.schema';

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

  it('validates the body with its Zod DTO (cases in schemas/n8n-callback.schema.spec.ts)', () => {
    const [bodyType] = Reflect.getMetadata(
      'design:paramtypes',
      N8nCallbackController.prototype,
      'callback',
    ) as unknown[];
    expect(bodyType).toBe(N8nCallbackDto);
  });

  describe('handling a callback', () => {
    it('falls back to engagement and ignores null texts of a comment answer', async () => {
      const payload = { kind: 'comment', id: 'c-1' };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await controller.callback({
        id: 'r1',
        publicReply: ' hi ',
        dmText: null,
      });

      expect(commentReply.handleN8nReply).toHaveBeenCalledWith(payload, {
        type: 'engagement',
        publicReply: 'hi',
        dmText: undefined,
        publicReplyIfDmSent: undefined,
        publicReplyIfDmClosed: undefined,
      });
    });

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
      expect(sender.reply).toHaveBeenCalledWith(payload, 'hello', 'text');
    });

    it('passes the requested voice reply type to the sender', async () => {
      const payload = { kind: 'batch', id: 'dm-voice-1' };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await expect(
        controller.callback({
          id: 'r1',
          text: 'hello',
          replyType: 'voice',
        }),
      ).resolves.toEqual({ acknowledged: true });

      expect(sender.reply).toHaveBeenCalledWith(payload, 'hello', 'voice');
    });

    it('acknowledges recovered batches without sending a duplicate customer reply', async () => {
      const payload = { kind: 'batch', id: 'dm-recovery-1', recovery: true };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await expect(
        controller.callback({ id: 'r1', text: '  hello  ' }),
      ).resolves.toEqual({ acknowledged: true });
      expect(sender.reply).not.toHaveBeenCalled();
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

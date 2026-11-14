import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { N8nCallbackController } from './n8n-callback.controller';

const SECRET = 'n8n-shared-secret';

describe('N8nCallbackController', () => {
  let delivery: { take: jest.Mock };
  let sender: { reply: jest.Mock };
  let commentReply: { handleN8nReply: jest.Mock };
  let secret: string | undefined;
  let controller: N8nCallbackController;

  beforeEach(() => {
    secret = SECRET;
    delivery = { take: jest.fn() };
    sender = { reply: jest.fn().mockResolvedValue(undefined) };
    commentReply = { handleN8nReply: jest.fn().mockResolvedValue(undefined) };
    controller = new N8nCallbackController(
      delivery as never,
      sender as never,
      commentReply as never,
      {
        get: (key: string) =>
          key === 'N8N_WEBHOOK_SECRET' ? secret : undefined,
      } as never,
    );
  });

  describe('the shared secret', () => {
    it.each([
      ['a wrong secret', 'wrong-secret!!!!!!'],
      ['a secret with the right start but a different length', `${SECRET}x`],
      ['a shorter secret', 'n8n'],
      ['an empty secret', ''],
      ['no secret', undefined],
    ])('refuses %s', async (_label, provided) => {
      await expect(
        controller.callback({ id: 'r1', text: 'hi' }, provided),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(delivery.take).not.toHaveBeenCalled();
    });

    it('refuses everything when no secret is configured, even an empty one', async () => {
      secret = undefined;
      await expect(
        controller.callback({ id: 'r1' }, ''),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        controller.callback({ id: 'r1' }, 'anything'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts the right secret', async () => {
      delivery.take.mockResolvedValue(null);
      await expect(controller.callback({ id: 'r1' }, SECRET)).resolves.toEqual({
        acknowledged: false,
      });
    });
  });

  describe('the body', () => {
    it('needs an id', async () => {
      await expect(
        controller.callback({ text: 'hi' }, SECRET),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts only the two comment types', async () => {
      await expect(
        controller.callback({ id: 'r1', type: 'complaint' as never }, SECRET),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('handling a callback', () => {
    it('answers acknowledged: false for an unknown or expired id, without sending anything', async () => {
      delivery.take.mockResolvedValue(null);
      await expect(
        controller.callback({ id: 'gone', text: 'hi' }, SECRET),
      ).resolves.toEqual({ acknowledged: false });
      expect(sender.reply).not.toHaveBeenCalled();
    });

    it('sends the trimmed DM reply of a batch', async () => {
      const payload = { kind: 'batch', id: 'dm-1' };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await expect(
        controller.callback({ id: 'r1', text: '  hello  ' }, SECRET),
      ).resolves.toEqual({ acknowledged: true });
      expect(sender.reply).toHaveBeenCalledWith(payload, 'hello');
    });

    it('sends nothing when the DM reply is blank, but still acknowledges', async () => {
      delivery.take.mockResolvedValue({
        payload: { kind: 'batch' },
        attempts: 1,
      });
      await expect(
        controller.callback({ id: 'r1', text: '   ' }, SECRET),
      ).resolves.toEqual({ acknowledged: true });
      expect(sender.reply).not.toHaveBeenCalled();
    });

    it('hands a comment answer to the comment reply service', async () => {
      const payload = { kind: 'comment', id: 'c-1' };
      delivery.take.mockResolvedValue({ payload, attempts: 1 });

      await controller.callback(
        { id: 'r1', type: 'question', publicReply: ' public ', dmText: ' dm ' },
        SECRET,
      );

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

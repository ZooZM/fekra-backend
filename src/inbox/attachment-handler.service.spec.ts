import { Logger } from '@nestjs/common';
import {
  AttachmentContext,
  AttachmentHandlerService,
} from './attachment-handler.service';

describe('AttachmentHandlerService', () => {
  const ctx: AttachmentContext = {
    platform: 'facebook',
    accountId: '100000000000000',
    senderId: '7000000000000001',
    mid: 'm_1',
    url: 'https://cdn.example.test/attachment',
  };

  let clients: { getClientDataForWorkFlow: jest.Mock };
  let getGenerativeModel: jest.Mock;
  let fetchSpy: jest.SpyInstance;
  let service: AttachmentHandlerService;

  const fetched = (contentType: string) =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': contentType }),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    }) as unknown as Response;

  /** The system instruction of the only model request that was made. */
  const systemInstruction = (): string =>
    (getGenerativeModel.mock.calls[0][0] as { systemInstruction: string })
      .systemInstruction;

  let log: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    clients = {
      getClientDataForWorkFlow: jest.fn().mockResolvedValue({
        name: 'Acme',
        businessCategory: 'Shop',
        aiConfig: { language: 'ARABIC' },
        services: [],
      }),
    };
    getGenerativeModel = jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => 'TRANSCRIPT: hi\nTONE: calm\nLIKELY_INTENT: x',
        },
      }),
    });
    service = new AttachmentHandlerService(clients as never);
    // the Gemini client is created on construction; replace it so no request leaves the test
    (service as unknown as { genAI: unknown }).genAI = { getGenerativeModel };
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends a voice note with the transcription instructions, not the image ones', async () => {
    fetchSpy.mockResolvedValue(fetched('audio/ogg'));

    await service.handleVoiceRecord(ctx);

    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
    expect(systemInstruction()).toBe(await service.buildVoicePrompt(ctx));
    expect(systemInstruction()).toContain('TRANSCRIPTION STEP');
    expect(systemInstruction()).not.toContain('VISION STEP');
  });

  it('sends an image with the image instructions', async () => {
    fetchSpy.mockResolvedValue(fetched('image/jpeg'));

    await service.handleImage(ctx);

    expect(systemInstruction()).toBe(await service.buildImagePrompt(ctx));
    expect(systemInstruction()).toContain('VISION STEP');
  });

  it('sends nothing to the model for a voice note of an unknown account', async () => {
    fetchSpy.mockResolvedValue(fetched('audio/ogg'));
    clients.getClientDataForWorkFlow.mockResolvedValue(null);

    await expect(service.handleVoiceRecord(ctx)).resolves.toBeNull();
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it.each([
    ['voice', 'buildVoicePrompt'],
    ['image', 'buildImagePrompt'],
  ] as const)(
    'lists the service names in the %s prompt, not [object Object]',
    async (_kind, build) => {
      clients.getClientDataForWorkFlow.mockResolvedValue({
        name: 'Acme',
        businessCategory: 'Furniture',
        aiConfig: { language: 'ARABIC' },
        services: [
          { id: 's1', name: 'Corner Sofa' },
          { id: 's2', name: 'Dining Table' },
        ],
      });

      const prompt = (await service[build](ctx)) as string;

      expect(prompt).toContain('Corner Sofa | Dining Table');
      expect(prompt).not.toContain('[object Object]');
    },
  );

  it('keeps customer content (transcripts, descriptions, media URLs) out of the log level', async () => {
    fetchSpy.mockResolvedValue(fetched('audio/ogg'));
    await service.handleVoiceRecord(ctx);
    fetchSpy.mockResolvedValue(fetched('image/jpeg'));
    await service.handleImage(ctx);

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('TRANSCRIPT');
    expect(logged).not.toContain(ctx.url);
    // still available when debugging, which is off in production
    expect(JSON.stringify(debug.mock.calls)).toContain('TRANSCRIPT');
  });
});

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
} from '@google/generative-ai';
import { CommentLlmClassifierService } from './comment-llm-classifier.service';

const generateContent = jest.fn();
const getGenerativeModel = jest.fn(() => ({ generateContent }));

jest.mock('@google/generative-ai', () => {
  const actual = jest.requireActual<typeof import('@google/generative-ai')>(
    '@google/generative-ai',
  );
  return {
    ...actual,
    GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })),
  };
});

const PRIMARY = 'gemini-3.5-flash-lite';
const FALLBACK = 'gemini-3.8-flash';

const client = { name: 'Pet Planet', businessCategory: 'Pet shop' };

const makeService = (env: Record<string, string | undefined>) =>
  new CommentLlmClassifierService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);

const reply = (text: string) =>
  generateContent.mockResolvedValueOnce({ response: { text: () => text } });

const quotaError = () =>
  new GoogleGenerativeAIFetchError(
    'Generate content requests per day limit exceeded on Free Tier',
    429,
    'Too Many Requests',
  );

type ModelParams = {
  model: string;
  systemInstruction: string;
  generationConfig: {
    temperature: number;
    responseMimeType: string;
    thinkingConfig?: { thinkingLevel: string };
  };
};
const modelParams = (call = 0) =>
  (getGenerativeModel.mock.calls[call] as unknown[])[0] as ModelParams;
const modelsUsed = () =>
  getGenerativeModel.mock.calls.map((_, i) => modelParams(i).model);

describe('CommentLlmClassifierService', () => {
  let service: CommentLlmClassifierService;
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    generateContent.mockReset(); // drop persistent mockRejectedValue from earlier tests
    service = makeService({ GEMINI_API_KEY: 'test-key' });
  });

  it.each(['inquiry', 'engagement', 'complaint', 'spam', 'insult'])(
    'returns the "%s" category from the model',
    async (category) => {
      reply(JSON.stringify({ category }));
      await expect(service.classify('some comment', client)).resolves.toEqual({
        type: category,
        reason: `llm ${PRIMARY}`,
      });
    },
  );

  it('tolerates code fences, extra spaces and uppercase', async () => {
    reply('```json\n{ "category": "Complaint" }\n```');
    expect((await service.classify('x', client)).type).toBe('complaint');
  });

  it('tolerates a bare word instead of JSON', async () => {
    reply('"spam"');
    expect((await service.classify('x', client)).type).toBe('spam');
  });

  it('returns unsure, not retryable, when every model gives a category outside the list', async () => {
    reply('{"category":"question"}');
    reply('{"category":"other"}');
    expect(await service.classify('x', client)).toEqual({
      type: 'unsure',
      reason: 'llm failed: invalid output',
    });
  });

  it('returns unsure when every request fails, without throwing', async () => {
    generateContent.mockRejectedValue(new Error('network down'));
    expect(await service.classify('x', client)).toEqual({
      type: 'unsure',
      reason: 'llm failed: request error',
      retryable: true, // e.g. 402 credits depleted, 429, timeout: may work later
    });
  });

  it('returns unsure without calling the model when there is no API key', async () => {
    const noKey = makeService({});
    expect((await noKey.classify('x', client)).type).toBe('unsure');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('skips the model for empty comments', async () => {
    expect((await service.classify('   ', client)).type).toBe('engagement');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('puts the business into the system prompt and wraps the comment as data', async () => {
    reply('{"category":"inquiry"}');
    await service.classify('عندكم اكل كلاب', client);

    const params = modelParams();
    expect(params.systemInstruction).toContain('Name: Pet Planet');
    expect(params.systemInstruction).toContain('Category: Pet shop');
    expect(params.generationConfig.temperature).toBe(0);
    expect(params.generationConfig.responseMimeType).toBe('application/json');

    const [prompt, options] = generateContent.mock.calls[0] as [
      string,
      { timeout: number },
    ];
    expect(prompt).toContain('<comment>\nعندكم اكل كلاب\n</comment>');
    expect(options.timeout).toBe(8000);
  });

  it('truncates very long comments', async () => {
    reply('{"category":"spam"}');
    await service.classify('a'.repeat(5000), client);
    const [prompt] = generateContent.mock.calls[0] as [string];
    expect(prompt.length).toBeLessThan(1100);
  });

  // ─────────────────────────── models and fallback ───────────────────────────

  describe('models and fallback', () => {
    it('uses flash-lite with low thinking by default, one call when it works', async () => {
      reply('{"category":"insult"}');
      await service.classify('التفاصيل يجعر', client);

      expect(modelsUsed()).toEqual([PRIMARY]);
      expect(modelParams().generationConfig.thinkingConfig).toEqual({
        thinkingLevel: 'low',
      });
    });

    it('falls back to the second model on a 429 quota error', async () => {
      generateContent.mockRejectedValueOnce(quotaError());
      reply('{"category":"inquiry"}');

      expect(await service.classify('x', client)).toEqual({
        type: 'inquiry',
        reason: `llm ${FALLBACK}`,
      });
      expect(modelsUsed()).toEqual([PRIMARY, FALLBACK]);
    });

    it('falls back on a timeout and on a 503 overload', async () => {
      generateContent.mockRejectedValueOnce(
        new GoogleGenerativeAIAbortError('Request aborted'),
      );
      reply('{"category":"spam"}');
      expect((await service.classify('x', client)).type).toBe('spam');

      generateContent.mockRejectedValueOnce(
        new GoogleGenerativeAIFetchError('busy', 503, 'Service Unavailable'),
      );
      reply('{"category":"engagement"}');
      expect((await service.classify('x', client)).type).toBe('engagement');
    });

    it('falls back when the first model gives an invalid category', async () => {
      reply('{"category":"question"}');
      reply('{"category":"inquiry"}');
      expect((await service.classify('x', client)).type).toBe('inquiry');
    });

    it('logs why each model failed', async () => {
      generateContent
        .mockRejectedValueOnce(quotaError())
        .mockRejectedValueOnce(new GoogleGenerativeAIAbortError('aborted'));

      await service.classify('x', client);

      expect(warn.mock.calls.map(([msg]) => msg as string)).toEqual([
        `${PRIMARY} failed: 429 Too Many Requests, trying ${FALLBACK}`,
        `${FALLBACK} failed: timeout`,
      ]);
    });

    it('uses the model, fallback and timeout from the environment', async () => {
      const custom = makeService({
        GEMINI_API_KEY: 'k',
        GEMINI_COMMENT_MODEL: 'my-model',
        GEMINI_COMMENT_FALLBACK_MODEL: 'my-fallback',
        GEMINI_COMMENT_TIMEOUT_MS: '3000',
      });
      generateContent.mockRejectedValueOnce(quotaError());
      reply('{"category":"spam"}');
      await custom.classify('x', client);

      expect(modelsUsed()).toEqual(['my-model', 'my-fallback']);
      const [, options] = generateContent.mock.calls[0] as [string, unknown];
      expect(options).toEqual({ timeout: 3000 });
    });

    it('turns the fallback off with an empty GEMINI_COMMENT_FALLBACK_MODEL', async () => {
      const single = makeService({
        GEMINI_API_KEY: 'k',
        GEMINI_COMMENT_FALLBACK_MODEL: '',
      });
      generateContent.mockRejectedValue(quotaError());

      expect((await single.classify('x', client)).retryable).toBe(true);
      expect(modelsUsed()).toEqual([PRIMARY]);
    });

    it('does not call the same model twice when both settings name it', async () => {
      const same = makeService({
        GEMINI_API_KEY: 'k',
        GEMINI_COMMENT_MODEL: FALLBACK,
      });
      generateContent.mockRejectedValue(quotaError());
      await same.classify('x', client);
      expect(modelsUsed()).toEqual([FALLBACK]);
    });

    it('sends no thinking config with an empty GEMINI_COMMENT_THINKING_LEVEL (Gemini 2.5)', async () => {
      const noThinking = makeService({
        GEMINI_API_KEY: 'k',
        GEMINI_COMMENT_MODEL: 'gemini-2.5-flash',
        GEMINI_COMMENT_THINKING_LEVEL: '',
      });
      reply('{"category":"spam"}');
      await noThinking.classify('x', client);
      expect(modelParams().generationConfig).not.toHaveProperty(
        'thinkingConfig',
      );
    });
  });
});

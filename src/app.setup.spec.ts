import { configureApp, parseOrigins } from './app.setup';

jest.mock('cookie-parser', () => jest.fn(() => 'cookie-middleware'));

function makeApp(env: Record<string, string | undefined>) {
  const app = {
    get: jest.fn(() => ({ get: (k: string) => env[k] })),
    use: jest.fn(),
    enableCors: jest.fn(),
    useGlobalPipes: jest.fn(),
    enableShutdownHooks: jest.fn(),
  };
  return app;
}

describe('parseOrigins', () => {
  it('splits, trims and drops empty entries', () => {
    expect(parseOrigins(' https://a.com, ,https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('')).toEqual([]);
  });
});

describe('configureApp', () => {
  it('applies cookie-parser, pipes and shutdown hooks, with no CORS by default', () => {
    const app = makeApp({});
    configureApp(app as never);
    expect(app.use).toHaveBeenCalledWith('cookie-middleware');
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalled();
    expect(app.enableCors).not.toHaveBeenCalled();
  });

  it('adds no second Zod pass: AppModule already validates with AppZodValidationPipe', () => {
    const app = makeApp({});
    configureApp(app as never);

    const pipes = app.useGlobalPipes.mock.calls[0] as {
      constructor: { name: string };
    }[];
    expect(pipes.map((pipe) => pipe.constructor.name)).toEqual([
      'ValidationPipe',
    ]);
  });

  it('enables CORS with credentials only for the listed origins', () => {
    const app = makeApp({ CORS_ORIGINS: 'https://admin.example.com' });
    configureApp(app as never);
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['https://admin.example.com'],
      credentials: true,
    });
  });
});

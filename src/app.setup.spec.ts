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

  it('enables CORS with credentials only for the listed origins', () => {
    const app = makeApp({ CORS_ORIGINS: 'https://admin.example.com' });
    configureApp(app as never);
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['https://admin.example.com'],
      credentials: true,
    });
  });
});

import { ForbiddenException } from '@nestjs/common';
import { OriginGuard } from './origin.guard';

describe('OriginGuard', () => {
  const run = (origin: string | undefined, env: Record<string, string>) => {
    const guard = new OriginGuard({ get: (k: string) => env[k] } as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: { origin } }) }),
    };
    return () => guard.canActivate(context as never);
  };

  it('allows the dashboard origin', () => {
    expect(
      run('https://app.example.com', {
        APP_ORIGIN: 'https://app.example.com',
      })(),
    ).toBe(true);
  });

  it('allows an origin from the CORS allowlist', () => {
    expect(
      run('https://other.example.com', {
        APP_ORIGIN: 'https://app.example.com',
        CORS_ORIGINS: 'https://x.com, https://other.example.com',
      })(),
    ).toBe(true);
  });

  it.each([
    ['another origin', 'https://evil.example.com'],
    ['a missing Origin header', undefined],
  ])('refuses %s', (_n, origin) => {
    expect(run(origin, { APP_ORIGIN: 'https://app.example.com' })).toThrow(
      ForbiddenException,
    );
  });

  it('refuses everything when no origin is configured', () => {
    expect(run('https://app.example.com', {})).toThrow(ForbiddenException);
  });
});

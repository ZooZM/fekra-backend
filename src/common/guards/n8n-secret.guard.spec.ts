import { UnauthorizedException } from '@nestjs/common';
import { N8nSecretGuard, secretMatches } from './n8n-secret.guard';

const SECRET = 'n8n-shared-secret';

describe('N8nSecretGuard', () => {
  let configured: string | undefined;
  let guard: N8nSecretGuard;

  const context = (headers: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as never;

  beforeEach(() => {
    configured = SECRET;
    guard = new N8nSecretGuard({
      get: (key: string) =>
        key === 'N8N_WEBHOOK_SECRET' ? configured : undefined,
    } as never);
  });

  it('lets the right secret through', () => {
    expect(guard.canActivate(context({ 'x-webhook-secret': SECRET }))).toBe(
      true,
    );
  });

  it.each([
    ['a wrong secret of the same length', 'n8n-shared-secreT'],
    ['a secret with the right start but a different length', `${SECRET}x`],
    ['a shorter secret', 'n8n'],
    ['an empty secret', ''],
    ['a secret sent twice', [SECRET, SECRET]],
  ])('refuses %s with 401', (_label, provided) => {
    expect(() =>
      guard.canActivate(context({ 'x-webhook-secret': provided })),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a request without the header', () => {
    expect(() => guard.canActivate(context({}))).toThrow(UnauthorizedException);
  });

  it('refuses everything when no secret is configured, even an empty one', () => {
    configured = undefined;
    expect(() =>
      guard.canActivate(context({ 'x-webhook-secret': '' })),
    ).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(context({ 'x-webhook-secret': 'anything' })),
    ).toThrow(UnauthorizedException);
    configured = '';
    expect(() =>
      guard.canActivate(context({ 'x-webhook-secret': '' })),
    ).toThrow(UnauthorizedException);
  });

  it('reads the secret on every request, so a changed value applies', () => {
    expect(guard.canActivate(context({ 'x-webhook-secret': SECRET }))).toBe(
      true,
    );
    configured = 'rotated-secret';
    expect(() =>
      guard.canActivate(context({ 'x-webhook-secret': SECRET })),
    ).toThrow(UnauthorizedException);
  });
});

describe('secretMatches', () => {
  it('compares equal-length values in constant time', () => {
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abd', 'abc')).toBe(false);
  });

  it('compares byte lengths, so a multi-byte character never makes it throw', () => {
    // same string length (1), different byte length (2 vs 1)
    expect(secretMatches('é', 'a')).toBe(false);
    expect(secretMatches('éé', 'éé')).toBe(true);
  });

  it('is false when either side is missing', () => {
    expect(secretMatches(undefined, 'abc')).toBe(false);
    expect(secretMatches('abc', undefined)).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });
});

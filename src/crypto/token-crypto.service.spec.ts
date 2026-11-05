import { TokenCryptoService } from './token-crypto.service';

describe('TokenCryptoService', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it.each(['', 'abc', 'g'.repeat(64), '0'.repeat(63)])(
    'rejects invalid key %s',
    (invalid) => {
      expect(() => new TokenCryptoService({ get: () => invalid } as never)).toThrow(
        'TOKEN_ENCRYPTION_KEY must be 64 hex characters',
      );
    },
  );

  it('round-trips plaintext with the matching AAD', () => {
    const service = new TokenCryptoService({ get: () => key } as never);
    const payload = service.encrypt('secret value', 'client-1');
    expect(payload).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(service.decrypt(payload, 'client-1')).toBe('secret value');
    expect(service.isEncrypted(payload)).toBe(true);
    expect(service.isEncrypted('plain')).toBe(false);
  });

  it('uses a fresh IV and rejects malformed, wrong-AAD, and tampered values', () => {
    const service = new TokenCryptoService({ get: () => key } as never);
    const first = service.encrypt('same', 'client-1');
    const second = service.encrypt('same', 'client-1');
    expect(second).not.toBe(first);
    expect(() => service.decrypt('v2:a:b:c', 'client-1')).toThrow(
      'Unsupported or malformed encrypted value',
    );
    expect(() => service.decrypt(first, 'client-2')).toThrow();
    const [version, iv, tag, data] = first.split(':');
    const tampered = [version, iv, tag, (data[0] === 'A' ? 'B' : 'A') + data.slice(1)].join(':');
    expect(() => service.decrypt(tampered, 'client-1')).toThrow();
  });
});

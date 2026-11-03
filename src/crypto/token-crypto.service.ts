// crypto/token-crypto.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

@Injectable()
export class TokenCryptoService {
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const hex = this.configService.get('TOKEN_ENCRYPTION_KEY');
    if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
      );
    }
    this.key = Buffer.from(hex, 'hex');
  }

  /** `aad` (e.g. the client id) binds the ciphertext to its row, so it can't be copied to another row. */
  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(12); // fresh random IV for every encryption
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string, aad: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== VERSION || !iv || !tag || !data) {
      throw new Error('Unsupported or malformed encrypted value');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(), // throws if the key, AAD, or data is wrong or tampered with
    ]).toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(`${VERSION}:`);
  }
}

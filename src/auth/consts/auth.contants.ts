import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

let dummyHash: string | undefined;

export const getDummyHash = (): string =>
  (dummyHash ??= bcrypt.hashSync(
    randomBytes(16).toString('hex'),
    BCRYPT_ROUNDS,
  ));

export const hash = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_ROUNDS);

export const compare = (
  password: string,
  passwordHash: string,
): Promise<boolean> => bcrypt.compare(password, passwordHash);

export class ConfigService {
  get<T>(_key: string): T | undefined {
    return undefined;
  }

  getOrThrow<T>(key: string): T {
    throw new Error(`Missing config value: ${key}`);
  }
}

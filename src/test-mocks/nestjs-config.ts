export class ConfigService {
  get<T>(key: string): T | undefined {
    return undefined;
  }

  getOrThrow<T>(key: string): T {
    throw new Error(`Missing config value: ${key}`);
  }
}

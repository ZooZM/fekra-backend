export const AuthGuard = (_name: string) =>
  class {
    canActivate(): boolean {
      return true;
    }
  };

// Lets strategies be constructed directly in unit tests.
export const PassportStrategy = (_strategy: unknown) => class {};

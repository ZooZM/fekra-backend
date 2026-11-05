export const AuthGuard = (_name: string) =>
  class {
    canActivate(): boolean {
      return true;
    }
  };

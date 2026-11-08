import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  // Passport guards run before pipes, so the email is normalized here (trim + lowercase)
  // by validateUser before the throttle check and the user lookup.
  async validate(email: string, password: string) {
    return this.authService.validateUser(email, password);
  }
}

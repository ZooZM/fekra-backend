import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '@app/users/users.service';
import {
  SafeUser,
  SafeUserWithPasswordChangedAt,
} from '@app/users/types/safe-user.type';
import { SessionService } from '../session.service';

interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<SafeUser> {
    // signing out (or the 12 h limit) must stop every access token of that session
    if (payload.sid && !(await this.sessions.isActive(payload.sid))) {
      throw new UnauthorizedException();
    }

    let user: SafeUserWithPasswordChangedAt;
    try {
      user = await this.usersService.findByIdWithPassowrdChangedAt(payload.sub);
    } catch (e) {
      if (e instanceof NotFoundException) throw new UnauthorizedException();
      throw e;
    }

    // Reject tokens issued before the last password change
    if (
      user.passwordChangedAt &&
      payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException(
        'Password was changed, please log in again',
      );
    }

    return user;
  }
}

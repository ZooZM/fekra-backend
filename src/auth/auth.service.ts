import { UsersService } from '@app/users/users.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { SafeUser } from '@app/users/types/safe-user.type';
import * as authConstants from './consts/auth.contants';
import { RegisterUserInput } from './schemas/auth.schema';
import { CreateUserInput } from '@app/users/schemas/user.schema';
import { SessionService } from './session.service';
import { LoginThrottleService } from './login-throttle.service';

export interface LoginResult {
  user: SafeUser;
  token: string;
  /** Cookie value and expiry for the controller to set; never part of the response body. */
  session: { cookieValue: string; expiresAt: Date };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
  ) {}

  async generateJwt(payload: JwtPayload): Promise<string> {
    const token = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.configService.getOrThrow<string>('JWT_EXPIRES_IN') as any,
    });

    return token;
  }

  async validateUser(rawEmail: string, password: string): Promise<LoginResult> {
    const email = rawEmail.trim().toLowerCase();
    const blocked = await this.throttle.isBlocked(email);

    const user = blocked
      ? null
      : await this.usersService.findByEmailWithPassword(email);

    // always run bcrypt, so timing doesn't reveal an unknown email or an active block
    const isMatch = await authConstants.compare(
      password,
      user?.passwordHash ?? authConstants.getDummyHash(),
    );

    if (blocked || !user || !isMatch) {
      if (!blocked) await this.throttle.recordFailure(email);
      // the same error for a wrong password, an unknown email and a block
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.throttle.reset(email);
    const session = await this.sessions.start(user.id);
    const token = await this.generateJwt({
      sub: user.id,
      userRoles: user.roles,
      sid: session.sessionId,
    });

    const { passwordHash: _passwordHash, ...safeUser } = user;
    return {
      user: safeUser,
      token,
      session: {
        cookieValue: session.cookieValue,
        expiresAt: session.expiresAt,
      },
    };
  }

  async registerUser(
    registerUserDto: RegisterUserInput,
  ): Promise<{ user: SafeUser; token: string }> {
    const passwordHash = await authConstants.hash(registerUserDto.password);
    const createUserDto: CreateUserInput = {
      name: registerUserDto.name,
      email: registerUserDto.email,
      passwordHash,
    };

    const user = await this.usersService.create(createUserDto);

    const token = await this.generateJwt({
      sub: user.id,
      userRoles: user.roles,
    });
    return { user, token };
  }
}

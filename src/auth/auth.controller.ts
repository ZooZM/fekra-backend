import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { AuthSessionDto } from './schemas/auth-session.schema';
import { CookieOptions, Request, Response } from 'express';
import { UsersService } from '@app/users/users.service';
import { AuthService, LoginResult } from './auth.service';
import { SessionService } from './session.service';
import { LocalGuard } from './guards/local.guard';
import { OriginGuard } from './guards/origin.guard';
import { RegisterUserDto } from './schemas/auth.schema';
import { SESSION_COOKIE } from './consts/session.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @ApiCreatedResponse({ type: AuthSessionDto })
  register(@Body() dto: RegisterUserDto) {
    return this.authService.registerUser(dto);
  }

  /** Returns the access token and sets the httpOnly session cookie. */
  @Post('login')
  @ApiCreatedResponse({ type: AuthSessionDto })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', maxLength: 255 },
        password: { type: 'string', minLength: 8, maxLength: 72 },
      },
    },
  })
  @UseGuards(LocalGuard)
  login(@Req() request: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token, session } = request.user as unknown as LoginResult;
    res.cookie(
      SESSION_COOKIE,
      session.cookieValue,
      this.cookieOptions(session.expiresAt.getTime() - Date.now()),
    );
    return { user, token };
  }

  /** New access token from the session cookie; extends the idle window. */
  @Post('refresh')
  @ApiOkResponse({ type: AuthSessionDto })
  @UseGuards(OriginGuard)
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const session = await this.sessions.refresh(this.sessionCookie(request));
      const user = await this.users.findById(session.userId);
      const token = await this.authService.generateJwt({
        sub: user.id,
        userRoles: user.roles,
        sid: session.sessionId,
      });
      return { user, token };
    } catch (err) {
      res.clearCookie(SESSION_COOKIE, this.cookieOptions());
      // a deleted user is the same as an expired session for the browser
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({
        message: 'Session expired',
        errorCode: 'SESSION_EXPIRED',
      });
    }
  }

  /** Ends the session now: its access tokens stop working on their next request. */
  @Post('logout')
  @UseGuards(OriginGuard)
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(this.sessionCookie(request));
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private sessionCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[SESSION_COOKIE];
  }

  private cookieOptions(maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: this.config.get<string>('SESSION_COOKIE_PATH') ?? '/auth',
      ...(maxAge !== undefined && { maxAge }),
    };
  }
}

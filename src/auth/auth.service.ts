import { UsersService } from '@app/users/users.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { SafeUser } from '@app/users/types/safe-user.type';
import * as authConstants from './consts/auth.contants';
import { RegisterUserInput } from './schemas/auth.schema';
import { CreateUserInput } from '@app/users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async generateJwt(payload: JwtPayload): Promise<string> {
    const token = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.configService.getOrThrow<string>('JWT_EXPIRES_IN') as any,
    });

    return token;
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<{ user: SafeUser; token: string }> {
    const user = await this.usersService.findByEmailWithPassword(email);

    const isMatch = await authConstants.compare(
      password,
      user?.passwordHash ?? authConstants.getDummyHash(),
    );
    if (!user || !isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = await this.generateJwt({
      sub: user.id,
      userRoles: user.roles,
    });

    const { passwordHash, ...safeUser } = user;
    return { user: safeUser, token };
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

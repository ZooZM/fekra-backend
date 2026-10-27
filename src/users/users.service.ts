import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IUsersRepository,
  USERS_REPOSITORY,
} from './repositories/IUsersRepository.repository';
import { SafeUser, UserWithPassword } from './types/safe-user.type';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { QueryUserDto } from './dto/query-user.dto';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@app/generated/prisma/enums';
import { CreateUserDto } from './dto/create-user.dto';
import * as authConstants from '@app/auth/consts/auth.contants';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';

const normalizeEmail = (email: string) => email.toLowerCase().trim();

// TODO: create the createUserDto and updateUserDto
@Injectable()
export class UsersService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  // ───────────── Reads ─────────────

  findAll(query?: QueryUserDto): Promise<PaginatedResult<SafeUser>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<SafeUser> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Used by the auth module (returns null instead of throwing)
  findByEmail(email: string): Promise<SafeUser | null> {
    return this.repo.findByEmail(normalizeEmail(email));
  }

  findByEmailWithPassword(email: string): Promise<UserWithPassword | null> {
    return this.repo.findByEmailWithPassword(normalizeEmail(email));
  }

  // ───────────── Create ─────────────

  /**
   * Public signup (auth module) passes a plain CreateUserDto, so roles/clientId are
   * undefined and the DB default role applies. Only the admin endpoint can set them.
   * A duplicate email throws P2002, which the exception filter turns into a 409.
   */
  async create(createUserDto: CreateUserDto): Promise<SafeUser> {
    return await this.repo.create({
      name: createUserDto.name,
      email: normalizeEmail(createUserDto.email),
      passwordHash: createUserDto.passwordHash,
    });
  }

  async adminCreate(adminCreateUserDto: AdminCreateUserDto): Promise<SafeUser> {
    const passwordHash = await authConstants.hash(adminCreateUserDto.password);

    return await this.repo.create({
      name: adminCreateUserDto.name,
      email: normalizeEmail(adminCreateUserDto.email),
      passwordHash,
      roles: adminCreateUserDto.roles,
      clientId: adminCreateUserDto.clientId,
    });
  }

  // ───────────── Profile update (name only) ─────────────

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    if (dto.name === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    return this.repo.update(id, { name: dto.name });
  }

  async adminUpdate(
    id: string,
    adminUpdateDto: AdminUpdateUserDto,
  ): Promise<SafeUser> {
    let passwordHash: string | undefined;
    if (adminUpdateDto.password !== undefined) {
      passwordHash = await authConstants.hash(adminUpdateDto.password);
    }

    return this.repo.update(id, {
      name: adminUpdateDto.name,
      email: adminUpdateDto.email,
      passwordHash: passwordHash !== undefined ? passwordHash : undefined,
      roles: adminUpdateDto.roles,
      clientId: adminUpdateDto.clientId,
    });
  }

  // ───────────── Sensitive changes (called from auth / admin code only) ─────────────

  /** The caller must already have verified the current password or a valid reset token. */
  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await authConstants.hash(newPassword);
    await this.repo.updatePasswordHash(id, passwordHash);
  }

  updateEmail(id: string, email: string): Promise<SafeUser> {
    return this.repo.updateEmail(id, normalizeEmail(email));
  }

  setRoles(id: string, roles: UserRole[]): Promise<SafeUser> {
    return this.repo.setRoles(id, roles);
  }

  /** Pass the HASH of the token (e.g. SHA-256), never the raw token. */
  setResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    return this.repo.setResetToken(id, tokenHash, expiresAt);
  }

  // ───────────── Delete ─────────────

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }
}

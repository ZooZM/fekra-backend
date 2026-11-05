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
import {
  SafeUser,
  SafeUserWithPassword,
  SafeUserWithPasswordChangedAt,
} from './types/safe-user.type';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { UserRole } from '@app/generated/prisma/enums';
import * as authConstants from '@app/auth/consts/auth.contants';
import {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  CreateUserInput,
  QueryUserInput,
  UpdateUserInput,
} from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  // ───────────── Reads ─────────────

  findAll(query: QueryUserInput): Promise<PaginatedResult<SafeUser>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<SafeUser> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByIdWithPassowrdChangedAt(
    id: string,
  ): Promise<SafeUserWithPasswordChangedAt> {
    const user = await this.repo.findByIdWithPassowrdChangedAt(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Used by the auth module (returns null instead of throwing)
  findByEmail(email: string): Promise<SafeUser | null> {
    return this.repo.findByEmail(email);
  }

  findByEmailWithPassword(email: string): Promise<SafeUserWithPassword | null> {
    return this.repo.findByEmailWithPassword(email);
  }

  // ───────────── Create ─────────────

  /**
   * Public signup (auth module) passes a plain CreateUserInput, so roles/clientId are
   * undefined and the DB default role applies. Only the admin endpoint can set them.
   * A duplicate email throws P2002, which the exception filter turns into a 409.
   */
  async create(input: CreateUserInput): Promise<SafeUser> {
    return await this.repo.create({
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
    });
  }

  async adminCreate(input: AdminCreateUserInput): Promise<SafeUser> {
    const passwordHash = await authConstants.hash(input.password);

    return await this.repo.create({
      name: input.name,
      email: input.email,
      passwordHash,
      roles: input.roles,
      clientId: input.clientId,
    });
  }

  // ───────────── Profile update (name only) ─────────────

  async update(id: string, input: UpdateUserInput): Promise<SafeUser> {
    if (input.name === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    return this.repo.update(id, { name: input.name });
  }

  async adminUpdate(
    id: string,
    input: AdminUpdateUserInput,
  ): Promise<SafeUser> {
    let passwordHash: string | undefined;
    if (input.password !== undefined) {
      passwordHash = await authConstants.hash(input.password);
    }

    return this.repo.update(id, {
      name: input.name,
      email: input.email,
      passwordHash: passwordHash !== undefined ? passwordHash : undefined,
      roles: input.roles,
      clientId: input.clientId,
    });
  }

  // ───────────── Sensitive changes (called from auth / admin code only) ─────────────

  /** The caller must already have verified the current password or a valid reset token. */
  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await authConstants.hash(newPassword);
    await this.repo.updatePasswordHash(id, passwordHash);
  }

  updateEmail(id: string, email: string): Promise<SafeUser> {
    return this.repo.updateEmail(id, email);
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

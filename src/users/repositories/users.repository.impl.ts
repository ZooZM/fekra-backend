import { Injectable, Logger } from '@nestjs/common';
import { IUsersRepository } from './IUsersRepository.repository';
import { QueryUserDto } from '../dto/query-user.dto';
import { UpdateUserData } from '../interfaces/update-user-data.interface';
import { paginate, PaginatedResult } from '@common/helpers/pagination.helper';
import { CreateUserData } from '../interfaces/create-user-data.interface';
import { PrismaService } from '@app/prisma/prisma.service';
import { Prisma, User, UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '../types/safe-user.type';

const ALLOWED_ORDER_FIELDS = ['name', 'email', 'createdAt'] as const;

type OrderField = (typeof ALLOWED_ORDER_FIELDS)[number];

@Injectable()
export class UsersRepository implements IUsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query = new QueryUserDto(),
  ): Promise<PaginatedResult<SafeUser>> {
    const where: Prisma.UserWhereInput = {
      ...(query.email && { email: query.email.toLowerCase() }),
      ...(query.name && { name: query.name }),
    };

    const orderBy: OrderField = ALLOWED_ORDER_FIELDS.includes(
      query.orderBy as OrderField,
    )
      ? (query.orderBy as OrderField)
      : 'createdAt';
    const direction: Prisma.SortOrder =
      query.orderDir === 'asc' ? 'asc' : 'desc';
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [
          { [orderBy]: direction },
          { id: 'asc' }, // tiebreaker so pages stay stable
        ],
        skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    this.logger.debug(`findAll → ${data.length}/${total} users`);
    return paginate(data, total, query.page, query.limit);
  }

  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    this.logger.debug(`findById(${id}) → ${user ? 'found' : 'not found'}`);
    return user;
  }

  async findByEmail(email: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    this.logger.debug(
      `findByEmail(${email}) → ${user ? 'found' : 'not found'}`,
    );
    return user;
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      omit: { passwordHash: false },
    });

    this.logger.debug(
      `findByEmail(${email}) → ${user ? 'found' : 'not found'}`,
    );
    return user;
  }

  async create(data: CreateUserData): Promise<SafeUser> {
    const user = await this.prisma.user.create({ data });

    this.logger.debug(`create → user ${user.id} created`);
    return user;
  }

  async update(id: string, data: UpdateUserData): Promise<SafeUser> {
    const update = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );
    const result = await this.prisma.user.update({
      where: { id },
      data: update,
    });

    this.logger.debug(`update(${id}), data(${data}), result(${result})))`);

    return result;
  }

  async delete(id: string): Promise<void> {
    const res = await this.prisma.user.delete({
      where: { id },
    });

    this.logger.debug(`delete(${id}), deletedUser(${res})`);
  }

  findByValidResetToken(tokenHash: string): Promise<SafeUser | null> {
    return this.prisma.user.findFirst({
      where: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
    ]);
    this.logger.debug(`updatePasswordHash(${id}) → done`);
  }

  async updateEmail(id: string, email: string): Promise<SafeUser> {
    return this.prisma.user.update({ where: { id }, data: { email } });
  }

  async setRoles(id: string, roles: UserRole[]): Promise<SafeUser> {
    return this.prisma.user.update({ where: { id }, data: { roles } });
  }

  async setResetToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
    });
  }
}

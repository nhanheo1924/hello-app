import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Pick<
      Prisma.UserCreateInput,
      | 'email'
      | 'passwordHash'
      | 'fullName'
      | 'displayName'
      | 'firstName'
      | 'lastName'
    >,
  ): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByIds(ids: string[]): Promise<User[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.user.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  updateById(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }
}

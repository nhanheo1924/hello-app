import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { FindUserByEmailQueryDto } from './dto/find-user-by-email-query.dto';
import { FindUsersByIdsQueryDto } from './dto/find-users-by-ids-query.dto';
import { UsersService } from './users.service';

@Controller('internal/users')
export class InternalUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('by-email')
  async getByEmail(@Query() query: FindUserByEmailQueryDto) {
    const email = query.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        systemRole: user.systemRole,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        fullName: user.fullName,
      },
    };
  }

  @Get('by-ids')
  async getByIds(@Query() query: FindUsersByIdsQueryDto) {
    const uniqueIds = Array.from(new Set(query.ids || []));
    if (uniqueIds.length === 0) {
      return { users: [] };
    }

    const users = await this.usersService.findByIds(uniqueIds);
    return {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        systemRole: user.systemRole,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      })),
    };
  }
}

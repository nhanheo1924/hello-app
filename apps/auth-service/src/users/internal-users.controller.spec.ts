import { NotFoundException } from '@nestjs/common';
import { InternalUsersController } from './internal-users.controller';

describe('InternalUsersController', () => {
  it('returns users by ids', async () => {
    const usersService = {
      findByEmail: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'member@example.com',
          status: 'ACTIVE',
          systemRole: 'USER',
          firstName: 'Member',
          lastName: 'One',
          displayName: 'Member One',
          fullName: 'Member One',
          avatarUrl: null,
        },
      ]),
    } as any;

    const controller = new InternalUsersController(usersService);
    const response = await controller.getByIds({
      ids: ['11111111-1111-4111-8111-111111111111'],
    });

    expect(response).toMatchObject({
      users: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'member@example.com',
          displayName: 'Member One',
        },
      ],
    });
    expect(usersService.findByIds).toHaveBeenCalledWith([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('throws USER_NOT_FOUND when lookup by email is missing', async () => {
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByIds: jest.fn(),
    } as any;
    const controller = new InternalUsersController(usersService);

    await expect(
      controller.getByEmail({ email: 'missing@example.com' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

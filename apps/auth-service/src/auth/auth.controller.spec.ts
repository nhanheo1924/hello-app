import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
    verifyTwoFactorLogin: jest.fn(),
    beginTwoFactorSetup: jest.fn(),
    confirmTwoFactorSetup: jest.fn(),
    disableTwoFactor: jest.fn(),
    logout: jest.fn(),
    listSessions: jest.fn(),
    revokeSession: jest.fn(),
    revokeOtherSessions: jest.fn(),
    getGoogleAuthorizationUrl: jest.fn(),
    loginWithGoogleAuthCode: jest.fn(),
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    getAdminSecurityDashboard: jest.fn(),
    listAdminUsers: jest.fn(),
    updateAdminUserStatus: jest.fn(),
    updateAdminUserSystemRole: jest.fn(),
    listAdminUserSessions: jest.fn(),
    revokeAdminUserSessions: jest.fn(),
    listAdminAuditLogs: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'NODE_ENV') {
        return 'development';
      }
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('login should return auth payload without setting refresh cookie', async () => {
    const user = {
      id: 'u1',
      email: 'user@example.com',
      status: 'ACTIVE',
      systemRole: 'USER',
      firstName: 'User',
      lastName: null,
      displayName: 'User',
      dob: null,
      address: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      fullName: 'User',
      twoFactorEnabled: false,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    };
    authServiceMock.login.mockResolvedValue({
      accessToken: 'access-token',
      expiresIn: 900,
      session: { sid: 'sid-1' },
      user,
    });

    const request = {
      ip: '127.0.0.1',
      get: jest.fn((headerName: string) => {
        if (headerName === 'user-agent') {
          return 'jest-test-agent';
        }
        return undefined;
      }),
    } as unknown as Request;

    const result = await controller.login(
      {
        email: 'user@example.com',
        password: 'Password1',
      },
      request,
    );

    expect(authServiceMock.login).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        password: 'Password1',
      },
      {
        ip: '127.0.0.1',
        userAgent: 'jest-test-agent',
        deviceId: null,
      },
    );
    expect(result).toEqual({
      accessToken: 'access-token',
      expiresIn: 900,
      session: { sid: 'sid-1' },
      user: expect.objectContaining({
        id: 'u1',
        email: 'user@example.com',
        fullName: 'User',
      }),
    });
  });

  it('logout should revoke the current access-token session', async () => {
    authServiceMock.logout.mockResolvedValue({ success: true });

    const result = await controller.logout('user-1', 'sid-1');

    expect(authServiceMock.logout).toHaveBeenCalledWith('user-1', 'sid-1');
    expect(result).toEqual({ success: true });
  });

  it('admin users should delegate query to service', async () => {
    authServiceMock.listAdminUsers.mockResolvedValue({
      data: [{ id: 'u1', email: 'a@example.com' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const query = {
      page: 1,
      limit: 20,
      q: 'a@',
    };
    const result = await controller.adminUsers('admin-1', query as any);

    expect(authServiceMock.listAdminUsers).toHaveBeenCalledWith('admin-1', query);
    expect(result).toEqual({
      data: [{ id: 'u1', email: 'a@example.com' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('admin update user status should call service with dto status', async () => {
    authServiceMock.updateAdminUserStatus.mockResolvedValue({
      data: { id: 'u2', status: 'LOCKED' },
    });

    const result = await controller.adminUpdateUserStatus(
      'admin-1',
      'u2',
      { status: 'LOCKED' } as any,
    );

    expect(authServiceMock.updateAdminUserStatus).toHaveBeenCalledWith(
      'admin-1',
      'u2',
      'LOCKED',
    );
    expect(result).toEqual({
      data: { id: 'u2', status: 'LOCKED' },
    });
  });

  it('admin revoke user sessions should pass optional session id', async () => {
    authServiceMock.revokeAdminUserSessions.mockResolvedValue({
      data: { revoked: 1 },
    });

    const result = await controller.adminRevokeUserSessions(
      'admin-1',
      'u2',
      { sessionId: 'sid-2' } as any,
    );

    expect(authServiceMock.revokeAdminUserSessions).toHaveBeenCalledWith(
      'admin-1',
      'u2',
      'sid-2',
    );
    expect(result).toEqual({ data: { revoked: 1 } });
  });
});

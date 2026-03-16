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
      fullName: 'User',
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
      user: {
        id: 'u1',
        email: 'user@example.com',
        fullName: 'User',
      },
    });
  });

  it('logout should revoke the current access-token session', async () => {
    authServiceMock.logout.mockResolvedValue({ success: true });

    const result = await controller.logout('user-1', 'sid-1');

    expect(authServiceMock.logout).toHaveBeenCalledWith('user-1', 'sid-1');
    expect(result).toEqual({ success: true });
  });
});

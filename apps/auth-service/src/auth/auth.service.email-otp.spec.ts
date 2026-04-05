import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService email OTP', () => {
  function createService() {
    const configMap: Record<string, unknown> = {
      JWT_ACCESS_EXPIRES_IN: '60m',
      OAUTH_EXCHANGE_CODE_EXPIRES_IN: '60s',
      TWO_FACTOR_CHALLENGE_EXPIRES_IN: '5m',
      TOTP_ISSUER: 'CTM Auth',
      TOTP_ENCRYPTION_SECRET: '12345678901234567890123456789012',
      INTERNAL_PROXY_SECRET: '12345678901234567890123456789012',
      GOOGLE_OAUTH_CLIENT_ID: '',
      GOOGLE_OAUTH_CLIENT_SECRET: '',
      GOOGLE_OAUTH_REDIRECT_URI: '',
      EMAIL_OTP_TTL_SECONDS: 300,
      EMAIL_OTP_RATE_LIMIT_SECONDS: 60,
      EMAIL_OTP_VERIFICATION_TTL_SECONDS: 600,
    };

    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key in configMap ? configMap[key] : defaultValue,
      ),
    };

    const usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
    };
    const prisma = {};
    const jwtService = {};
    const jwtKeyService = {};
    const redisService = {
      setIfAbsentWithExpiry: jest.fn(),
      getRemainingTtlSeconds: jest.fn(),
      setWithExpiry: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };
    const emailService = {
      sendOtpEmail: jest.fn(),
    };

    const service = new AuthService(
      usersService as any,
      prisma as any,
      jwtService as any,
      configService as any,
      redisService as any,
      emailService as any,
      jwtKeyService as any,
    );

    return {
      service,
      usersService,
      redisService,
      emailService,
    };
  }

  it('sendEmailOTP stores key with expected ttl and format', async () => {
    const { service, usersService, redisService, emailService } = createService();
    redisService.setIfAbsentWithExpiry.mockResolvedValue(true);
    usersService.findByEmail.mockResolvedValue(null);
    redisService.setWithExpiry.mockResolvedValue(undefined);
    emailService.sendOtpEmail.mockResolvedValue(undefined);

    const result = await service.sendEmailOTP('User@Example.com', 'REGISTER');

    expect(result).toEqual({ success: true });
    expect(redisService.setWithExpiry).toHaveBeenCalledWith(
      'otp:REGISTER:user@example.com',
      expect.stringMatching(/^\d{6}$/),
      300,
    );
    expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        type: 'REGISTER',
        ttlSeconds: 300,
      }),
    );
  });

  it('sendEmailOTP enforces per-email rate limit', async () => {
    const { service, redisService } = createService();
    redisService.setIfAbsentWithExpiry.mockResolvedValue(false);
    redisService.getRemainingTtlSeconds.mockResolvedValue(42);

    await expect(
      service.sendEmailOTP('user@example.com', 'REGISTER'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'OTP_RATE_LIMITED',
        details: expect.objectContaining({
          retryAfterSeconds: 42,
        }),
      }),
    });
  });

  it('verifyEmailOTP requires exact code, deletes otp key, and issues token', async () => {
    const { service, redisService } = createService();
    redisService.get.mockResolvedValue('123456');
    redisService.del.mockResolvedValue(1);
    redisService.setWithExpiry.mockResolvedValue(undefined);

    const result = await service.verifyEmailOTP(
      'user@example.com',
      '123456',
      'REGISTER',
    );

    expect(result.success).toBe(true);
    expect(result.verificationToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(redisService.del).toHaveBeenCalledWith(
      'otp:REGISTER:user@example.com',
    );
    expect(redisService.setWithExpiry).toHaveBeenCalledWith(
      `otpv:REGISTER:user@example.com:${result.verificationToken}`,
      '1',
      600,
    );
  });

  it('register requires otpVerificationToken proof', async () => {
    const { service, usersService } = createService();
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.register(
        {
          email: 'user@example.com',
          password: 'Password1',
          firstName: 'User',
          otpVerificationToken: '',
        },
        {
          ip: '127.0.0.1',
          userAgent: 'jest',
          deviceId: null,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.register(
        {
          email: 'user@example.com',
          password: 'Password1',
          firstName: 'User',
          otpVerificationToken: '',
        },
        {
          ip: '127.0.0.1',
          userAgent: 'jest',
          deviceId: null,
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'OTP_VERIFICATION_REQUIRED',
      }),
    });
  });
});

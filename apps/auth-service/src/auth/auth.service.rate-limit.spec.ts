import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService login limiter', () => {
  function createService(): AuthService {
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
    };

    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key in configMap ? configMap[key] : defaultValue,
      ),
    };

    const usersService = {};
    const prisma = {};
    const jwtService = {};
    const redisService = {};
    const emailService = {};
    const jwtKeyService = {};

    return new AuthService(
      usersService as any,
      prisma as any,
      jwtService as any,
      configService as any,
      redisService as any,
      emailService as any,
      jwtKeyService as any,
    );
  }

  it('returns RATE_LIMITED details with retryAfterSeconds', () => {
    const service = createService();
    const email = 'user@example.com';
    const ip = '127.0.0.1';
    const key = `${email}::${ip}`;

    (service as any).failedAuthAttempts.set(key, {
      count: 8,
      windowStartedAt: Date.now() - 2_000,
    });

    let thrown: unknown;
    try {
      (service as any).assertAuthAttemptsAllowed(email, ip);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    const exception = thrown as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(exception.getResponse()).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
      details: {
        retryAfterSeconds: expect.any(Number),
      },
    });
  });
});

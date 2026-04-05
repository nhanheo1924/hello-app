import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUser, signIn } from './auth-api';
import { httpRequest } from '../http/client';

vi.mock('../http/client', () => ({
  httpRequest: vi.fn(),
}));

vi.mock('../config/env', () => ({
  appEnv: {
    appBasePath: '/',
  },
}));

vi.mock('../config/routes', () => ({
  appRoutes: {
    signin: '/signin/',
    landing: '/landing/',
  },
  resolveAppPath: (path: string) => path,
}));

vi.mock('../../config/api', () => ({
  AUTH_API_BASE_URL: '/api/v1/auth',
}));

vi.mock('../sync/session-sync', () => ({
  invalidate: vi.fn(),
  isFresh: vi.fn(() => false),
  markFresh: vi.fn(),
}));

vi.mock('./session', () => ({
  clearToken: vi.fn(),
  clearUser: vi.fn(),
  getStoredUser: vi.fn(() => null),
  getToken: vi.fn(() => null),
  normalizeEmail: (value: string) => String(value || '').trim().toLowerCase(),
  storeToken: vi.fn(),
  storeUser: vi.fn((value: unknown) => (value && typeof value === 'object' ? value : null)),
  validateEmail: vi.fn(() => true),
  validatePassword: vi.fn(() => ({ valid: true })),
}));

const httpRequestMock = vi.mocked(httpRequest);

describe('auth sign-in retry policy', () => {
  beforeEach(() => {
    httpRequestMock.mockReset();

    (globalThis as { window?: unknown }).window = {
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
      location: {
        origin: 'http://localhost:5173',
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    };
  });

  it('does not retry on INVALID_CREDENTIALS (401)', async () => {
    httpRequestMock.mockRejectedValueOnce({
      status: 401,
      message: 'Invalid credentials',
      body: {
        code: 'INVALID_CREDENTIALS',
      },
    });

    const result = await signIn({
      email: 'user@example.com',
      password: 'wrong-password',
    });

    expect(httpRequestMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: 'Incorrect email or password.',
    });
  });

  it('does not retry on RATE_LIMITED (429) and surfaces retry window', async () => {
    httpRequestMock.mockRejectedValueOnce({
      status: 429,
      message: 'Too many attempts',
      retryAfterSeconds: 23,
      body: {
        code: 'RATE_LIMITED',
      },
    });

    const result = await signIn({
      email: 'user@example.com',
      password: 'wrong-password',
    });

    expect(httpRequestMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: 'Too many sign-in attempts. Try again in 23 seconds.',
    });
  });

  it('retries only for gateway/network failures', async () => {
    httpRequestMock
      .mockRejectedValueOnce({
        status: 503,
        message: 'Upstream unavailable',
        body: {
          code: 'UPSTREAM_UNAVAILABLE',
        },
      })
      .mockResolvedValueOnce({ user: null });

    const result = await signIn({
      email: 'user@example.com',
      password: 'valid-password',
    });

    expect(httpRequestMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      user: null,
    });
  });

  it('registers and completes the session immediately', async () => {
    httpRequestMock.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });

    const result = await registerUser({
      email: 'user@example.com',
      password: 'Valid123',
      otpVerificationToken: 'test-verification-token-123456',
      firstName: 'Jane',
    });

    expect(result).toEqual({
      ok: true,
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
  });

  it('requires otpVerificationToken for register', async () => {
    const result = await registerUser({
      email: 'user@example.com',
      password: 'Valid123',
      firstName: 'Jane',
      otpVerificationToken: '',
    });

    expect(httpRequestMock).toHaveBeenCalledTimes(0);
    expect(result).toEqual({
      ok: false,
      error: 'Verify your email code before creating your account.',
    });
  });
});

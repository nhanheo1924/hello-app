import { appEnv } from '../config/env';
import { appRoutes, resolveAppPath } from '../config/routes';
import { httpRequest } from '../http/client';
import { invalidate, isFresh, markFresh } from '../sync/session-sync';
import { AUTH_API_BASE_URL } from '../../config/api';
import {
  type AuthUser,
  clearToken,
  clearUser,
  getStoredUser,
  getToken,
  normalizeEmail,
  storeToken,
  storeUser,
  validateEmail,
  validatePassword
} from './session';

interface AuthApiResponse {
  accessToken?: string;
  requiresTwoFactor?: boolean;
  twoFactorToken?: string;
  user?: unknown;
  id?: string;
  email?: string;
}

interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  dob?: string;
  address?: string;
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
  fullName?: string;
}

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  otp?: string;
  backupCode?: string;
}

interface TwoFactorSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

interface TwoFactorConfirmResponse {
  backupCodes: string[];
}

interface DisableTwoFactorResponse {
  success: boolean;
}

type SignInResult =
  | { ok: true; user: AuthUser | null }
  | {
    ok: false;
    error: string;
    requiresTwoFactor?: boolean;
    twoFactorToken?: string;
  };

type VerifyTwoFactorLoginResult =
  | { ok: true; user: AuthUser | null }
  | { ok: false; error: string };

type TwoFactorSetupResult =
  | { ok: true; data: TwoFactorSetupResponse }
  | { ok: false; error: string };

type TwoFactorConfirmResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string };

type TwoFactorDisableResult =
  | { ok: true; success: true }
  | { ok: false; error: string };

type ChangePasswordResult =
  | { ok: true; success: true }
  | { ok: false; error: string };

const AUTH_PROFILE_RESOURCE_KEY = 'auth.me.profile';
const AUTH_PROFILE_SESSION_CACHE_KEY = 'orbitAuthProfileCacheV1';
const AUTH_PROFILE_TTL_MS = 5 * 60 * 1000;
const SIGN_IN_RETRY_DELAYS_MS = [5_000, 10_000] as const;

async function authRequest<T>(
  path: string,
  options: RequestInit = {},
  authToken: string | null = null
): Promise<T> {
  return httpRequest<T>(`${AUTH_API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    authToken
  });
}

function extractErrorMessage(error: unknown, fallbackMessage: string): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: string }).message || fallbackMessage)
    : fallbackMessage;
}

function extractErrorStatus(error: unknown): number {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return 0;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : 0;
}

function extractErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('body' in error)) {
    return '';
  }
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') {
    return '';
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function shouldRetrySignIn(error: unknown): boolean {
  const status = extractErrorStatus(error);
  const code = extractErrorCode(error);
  if (status === 0 || status === 429) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  return (
    code === 'BAD_GATEWAY' ||
    code === 'GATEWAY_TIMEOUT' ||
    code === 'UPSTREAM_UNAVAILABLE' ||
    code === 'NETWORK_ERROR'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildGoogleStartUrl(): string {
  const url = new URL(`${AUTH_API_BASE_URL}/google`, window.location.origin);
  url.searchParams.set('callback', `${window.location.origin}/auth/callback/`);
  return url.toString();
}

function readSessionProfileCache(): AuthUser | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_PROFILE_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return storeUser(parsed);
  } catch {
    return null;
  }
}

function writeSessionProfileCache(user: unknown): void {
  const normalized = storeUser(user);
  if (!normalized) return;

  try {
    window.sessionStorage.setItem(
      AUTH_PROFILE_SESSION_CACHE_KEY,
      JSON.stringify(normalized)
    );
  } catch {
    // ignore session cache failures
  }

  markFresh(AUTH_PROFILE_RESOURCE_KEY);
}

function clearSessionProfileCache(): void {
  try {
    window.sessionStorage.removeItem(AUTH_PROFILE_SESSION_CACHE_KEY);
  } catch {
    // ignore session cache failures
  }
}

export function invalidateProfileCache(): void {
  invalidate(AUTH_PROFILE_RESOURCE_KEY);
  clearSessionProfileCache();
}

function completeSessionFromResponse(response: AuthApiResponse): AuthUser | null {
  clearToken();
  const user = storeUser(response.user || null);
  if (user) {
    writeSessionProfileCache(user);
  } else {
    invalidateProfileCache();
  }
  return user;
}

export async function signIn(input: { email: string; password: string }): Promise<SignInResult> {
  const payload = {
    email: normalizeEmail(input.email),
    password: String(input.password || '')
  };
  const maxAttempts = 1 + SIGN_IN_RETRY_DELAYS_MS.length;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await authRequest<AuthApiResponse>('/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (response.requiresTwoFactor === true) {
        return {
          ok: false,
          requiresTwoFactor: true,
          twoFactorToken: typeof response.twoFactorToken === 'string'
            ? response.twoFactorToken
            : undefined,
          error: 'This account requires 2FA verification.'
        };
      }

      const user = completeSessionFromResponse(response);
      return { ok: true, user };
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < maxAttempts && shouldRetrySignIn(error);
      if (!shouldRetry) {
        break;
      }
      const retryDelayMs = SIGN_IN_RETRY_DELAYS_MS[attempt - 1] || 0;
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  return {
    ok: false,
    error: extractErrorMessage(lastError, 'Unable to sign in.')
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
}) {
  try {
    const response = await authRequest<AuthApiResponse>('/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizeEmail(input.email),
        password: String(input.password || ''),
        firstName: String(input.firstName || '').trim() || undefined,
        lastName: String(input.lastName || '').trim() || undefined,
        fullName: String(input.fullName || '').trim() || undefined
      })
    });

    return {
      ok: true,
      user: response.user || null
    };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to create account.')
    };
  }
}

export async function exchangeOauthCode(oauthCode: string): Promise<SignInResult> {
  const normalizedCode = String(oauthCode || '').trim();
  if (!normalizedCode) {
    return {
      ok: false,
      error: 'Missing OAuth exchange code.'
    };
  }

  try {
    const response = await authRequest<AuthApiResponse>('/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ oauthCode: normalizedCode })
    });

    if (response.requiresTwoFactor === true) {
      return {
        ok: false,
        requiresTwoFactor: true,
        twoFactorToken: typeof response.twoFactorToken === 'string'
          ? response.twoFactorToken
          : undefined,
        error: 'This account requires 2FA verification.'
      };
    }

    const user = completeSessionFromResponse(response);
    return { ok: true, user };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to authenticate OAuth callback.')
    };
  }
}

export async function verifyTwoFactorLogin(input: {
  otp?: string;
  backupCode?: string;
  twoFactorToken?: string;
}): Promise<VerifyTwoFactorLoginResult> {
  try {
    const otp = String(input.otp || '').trim();
    const backupCode = String(input.backupCode || '').trim();
    const twoFactorToken = String(input.twoFactorToken || '').trim();

    if (!otp && !backupCode) {
      return { ok: false, error: 'Please provide OTP or backup code.' };
    }

    const response = await authRequest<AuthApiResponse>(
      '/2fa/verify-login',
      {
        method: 'POST',
        body: JSON.stringify({
          otp: otp || undefined,
          backupCode: backupCode || undefined,
          twoFactorToken: twoFactorToken || undefined
        })
      }
    );

    if (response.requiresTwoFactor === true) {
      return { ok: false, error: '2FA challenge is still required.' };
    }

    const user = completeSessionFromResponse(response);
    return { ok: true, user };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to verify 2FA.')
    };
  }
}

export async function setupTwoFactor(): Promise<TwoFactorSetupResult> {
  try {
    const response = await authRequest<TwoFactorSetupResponse>('/2fa/setup', {
      method: 'POST'
    });

    return { ok: true, data: response };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to start 2FA setup.')
    };
  }
}

export async function confirmTwoFactor(otp: string): Promise<TwoFactorConfirmResult> {
  try {
    const response = await authRequest<TwoFactorConfirmResponse>('/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify({
        otp: String(otp || '').trim()
      })
    });

    await getCurrentUser({ forceRefresh: true });
    return {
      ok: true,
      backupCodes: Array.isArray(response.backupCodes) ? response.backupCodes : []
    };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to confirm 2FA.')
    };
  }
}

export async function disableTwoFactor(input: {
  otp?: string;
  backupCode?: string;
}): Promise<TwoFactorDisableResult> {
  try {
    const otp = String(input.otp || '').trim();
    const backupCode = String(input.backupCode || '').trim();
    if (!otp && !backupCode) {
      return { ok: false, error: 'Please provide OTP or backup code.' };
    }

    const response = await authRequest<DisableTwoFactorResponse>('/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({
        otp: otp || undefined,
        backupCode: backupCode || undefined
      })
    });

    await getCurrentUser({ forceRefresh: true });
    if (response && response.success === true) {
      return { ok: true, success: true };
    }

    return { ok: false, error: 'Unable to disable 2FA.' };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to disable 2FA.')
    };
  }
}

export async function getCurrentUser(options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh && isFresh(AUTH_PROFILE_RESOURCE_KEY, AUTH_PROFILE_TTL_MS)) {
    const cached = readSessionProfileCache() || getStoredUser();
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await authRequest<AuthApiResponse>('/me', { method: 'GET' });
    if (response.user && typeof response.user === 'object') {
      const user = storeUser(response.user);
      if (user) {
        writeSessionProfileCache(user);
      }
      return user;
    }
    if (typeof response.id === 'string' && typeof response.email === 'string') {
      const user = storeUser(response);
      if (user) {
        writeSessionProfileCache(user);
      }
      return user;
    }
    invalidateProfileCache();
    return null;
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : 0;

    if (status === 401 || status === 403) {
      clearToken();
      clearUser();
      invalidateProfileCache();
    }
    return null;
  }
}

export async function updateProfile(input: UpdateProfileInput) {
  const payload = input && typeof input === 'object'
    ? { ...input }
    : {};

  const response = await authRequest<AuthApiResponse>('/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (response.user && typeof response.user === 'object') {
    const user = storeUser(response.user);
    if (user) {
      writeSessionProfileCache(user);
    }
    return user;
  }

  return null;
}

export async function changePassword(
  input: ChangePasswordInput
): Promise<ChangePasswordResult> {
  const currentPassword = String(input.currentPassword || '');
  const newPassword = String(input.newPassword || '');
  if (!currentPassword || !newPassword) {
    return { ok: false, error: 'Current password and new password are required.' };
  }

  try {
    const response = await authRequest<{ success?: boolean }>('/password', {
      method: 'PATCH',
      body: JSON.stringify({
        currentPassword,
        newPassword,
        otp: String(input.otp || '').trim() || undefined,
        backupCode: String(input.backupCode || '').trim() || undefined
      })
    });

    if (response && response.success === true) {
      return { ok: true, success: true };
    }
    return { ok: false, error: 'Unable to change password.' };
  } catch (error) {
    return {
      ok: false,
      error: extractErrorMessage(error, 'Unable to change password.')
    };
  }
}

export async function requireAuth(redirectPath = appRoutes.signin) {
  const user = await getCurrentUser();
  if (!user) {
    clearToken();
    clearUser();
    window.location.href = resolveAppPath(redirectPath);
    return null;
  }
  return user;
}

export async function signOut(options?: { redirectTo?: string }) {
  try {
    await authRequest('/logout', { method: 'POST' });
  } catch {
    // ignore logout failure and clear local session regardless
  }

  clearToken();
  clearUser();
  invalidateProfileCache();

  const redirectTo = options?.redirectTo || appRoutes.landing;
  window.location.replace(resolveAppPath(redirectTo));
}

export function startGoogleFlow(): void {
  window.location.href = buildGoogleStartUrl();
}

export function createAuthCompat() {
  return {
    validateEmail,
    validatePassword,
    signIn,
    exchangeOauthCode,
    verifyTwoFactorLogin,
    registerUser,
    getCurrentUser,
    requireAuth,
    signOut,
    setupTwoFactor,
    confirmTwoFactor,
    disableTwoFactor,
    invalidateProfileCache,
    updateProfile,
    changePassword,
    startGoogleFlow,
    storeToken,
    clearToken,
    storeUser,
    getStoredUser,
    getToken,
    apiBase: AUTH_API_BASE_URL,
    appBase: appEnv.appBasePath,
    resolvePath: resolveAppPath
  };
}

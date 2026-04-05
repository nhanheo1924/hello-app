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

interface EmailOtpVerifyResponse {
  success: boolean;
  verificationToken?: string;
}

type EmailOtpType = 'REGISTER' | 'RESET_PASSWORD' | 'MFA';

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

type RegisterUserResult =
  | { ok: true; user: AuthUser | null }
  | { ok: false; error: string };

type SendEmailOtpResult =
  | { ok: true; success: true; cooldownSeconds: number }
  | { ok: false; error: string; retryAfterSeconds?: number };

type VerifyEmailOtpResult =
  | { ok: true; success: true; verificationToken: string }
  | { ok: false; error: string };

type ResetPasswordByOtpResult =
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

function extractRetryAfterSeconds(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 0;
  }

  const direct = Number(
    (error as { retryAfterSeconds?: unknown }).retryAfterSeconds,
  );
  if (Number.isFinite(direct) && direct > 0) {
    return Math.floor(direct);
  }

  if (!('body' in error)) {
    return 0;
  }
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') {
    return 0;
  }

  const record = body as {
    retryAfterSeconds?: unknown;
    details?: {
      retryAfterSeconds?: unknown;
    };
  };
  const bodyValue = Number(record.retryAfterSeconds);
  if (Number.isFinite(bodyValue) && bodyValue > 0) {
    return Math.floor(bodyValue);
  }

  const detailValue = Number(record.details?.retryAfterSeconds);
  if (Number.isFinite(detailValue) && detailValue > 0) {
    return Math.floor(detailValue);
  }

  return 0;
}

function resolveSignInErrorMessage(error: unknown): string {
  return resolveAuthErrorMessage(error, 'Unable to sign in.');
}

function shouldRetrySignIn(error: unknown): boolean {
  const status = extractErrorStatus(error);
  const code = extractErrorCode(error);
  if (status === 0) {
    return true;
  }

  if (status === 502 || status === 503 || status === 504) {
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

function normalizeAuthMessage(message: string, fallbackMessage: string): string {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return fallbackMessage;
  }

  const lookup = normalized.toLowerCase();
  if (lookup.includes('invalid otp code')) {
    return 'Invalid one-time code.';
  }
  if (lookup.includes('invalid backup code')) {
    return 'Invalid backup code.';
  }
  if (lookup.includes('provide otp or backup code')) {
    return 'Enter a one-time code or backup code.';
  }
  if (lookup.includes('missing 2fa challenge token')) {
    return 'The 2FA challenge has expired. Please sign in again.';
  }
  if (lookup.includes('invalid or expired 2fa challenge')) {
    return 'The 2FA challenge has expired. Please sign in again.';
  }
  if (lookup.includes('invalid 2fa challenge')) {
    return 'The 2FA challenge is invalid. Please sign in again.';
  }
  if (lookup.includes('current password is incorrect')) {
    return 'Current password is incorrect.';
  }
  if (lookup.includes('new password must be different')) {
    return 'New password must be different from your current password.';
  }
  if (lookup.includes('email verification is required')) {
    return 'Verify your email code before continuing.';
  }
  if (lookup.includes('verification has expired')) {
    return 'Your verification expired. Please verify again.';
  }
  if (lookup.includes('invalid or expired one-time code')) {
    return 'Invalid or expired one-time code.';
  }
  if (
    lookup.includes('already exists') ||
    lookup.includes('already registered') ||
    lookup.includes('email is already in use')
  ) {
    return 'An account with this email already exists.';
  }

  return normalized;
}

function resolveAuthErrorMessage(error: unknown, fallbackMessage: string): string {
  const code = extractErrorCode(error);

  if (code === 'INVALID_CREDENTIALS') {
    return 'Incorrect email or password.';
  }
  if (code === 'RATE_LIMITED') {
    const retryAfterSeconds = extractRetryAfterSeconds(error);
    if (retryAfterSeconds > 0) {
      return `Too many sign-in attempts. Try again in ${retryAfterSeconds} seconds.`;
    }
    return 'Too many sign-in attempts. Please try again later.';
  }
  if (code === 'TWO_FACTOR_INVALID') {
    return 'The 2FA challenge has expired. Please sign in again.';
  }
  if (code === 'PASSWORD_MISMATCH') {
    return 'Current password is incorrect.';
  }
  if (code === 'PASSWORD_REUSE') {
    return 'New password must be different from your current password.';
  }
  if (code === 'OTP_INVALID') {
    return 'Invalid or expired one-time code.';
  }
  if (code === 'OTP_VERIFICATION_REQUIRED') {
    return 'Verify your email code before continuing.';
  }
  if (code === 'OTP_VERIFICATION_INVALID') {
    return 'Your verification expired. Please verify again.';
  }
  if (code === 'OTP_RATE_LIMITED') {
    const retryAfterSeconds = extractRetryAfterSeconds(error);
    if (retryAfterSeconds > 0) {
      return `Please wait ${retryAfterSeconds} seconds before requesting another code.`;
    }
    return 'Please wait before requesting another code.';
  }
  if (
    code === 'BAD_GATEWAY' ||
    code === 'GATEWAY_TIMEOUT' ||
    code === 'UPSTREAM_UNAVAILABLE'
  ) {
    return 'The authentication service is temporarily unavailable. Please try again.';
  }

  return normalizeAuthMessage(
    extractErrorMessage(error, fallbackMessage),
    fallbackMessage,
  );
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
    error: resolveSignInErrorMessage(lastError)
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  otpVerificationToken: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
}): Promise<RegisterUserResult> {
  const otpVerificationToken = String(input.otpVerificationToken || '').trim();
  if (!otpVerificationToken) {
    return {
      ok: false,
      error: 'Verify your email code before creating your account.',
    };
  }

  try {
    const response = await authRequest<AuthApiResponse>('/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizeEmail(input.email),
        password: String(input.password || ''),
        otpVerificationToken,
        firstName: String(input.firstName || '').trim() || undefined,
        lastName: String(input.lastName || '').trim() || undefined,
        fullName: String(input.fullName || '').trim() || undefined
      })
    });

    const user = completeSessionFromResponse(response);
    return {
      ok: true,
      user
    };
  } catch (error) {
    return {
      ok: false,
      error: resolveAuthErrorMessage(error, 'Unable to create account.')
    };
  }
}

export async function sendEmailOtp(input: {
  email: string;
  type: EmailOtpType;
}): Promise<SendEmailOtpResult> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!validateEmail(normalizedEmail)) {
    return {
      ok: false,
      error: 'Enter a valid email address.',
    };
  }

  try {
    await authRequest<{ success?: boolean }>('/otp/email/send', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizedEmail,
        type: input.type,
      }),
    });
    return {
      ok: true,
      success: true,
      cooldownSeconds: 60,
    };
  } catch (error) {
    const retryAfterSeconds = extractRetryAfterSeconds(error);
    return {
      ok: false,
      error: resolveAuthErrorMessage(
        error,
        'Unable to send one-time code. Please try again.',
      ),
      retryAfterSeconds:
        retryAfterSeconds > 0 ? retryAfterSeconds : undefined,
    };
  }
}

export async function verifyEmailOtp(input: {
  email: string;
  code: string;
  type: EmailOtpType;
}): Promise<VerifyEmailOtpResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const code = String(input.code || '').trim();

  if (!validateEmail(normalizedEmail)) {
    return {
      ok: false,
      error: 'Enter a valid email address.',
    };
  }
  if (!/^\d{6}$/.test(code)) {
    return {
      ok: false,
      error: 'Enter the 6-digit code from your email.',
    };
  }

  try {
    const response = await authRequest<EmailOtpVerifyResponse>(
      '/otp/email/verify',
      {
        method: 'POST',
        body: JSON.stringify({
          email: normalizedEmail,
          code,
          type: input.type,
        }),
      },
    );

    const verificationToken = String(response.verificationToken || '').trim();
    if (!verificationToken) {
      return {
        ok: false,
        error: 'Unable to verify one-time code.',
      };
    }

    return {
      ok: true,
      success: true,
      verificationToken,
    };
  } catch (error) {
    return {
      ok: false,
      error: resolveAuthErrorMessage(
        error,
        'Unable to verify one-time code.',
      ),
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
      error: resolveAuthErrorMessage(error, 'Unable to authenticate OAuth callback.')
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
      return { ok: false, error: 'Enter a one-time code or backup code.' };
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
      return { ok: false, error: 'Two-factor verification is still required.' };
    }

    const user = completeSessionFromResponse(response);
    return { ok: true, user };
  } catch (error) {
    return {
      ok: false,
      error: resolveAuthErrorMessage(error, 'Unable to verify 2FA.')
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
      error: resolveAuthErrorMessage(error, 'Unable to start 2FA setup.')
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
      error: resolveAuthErrorMessage(error, 'Unable to confirm 2FA.')
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
      return { ok: false, error: 'Enter a one-time code or backup code.' };
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
      error: resolveAuthErrorMessage(error, 'Unable to disable 2FA.')
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
      error: resolveAuthErrorMessage(error, 'Unable to change password.')
    };
  }
}

export async function resetPasswordByOtp(input: {
  email: string;
  newPassword: string;
  otpVerificationToken: string;
}): Promise<ResetPasswordByOtpResult> {
  const email = normalizeEmail(input.email);
  const newPassword = String(input.newPassword || '');
  const otpVerificationToken = String(input.otpVerificationToken || '').trim();

  if (!validateEmail(email)) {
    return {
      ok: false,
      error: 'Enter a valid email address.',
    };
  }
  if (!newPassword) {
    return {
      ok: false,
      error: 'Enter a new password.',
    };
  }
  if (!otpVerificationToken) {
    return {
      ok: false,
      error: 'Verify your email code before resetting your password.',
    };
  }

  try {
    const response = await authRequest<{ success?: boolean }>('/password/reset', {
      method: 'POST',
      body: JSON.stringify({
        email,
        newPassword,
        otpVerificationToken,
      }),
    });

    if (response && response.success === true) {
      return { ok: true, success: true };
    }

    return {
      ok: false,
      error: 'Unable to reset password.',
    };
  } catch (error) {
    return {
      ok: false,
      error: resolveAuthErrorMessage(error, 'Unable to reset password.'),
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
    sendEmailOtp,
    verifyEmailOtp,
    registerUser,
    resetPasswordByOtp,
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

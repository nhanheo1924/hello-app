import { beginGlobalLoading } from '../ui/loading';
import { AUTH_API_BASE_URL } from '../../config/api';
import { clearToken, clearUser } from '../auth/session';
import { invalidate } from '../sync/session-sync';

export interface HttpRequestOptions extends RequestInit {
  authToken?: string | null;
  parseJson?: boolean;
  trackLoading?: boolean;
  loadingDelayMs?: number;
  loadingScope?: string;
  silent?: boolean;
  skipSessionRefresh?: boolean;
}

export interface HttpErrorShape {
  status: number;
  body: unknown;
  message: string;
  retryAfterSeconds?: number;
}

const REFRESH_FAILURE_COOLDOWN_MS = 5000;
const AUTH_PROFILE_RESOURCE_KEY = 'auth.me.profile';
const AUTH_PROFILE_SESSION_CACHE_KEY = 'orbitAuthProfileCacheV1';
const SKIP_REFRESH_PATHS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/oauth/exchange',
  '/auth/otp/email/send',
  '/auth/otp/email/verify',
  '/auth/password/reset',
]);

let refreshSessionPromise: Promise<RefreshSessionResult> | null = null;
let lastRefreshFailureAt = 0;
let lastRefreshFailureWasSessionInvalid = false;
const SESSION_INVALID_CODES = new Set([
  'AUTH_UNAUTHORIZED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_MISSING',
  'REFRESH_EXPIRED',
  'REFRESH_REUSED',
  'REFRESH_INVALID',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
]);

type RefreshSessionResult = {
  ok: boolean;
  sessionInvalid: boolean;
};

function resolveErrorMessage(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') {
    return `Request failed (${status})`;
  }

  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error;
  }
  if (Array.isArray(record.details)) {
    const detail = record.details.find((entry) => typeof entry === 'string' && entry.trim());
    if (typeof detail === 'string') {
      return detail;
    }
  }

  return `Request failed (${status})`;
}

export async function httpRequest<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const {
    authToken = null,
    parseJson = true,
    trackLoading = true,
    loadingDelayMs = 500,
    loadingScope = '',
    silent = false,
    skipSessionRefresh = false,
    ...requestOptions
  } = options;

  const stopLoading = beginGlobalLoading({
    trackLoading,
    loadingDelayMs,
    loadingScope,
    silent,
  });

  const headers = new Headers(requestOptions.headers || {});
  const credentials = requestOptions.credentials ?? 'include';
  const hasBody = requestOptions.body !== undefined && requestOptions.body !== null;
  const isFormDataPayload =
    typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;

  if (hasBody && !isFormDataPayload && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  try {
    let response = await fetch(url, {
      ...requestOptions,
      credentials,
      headers
    });
    let body = parseJson === false ? null : await response.json().catch(() => ({}));
    let attemptedRefresh = false;
    let refreshed = false;
    let refreshFailedAsSessionInvalid = false;

    const refreshEligible =
      !response.ok &&
      shouldAttemptSessionRefresh({
        status: response.status,
        url,
        credentials,
        skipSessionRefresh,
      });

    if (refreshEligible) {
      attemptedRefresh = true;
      const refreshResult = await refreshSession();
      refreshed = refreshResult.ok;
      refreshFailedAsSessionInvalid =
        refreshResult.ok === false && refreshResult.sessionInvalid === true;
      if (refreshed) {
        response = await fetch(url, {
          ...requestOptions,
          credentials,
          headers,
        });
        body = parseJson === false ? null : await response.json().catch(() => ({}));
      }
    }

    if (!response.ok) {
      if (
        shouldClearAuthStateAfterError({
          status: response.status,
          body,
          attemptedRefresh,
          refreshed,
          refreshFailedAsSessionInvalid,
        })
      ) {
        clearAuthLocalState();
      }

      const retryAfterSeconds = resolveRetryAfterSeconds(response);
      const error: HttpErrorShape = {
        status: response.status,
        body,
        message: resolveErrorMessage(body, response.status),
        ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {})
      };
      throw error;
    }

    return body as T;
  } finally {
    stopLoading();
  }
}

function clearAuthLocalState(): void {
  clearToken();
  clearUser();
  invalidate(AUTH_PROFILE_RESOURCE_KEY);

  try {
    window.sessionStorage.removeItem(AUTH_PROFILE_SESSION_CACHE_KEY);
  } catch {
    // ignore storage clear failures
  }

  try {
    window.dispatchEvent(new CustomEvent('ctm:auth:signed-out'));
  } catch {
    // ignore event dispatch failures
  }
}

function shouldClearAuthStateAfterError(input: {
  status: number;
  body: unknown;
  attemptedRefresh: boolean;
  refreshed: boolean;
  refreshFailedAsSessionInvalid: boolean;
}): boolean {
  if (!input.attemptedRefresh || input.refreshed) {
    return false;
  }

  if (!input.refreshFailedAsSessionInvalid) {
    return false;
  }

  if (input.status !== 401 && input.status !== 403) {
    return false;
  }

  const code = extractErrorCode(input.body);
  if (!code) {
    return true;
  }
  return SESSION_INVALID_CODES.has(code);
}

function extractErrorCode(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const code = (body as Record<string, unknown>).code;
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function resolveRetryAfterSeconds(response: Response): number {
  const raw = String(response.headers.get('retry-after') || '').trim();
  if (!raw) {
    return 0;
  }

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.max(1, Math.floor(asSeconds));
  }

  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) {
    return 0;
  }

  const deltaSeconds = Math.ceil((asDate - Date.now()) / 1000);
  return deltaSeconds > 0 ? deltaSeconds : 0;
}

function shouldAttemptSessionRefresh(input: {
  status: number;
  url: string;
  credentials: RequestCredentials;
  skipSessionRefresh: boolean;
}): boolean {
  if (input.skipSessionRefresh) {
    return false;
  }
  if (input.status !== 401 && input.status !== 403) {
    return false;
  }
  if (input.credentials === 'omit') {
    return false;
  }

  const pathname = resolvePathname(input.url);
  if (!pathname) {
    return true;
  }
  return !SKIP_REFRESH_PATHS.has(pathname);
}

function resolvePathname(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname || '';
  } catch {
    return '';
  }
}

async function refreshSession(): Promise<RefreshSessionResult> {
  const now = Date.now();
  if (now - lastRefreshFailureAt < REFRESH_FAILURE_COOLDOWN_MS) {
    return {
      ok: false,
      sessionInvalid: lastRefreshFailureWasSessionInvalid,
    };
  }

  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = (async () => {
    try {
      const response = await fetch(`${AUTH_API_BASE_URL}/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const responseErrorCode = await readResponseErrorCode(response);
        const sessionInvalid = isRefreshFailureSessionInvalid(
          response.status,
          responseErrorCode,
        );
        lastRefreshFailureAt = Date.now();
        lastRefreshFailureWasSessionInvalid = sessionInvalid;
        return {
          ok: false,
          sessionInvalid,
        };
      }
      lastRefreshFailureWasSessionInvalid = false;
      return {
        ok: true,
        sessionInvalid: false,
      };
    } catch {
      lastRefreshFailureAt = Date.now();
      lastRefreshFailureWasSessionInvalid = false;
      return {
        ok: false,
        sessionInvalid: false,
      };
    } finally {
      refreshSessionPromise = null;
    }
  })();

  return refreshSessionPromise;
}

async function readResponseErrorCode(response: Response): Promise<string> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return '';
  }

  try {
    const payload = await response.json().catch(() => ({}));
    return extractErrorCode(payload);
  } catch {
    return '';
  }
}

function isRefreshFailureSessionInvalid(status: number, code: string): boolean {
  if (status === 401) {
    return !code || SESSION_INVALID_CODES.has(code);
  }
  if (status === 403) {
    return SESSION_INVALID_CODES.has(code);
  }
  return false;
}

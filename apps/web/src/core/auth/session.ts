import { getLocalStorageItem, removeLocalStorageItem, safeParseJson, setLocalStorageItem } from '../storage/local-storage';

export const ACCESS_TOKEN_KEY = 'accessToken';
export const USER_PROFILE_KEY = 'authUser';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  dob: string | null;
  address: string | null;
  avatarUrl: string | null;
  timezone: string | null;
  locale: string | null;
  systemRole: string;
  username: string;
  twoFactorEnabled: boolean;
}

export function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(normalizeEmail(email));
}

export function validatePassword(password: string) {
  const value = String(password || '');
  const checks = {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /[0-9]/.test(value)
  };

  return {
    ...checks,
    valid: checks.length && checks.uppercase && checks.lowercase && checks.number
  };
}

export function normalizeUser(user: unknown): AuthUser | null {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const record = user as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const email = normalizeEmail(record.email);
  if (!id || !validateEmail(email)) {
    return null;
  }

  const firstName = typeof record.firstName === 'string' && record.firstName.trim()
    ? record.firstName.trim().slice(0, 120)
    : null;
  const lastName = typeof record.lastName === 'string' && record.lastName.trim()
    ? record.lastName.trim().slice(0, 120)
    : null;
  const displayName = typeof record.displayName === 'string' && record.displayName.trim()
    ? record.displayName.trim().slice(0, 120)
    : null;
  const dob = normalizeDateString(record.dob);
  const address = typeof record.address === 'string' && record.address.trim()
    ? record.address.trim().slice(0, 255)
    : null;
  const fullNameRaw = typeof record.fullName === 'string' ? record.fullName.trim() : '';
  const fullName = fullNameRaw ? fullNameRaw.slice(0, 120) : null;
  const avatarUrl = typeof record.avatarUrl === 'string' && record.avatarUrl.trim()
    ? record.avatarUrl.trim().slice(0, 512)
    : null;
  const timezone = typeof record.timezone === 'string' && record.timezone.trim()
    ? record.timezone.trim().slice(0, 64)
    : null;
  const locale = typeof record.locale === 'string' && record.locale.trim()
    ? record.locale.trim().slice(0, 16)
    : null;
  const systemRole = typeof record.systemRole === 'string' && record.systemRole.trim()
    ? record.systemRole.trim()
    : 'USER';

  const username = displayName || fullName || [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
  const twoFactorEnabled = record.twoFactorEnabled === true;

  return {
    id,
    email,
    fullName,
    firstName,
    lastName,
    displayName,
    dob,
    address,
    avatarUrl,
    timezone,
    locale,
    systemRole,
    username,
    twoFactorEnabled
  };
}

export function storeUser(user: unknown): AuthUser | null {
  const normalized = normalizeUser(user);
  if (!normalized) {
    return null;
  }

  setLocalStorageItem(USER_PROFILE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getStoredUser(): AuthUser | null {
  return normalizeUser(safeParseJson<AuthUser>(getLocalStorageItem(USER_PROFILE_KEY)));
}

export function clearUser(): void {
  removeLocalStorageItem(USER_PROFILE_KEY);
}

function readToken(): string | null {
  return getLocalStorageItem(ACCESS_TOKEN_KEY);
}

export function isTokenExpired(token: string | null): boolean {
  if (typeof token !== 'string' || !token.length) {
    return true;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return false;
  }

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof payload.exp !== 'number') {
      return false;
    }
    return payload.exp <= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function storeToken(token: unknown): void {
  // Security-first policy: access token stays in HttpOnly cookie managed by BFF.
  // Keep this function only for backward compatibility and clear any legacy token.
  void token;
  clearToken();
}

export function clearToken(): void {
  removeLocalStorageItem(ACCESS_TOKEN_KEY);
}

export function getToken(): string | null {
  // Never expose session token to JS runtime in cookie-session mode.
  // Also cleanup legacy localStorage token from older deployments.
  const legacyToken = readToken();
  if (legacyToken) {
    clearToken();
  }
  return null;
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return null;
  }

  const raw = value instanceof Date ? value.toISOString() : value.trim();
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

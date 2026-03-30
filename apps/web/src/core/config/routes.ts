import { appEnv } from './env';

function normalizeInputPath(path: string): string {
  const value = String(path || '').trim();
  if (!value) {
    return '';
  }

  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    value.startsWith('//') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('#') ||
    value.startsWith('?')
  ) {
    return value;
  }

  return value.startsWith('/') ? value.slice(1) : value;
}

export function resolveAppPath(path: string): string {
  const normalized = normalizeInputPath(path);
  if (!normalized) {
    return appEnv.appBasePath;
  }

  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('#') ||
    normalized.startsWith('?')
  ) {
    return normalized;
  }

  const base = appEnv.appBasePath === '/' ? '/' : appEnv.appBasePath;
  return `${base}${normalized}`;
}

export const appRoutes = {
  landing: '/landing/',
  signin: '/signin/',
  signup: '/signup/',
  home: '/home/',
  admin: '/admin/',
  setting: '/setting/',
  workspaceSetting: '/workspace-setting/',
  about: '/about/',
  authCallback: '/auth/callback/'
};

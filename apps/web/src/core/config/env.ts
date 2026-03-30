function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBasePath(value: string | undefined): string {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') {
    return '/';
  }

  let normalized = raw.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (!normalized.endsWith('/')) {
    normalized = `${normalized}/`;
  }
  return normalized;
}

function requiredEnv(name: keyof ImportMetaEnv, fallback?: string): string {
  const value = String(import.meta.env[name] || fallback || '').trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export const appEnv = {
  appBasePath: normalizeBasePath(import.meta.env.BASE_URL || import.meta.env.VITE_APP_BASE_PATH),
  frontendUrl: trimTrailingSlashes(requiredEnv('VITE_FRONTEND_URL', typeof window !== 'undefined' ? window.location.origin : '')),
  oauthCallbackPath: normalizeBasePath(import.meta.env.VITE_OAUTH_CALLBACK_PATH || '/auth/callback/')
};

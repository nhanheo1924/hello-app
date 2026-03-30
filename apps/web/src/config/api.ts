function trimTrailingSlashes(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

export const API_BASE_URL = trimTrailingSlashes(
  import.meta.env.VITE_API_BASE_URL || '/api/v1',
);
export const AUTH_API_BASE_URL = `${API_BASE_URL}/auth`;

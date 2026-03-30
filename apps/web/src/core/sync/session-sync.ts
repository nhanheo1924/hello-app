const SESSION_SYNC_INDEX_KEY = 'orbitSessionSyncIndexV1';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

type SessionSyncIndex = Record<string, number>;

function normalizeKey(key: unknown): string {
  return String(key || '').trim();
}

function readIndex(): SessionSyncIndex {
  try {
    const raw = window.sessionStorage.getItem(SESSION_SYNC_INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};

    const next: SessionSyncIndex = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== 'string' || !key.trim()) continue;
      const ts = Number(value);
      if (Number.isFinite(ts) && ts > 0) {
        next[key] = ts;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeIndex(index: SessionSyncIndex): void {
  try {
    window.sessionStorage.setItem(SESSION_SYNC_INDEX_KEY, JSON.stringify(index));
  } catch {
    // ignore storage write failures
  }
}

export function isFresh(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;

  const ttl = Number(ttlMs);
  const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MS;
  const index = readIndex();
  const markedAt = Number(index[normalized] || 0);
  if (!Number.isFinite(markedAt) || markedAt <= 0) {
    return false;
  }

  return Date.now() - markedAt <= safeTtl;
}

export function markFresh(key: string): void {
  const normalized = normalizeKey(key);
  if (!normalized) return;

  const index = readIndex();
  index[normalized] = Date.now();
  writeIndex(index);
}

export function invalidate(key: string): void {
  const normalized = normalizeKey(key);
  if (!normalized) return;

  const index = readIndex();
  if (!(normalized in index)) return;
  delete index[normalized];
  writeIndex(index);
}

export function invalidateAll(): void {
  try {
    window.sessionStorage.removeItem(SESSION_SYNC_INDEX_KEY);
  } catch {
    // ignore storage delete failures
  }
}

export function createSessionSyncCompat() {
  return {
    isFresh,
    markFresh,
    invalidate,
    invalidateAll
  };
}


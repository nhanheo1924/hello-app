import { API_BASE_URL } from '../../config/api';

export type RealtimeSyncStatus = 'connected' | 'reconnecting' | 'offline';

type InvalidatePayload = {
  workspaceId?: string;
  resource?: string;
  ts?: number;
};

type ConnectOptions = {
  workspaceId?: string;
  onInvalidate?: (payload: InvalidatePayload) => void;
  onStatusChange?: (status: RealtimeSyncStatus) => void;
};

type LeaderLock = {
  tabId: string;
  expiresAt: number;
};

const LOCK_KEY_PREFIX = 'orbitRealtimeLeaderLockV1';
const CHANNEL_NAME = 'orbit-realtime-sync-v1';
const LEADER_TTL_MS = 15_000;
const LEADER_HEARTBEAT_MS = 5_000;
const LEADER_MONITOR_MS = 4_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const WORKSPACE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeWorkspaceId(value: unknown): string {
  const candidate = String(value || '').trim();
  if (WORKSPACE_ID_REGEX.test(candidate)) {
    return candidate;
  }
  return '';
}

function lockKeyForWorkspace(workspaceId: string): string {
  return `${LOCK_KEY_PREFIX}:${workspaceId || '*'}`;
}

export function createRealtimeSyncCompat() {
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const supportsBroadcastChannel =
    typeof window.BroadcastChannel === 'function';

  const state = {
    workspaceId: '',
    status: 'offline' as RealtimeSyncStatus,
    isLeader: false,
    running: false,
    reconnectAttempt: 0,
    eventSource: null as EventSource | null,
    reconnectTimer: null as number | null,
    heartbeatTimer: null as number | null,
    monitorTimer: null as number | null,
    channel: null as BroadcastChannel | null,
    onInvalidate: null as ConnectOptions['onInvalidate'] | null,
    onStatusChange: null as ConnectOptions['onStatusChange'] | null,
  };

  function setStatus(status: RealtimeSyncStatus, broadcast = true): void {
    if (state.status === status) return;
    state.status = status;
    if (typeof state.onStatusChange === 'function') {
      state.onStatusChange(status);
    }
    if (broadcast) {
      postChannelMessage({ type: 'status', status });
    }
  }

  function ensureChannel(): void {
    if (!supportsBroadcastChannel || state.channel) return;
    state.channel = new BroadcastChannel(CHANNEL_NAME);
    state.channel.onmessage = (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'invalidate' && data.payload) {
        handleInvalidate(data.payload as InvalidatePayload, false);
        return;
      }

      if (!state.isLeader && data.type === 'status') {
        const nextStatus = String(data.status || 'offline') as RealtimeSyncStatus;
        if (
          nextStatus === 'connected' ||
          nextStatus === 'reconnecting' ||
          nextStatus === 'offline'
        ) {
          setStatus(nextStatus, false);
        }
      }
    };
  }

  function postChannelMessage(payload: Record<string, unknown>): void {
    if (!state.channel) return;
    try {
      state.channel.postMessage(payload);
    } catch {
      // ignore broadcast channel failures
    }
  }

  function getLeaderLock(): LeaderLock | null {
    if (!state.workspaceId) return null;
    try {
      const raw = window.localStorage.getItem(lockKeyForWorkspace(state.workspaceId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return null;

      const tab = typeof parsed.tabId === 'string' ? parsed.tabId : '';
      const expiresAt = Number(parsed.expiresAt);
      if (!tab || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
      return { tabId: tab, expiresAt };
    } catch {
      return null;
    }
  }

  function writeLeaderLock(): boolean {
    if (!state.workspaceId) return false;
    const key = lockKeyForWorkspace(state.workspaceId);
    const next: LeaderLock = {
      tabId,
      expiresAt: Date.now() + LEADER_TTL_MS,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      const current = getLeaderLock();
      return current?.tabId === tabId;
    } catch {
      return false;
    }
  }

  function releaseLeaderLock(): void {
    if (!state.workspaceId) return;
    const key = lockKeyForWorkspace(state.workspaceId);
    const current = getLeaderLock();
    if (!current || current.tabId !== tabId) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore lock removal failures
    }
  }

  function stopReconnectTimer(): void {
    if (state.reconnectTimer !== null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  function stopStream(): void {
    stopReconnectTimer();
    if (state.eventSource) {
      try {
        state.eventSource.close();
      } catch {
        // ignore close failures
      }
      state.eventSource = null;
    }
  }

  function handleInvalidate(payload: InvalidatePayload, broadcast: boolean): void {
    if (
      state.workspaceId &&
      payload.workspaceId &&
      payload.workspaceId !== '*' &&
      payload.workspaceId !== state.workspaceId
    ) {
      return;
    }

    if (typeof state.onInvalidate === 'function') {
      state.onInvalidate(payload);
    }

    if (broadcast) {
      postChannelMessage({ type: 'invalidate', payload });
    }
  }

  function openStream(): void {
    if (!state.running || !state.isLeader || !state.workspaceId) {
      return;
    }

    if (document.visibilityState === 'hidden') {
      stopStream();
      setStatus('offline');
      return;
    }

    stopStream();
    setStatus('reconnecting');

    const streamUrl = new URL(`${API_BASE_URL}/sync/stream`, window.location.origin);
    streamUrl.searchParams.set('workspaceId', state.workspaceId);

    const source = new EventSource(streamUrl.toString(), {
      withCredentials: true,
    });
    state.eventSource = source;

    source.onopen = () => {
      state.reconnectAttempt = 0;
      setStatus('connected');
    };

    source.onerror = () => {
      stopStream();
      if (!state.running || !state.isLeader) {
        setStatus('offline');
        return;
      }
      setStatus('reconnecting');
      scheduleReconnect();
    };

    source.addEventListener('sync.invalidate', (event) => {
      try {
        const parsed = JSON.parse(String((event as MessageEvent).data || '{}'));
        handleInvalidate(parsed as InvalidatePayload, true);
      } catch {
        // ignore malformed event payloads
      }
    });
  }

  function scheduleReconnect(): void {
    if (!state.running || !state.isLeader) return;
    stopReconnectTimer();

    state.reconnectAttempt += 1;
    const backoff = Math.min(
      MAX_RECONNECT_DELAY_MS,
      1_000 * (2 ** Math.max(0, state.reconnectAttempt - 1)),
    );
    const jitter = Math.floor(Math.random() * 250);
    const delay = backoff + jitter;

    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      openStream();
    }, delay);
  }

  function becomeLeader(): void {
    if (state.isLeader) return;
    state.isLeader = true;
    state.reconnectAttempt = 0;
    openStream();
  }

  function becomeFollower(): void {
    if (!state.isLeader) return;
    state.isLeader = false;
    stopStream();
  }

  function refreshLeadership(): void {
    if (!state.running || !state.workspaceId) {
      becomeFollower();
      setStatus('offline');
      return;
    }

    if (document.visibilityState === 'hidden') {
      releaseLeaderLock();
      becomeFollower();
      setStatus('offline');
      return;
    }

    const current = getLeaderLock();
    const now = Date.now();
    const lockExpired = !current || current.expiresAt <= now;
    const mine = current?.tabId === tabId;

    if (mine || lockExpired) {
      const acquired = writeLeaderLock();
      if (acquired) {
        becomeLeader();
        return;
      }
    }

    becomeFollower();
    if (state.status === 'offline') {
      setStatus('reconnecting', false);
    }
  }

  function clearTimers(): void {
    stopReconnectTimer();
    if (state.heartbeatTimer !== null) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.monitorTimer !== null) {
      window.clearInterval(state.monitorTimer);
      state.monitorTimer = null;
    }
  }

  function startTimers(): void {
    if (state.heartbeatTimer === null) {
      state.heartbeatTimer = window.setInterval(() => {
        if (state.running && state.isLeader) {
          writeLeaderLock();
        }
      }, LEADER_HEARTBEAT_MS);
    }
    if (state.monitorTimer === null) {
      state.monitorTimer = window.setInterval(() => {
        refreshLeadership();
      }, LEADER_MONITOR_MS);
    }
  }

  function handleVisibilityChange(): void {
    refreshLeadership();
  }

  function connect(options: ConnectOptions = {}): void {
    state.running = true;
    state.workspaceId = normalizeWorkspaceId(options.workspaceId);
    state.onInvalidate = options.onInvalidate || null;
    state.onStatusChange = options.onStatusChange || null;

    ensureChannel();
    startTimers();
    refreshLeadership();
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function disconnect(): void {
    state.running = false;
    releaseLeaderLock();
    becomeFollower();
    clearTimers();
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    if (state.channel) {
      try {
        state.channel.close();
      } catch {
        // ignore close failures
      }
      state.channel = null;
    }

    setStatus('offline');
  }

  function setWorkspaceId(workspaceId?: string): void {
    const normalized = normalizeWorkspaceId(workspaceId);
    if (state.workspaceId === normalized) {
      return;
    }

    releaseLeaderLock();
    state.workspaceId = normalized;
    state.reconnectAttempt = 0;
    refreshLeadership();
  }

  function getStatus(): RealtimeSyncStatus {
    return state.status;
  }

  return {
    connect,
    disconnect,
    setWorkspaceId,
    getStatus,
  };
}

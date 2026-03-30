import { AUTH_API_BASE_URL, API_BASE_URL } from '../../config/api';
import { getToken } from '../../core/auth/session';
import { httpRequest } from '../../core/http/client';

import { beginGlobalLoading } from '../../core/ui/loading';

type QueryParams = Record<string, unknown>;

type NotificationStreamHandlers = {
  onCreated?: (payload: unknown) => void;
  onRead?: (payload: unknown) => void;
  onUnreadCount?: (payload: unknown) => void;
  onError?: () => void;
};

type AdminRealtimeStatus = 'connected' | 'reconnecting' | 'offline';

type AdminRealtimeHandlers = {
  onInvalidate?: (payload: unknown) => void;
  onStatusChange?: (status: AdminRealtimeStatus) => void;
  onError?: (payload: unknown) => void;
};

function toQueryString(params: QueryParams = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

async function requestTask<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) {
    throw { status: 401, message: 'Missing access token' };
  }

  return httpRequest<T>(`${API_BASE_URL}${path}`, {
    ...options,
    authToken: token,
  });
}

async function requestAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) {
    throw { status: 401, message: 'Missing access token' };
  }

  return httpRequest<T>(`${AUTH_API_BASE_URL}${path}`, {
    ...options,
    authToken: token,
  });
}

export async function listNotifications(input: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
} = {}) {
  return requestTask<{ data: unknown[]; meta: unknown }>(
    `/notifications${toQueryString(input)}`,
    { method: 'GET' },
  );
}

export async function getUnreadNotificationCount() {
  return requestTask<{ data: { unreadCount: number } }>(
    '/notifications/unread-count',
    { method: 'GET' },
  );
}

export async function markNotificationRead(notificationId: string) {
  return requestTask<{ data: unknown }>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH' },
  );
}

export async function markAllNotificationsRead() {
  return requestTask<{ data: { updated: number } }>('/notifications/read-all', {
    method: 'PATCH',
  });
}

export function connectNotificationsStream(handlers: NotificationStreamHandlers = {}) {
  const token = getToken();
  if (!token) {
    return () => undefined;
  }

  const streamUrl = new URL(`${API_BASE_URL}/notifications/stream`, window.location.origin);
  streamUrl.searchParams.set('token', token);

  const source = new EventSource(streamUrl.toString());
  source.addEventListener('notification.created', (event) => {
    handlers.onCreated?.(safeParseEventData(event));
  });
  source.addEventListener('notification.read', (event) => {
    handlers.onRead?.(safeParseEventData(event));
  });
  source.addEventListener('notification.read-all', (event) => {
    handlers.onRead?.(safeParseEventData(event));
  });
  source.addEventListener('notification.unread-count', (event) => {
    handlers.onUnreadCount?.(safeParseEventData(event));
  });
  source.onerror = () => {
    handlers.onError?.();
  };

  return () => {
    source.close();
  };
}

function safeParseEventData(event: Event): unknown {
  if (!('data' in event) || typeof (event as MessageEvent).data !== 'string') {
    return null;
  }
  try {
    return JSON.parse((event as MessageEvent).data);
  } catch {
    return null;
  }
}

export async function archiveProject(projectId: string) {
  return requestTask<{ data: unknown }>(`/projects/${encodeURIComponent(projectId)}/archive`, {
    method: 'PATCH',
  });
}

export async function restoreProject(projectId: string) {
  return requestTask<{ data: unknown }>(`/projects/${encodeURIComponent(projectId)}/restore`, {
    method: 'PATCH',
  });
}

export async function listWorkspaceActivities(workspaceId: string, query: QueryParams = {}) {
  return requestTask<{ data: unknown[]; meta: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/activities${toQueryString(query)}`,
    { method: 'GET' },
  );
}

export async function listProjectActivities(projectId: string, query: QueryParams = {}) {
  return requestTask<{ data: unknown[]; meta: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/activities${toQueryString(query)}`,
    { method: 'GET' },
  );
}

export async function searchWorkspace(workspaceId: string, query: QueryParams) {
  return requestTask<{ data: Record<string, unknown> }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/search${toQueryString(query)}`,
    { method: 'GET' },
  );
}

export async function listSavedViews(workspaceId: string) {
  return requestTask<{ data: unknown[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/saved-views`,
    { method: 'GET' },
  );
}

export async function createSavedView(workspaceId: string, payload: unknown) {
  return requestTask<{ data: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/saved-views`,
    {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    },
  );
}

export async function updateSavedView(savedViewId: string, payload: unknown) {
  return requestTask<{ data: unknown }>(
    `/saved-views/${encodeURIComponent(savedViewId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
  );
}

export async function deleteSavedView(savedViewId: string) {
  return requestTask<{ success?: boolean }>(
    `/saved-views/${encodeURIComponent(savedViewId)}`,
    { method: 'DELETE' },
  );
}

export async function listTemplates(workspaceId: string) {
  return requestTask<{ data: unknown[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/templates`,
    { method: 'GET' },
  );
}

export async function createTemplate(workspaceId: string, payload: unknown) {
  return requestTask<{ data: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/templates`,
    {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    },
  );
}

export async function updateTemplate(templateId: string, payload: unknown) {
  return requestTask<{ data: unknown }>(`/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}

export async function deleteTemplate(templateId: string) {
  return requestTask<{ success?: boolean }>(`/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  });
}

export async function createProjectFromTemplate(
  workspaceId: string,
  templateId: string,
  payload: unknown,
) {
  return requestTask<{ data: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/projects/from-template`,
    {
      method: 'POST',
      body: JSON.stringify({ ...(payload as Record<string, unknown>), templateId }),
    },
  );
}

export async function getReportOverview(workspaceId: string, query: QueryParams) {
  return requestTask<{ data: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/reports/overview${toQueryString(query)}`,
    { method: 'GET' },
  );
}

export async function getReportBreakdown(workspaceId: string, query: QueryParams) {
  return requestTask<{ data: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/reports/breakdown${toQueryString(query)}`,
    { method: 'GET' },
  );
}

export async function exportReportCsv(
  workspaceId: string,
  query: QueryParams,
): Promise<{ filename: string; blob: Blob }> {
  const token = getToken();
  if (!token) {
    throw { status: 401, message: 'Missing access token' };
  }

  const stopLoading = beginGlobalLoading({
    trackLoading: true,
    loadingScope: 'report.export',
    loadingDelayMs: 500,
  });

  try {
    const url = `${API_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/reports/export.csv${toQueryString(query)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw { status: response.status, message: `Request failed (${response.status})` };
    }

    const disposition = response.headers.get('content-disposition') || '';
    const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = filenameMatch?.[1] || `workspace-${workspaceId}-report.csv`;
    const blob = await response.blob();
    return { filename, blob };
  } finally {
    stopLoading();
  }
}

export async function getAdminSecurityDashboard() {
  return requestAuth<{ data: unknown }>('/admin/dashboard/security', { method: 'GET' });
}

export async function listAdminUsers(query: QueryParams = {}) {
  return requestAuth<{ data: unknown[]; meta: unknown }>(
    `/admin/users${toQueryString(query)}`,
    { method: 'GET' },
  );
}

export async function updateAdminUserStatus(userId: string, status: string) {
  return requestAuth<{ data: unknown }>(`/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateAdminUserSystemRole(userId: string, systemRole: string) {
  return requestAuth<{ data: unknown }>(`/admin/users/${encodeURIComponent(userId)}/system-role`, {
    method: 'PATCH',
    body: JSON.stringify({ systemRole }),
  });
}

export async function listAdminUserSessions(userId: string) {
  return requestAuth<{ data: unknown[] }>(`/admin/users/${encodeURIComponent(userId)}/sessions`, {
    method: 'GET',
  });
}

export async function revokeAdminUserSessions(userId: string, sessionId?: string) {
  return requestAuth<{ data: { revoked: number } }>(
    `/admin/users/${encodeURIComponent(userId)}/sessions/revoke`,
    {
      method: 'POST',
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    },
  );
}

export async function listAdminAuditLogs(query: QueryParams = {}) {
  return requestAuth<{ data: unknown[]; meta: unknown }>(
    `/admin/audit-logs${toQueryString(query)}`,
    { method: 'GET' },
  );
}

function buildAdminRealtimeUrl(token: string): URL {
  const apiBase = new URL(API_BASE_URL, window.location.origin);
  const wsUrl = new URL(apiBase.toString());
  wsUrl.protocol = apiBase.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.pathname = `${apiBase.pathname.replace(/\/+$/, '')}/sync/ws`;
  wsUrl.search = '';
  wsUrl.searchParams.set('token', token);
  wsUrl.searchParams.set('scope', 'admin');
  wsUrl.searchParams.set('workspaceId', '*');
  return wsUrl;
}

export function connectAdminRealtime(handlers: AdminRealtimeHandlers = {}) {
  const token = getToken();
  if (!token) {
    handlers.onStatusChange?.('offline');
    return () => undefined;
  }

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let disconnected = false;
  let status: AdminRealtimeStatus = 'offline';

  const setStatus = (next: AdminRealtimeStatus) => {
    if (status === next) return;
    status = next;
    handlers.onStatusChange?.(next);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (disconnected) return;
    clearReconnectTimer();
    reconnectAttempt += 1;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.max(0, reconnectAttempt - 1)));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disconnected) return;
    try {
      const wsUrl = buildAdminRealtimeUrl(token);
      setStatus('reconnecting');
      socket = new WebSocket(wsUrl.toString());
    } catch (error) {
      handlers.onError?.(error);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      reconnectAttempt = 0;
      setStatus('connected');
    };

    socket.onmessage = (event) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(String(event.data || '{}')) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') return;

      const eventName = typeof parsed.event === 'string' ? parsed.event : '';
      const payload = parsed.data;
      if (eventName === 'sync.invalidate') {
        handlers.onInvalidate?.(payload);
      } else if (eventName === 'sync.error') {
        handlers.onError?.(payload);
      } else if (eventName === 'sync.status') {
        setStatus('connected');
      }
    };

    socket.onclose = () => {
      socket = null;
      if (disconnected) {
        setStatus('offline');
        return;
      }
      setStatus('reconnecting');
      scheduleReconnect();
    };

    socket.onerror = () => {
      handlers.onError?.({ message: 'Admin realtime socket error' });
    };
  };

  connect();

  return () => {
    disconnected = true;
    clearReconnectTimer();
    if (socket) {
      socket.close();
      socket = null;
    }
    setStatus('offline');
  };
}

export function createGovernanceApiCompat() {
  return {
    listNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    connectNotificationsStream,
    archiveProject,
    restoreProject,
    listWorkspaceActivities,
    listProjectActivities,
    searchWorkspace,
    listSavedViews,
    createSavedView,
    updateSavedView,
    deleteSavedView,
    listTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    createProjectFromTemplate,
    getReportOverview,
    getReportBreakdown,
    exportReportCsv,
    getAdminSecurityDashboard,
    listAdminUsers,
    updateAdminUserStatus,
    updateAdminUserSystemRole,
    listAdminUserSessions,
    revokeAdminUserSessions,
    listAdminAuditLogs,
    connectAdminRealtime,
  };
}


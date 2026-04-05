import { AUTH_API_BASE_URL, API_BASE_URL } from '../../config/api';
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
  onEvent?: (payload: unknown) => void;
  onDelta?: (payload: unknown) => void;
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
  return httpRequest<T>(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
  });
}

async function requestAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  return httpRequest<T>(`${AUTH_API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
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
  const streamUrl = new URL(`${API_BASE_URL}/notifications/stream`, window.location.origin);

  const source = new EventSource(streamUrl.toString(), {
    withCredentials: true,
  });
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
  const stopLoading = beginGlobalLoading({
    trackLoading: true,
    loadingScope: 'report.export',
    loadingDelayMs: 500,
  });

  try {
    const url = `${API_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/reports/export.csv${toQueryString(query)}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
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

export async function deleteAdminUser(userId: string) {
  return requestAuth<{ data: { id: string; deleted: true } }>(
    `/admin/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export async function listAdminWorkspaces(query: QueryParams = {}) {
  return requestTask<{ data: unknown[]; meta: unknown }>(
    `/admin/workspaces${toQueryString(query)}`,
    { method: 'GET' },
  );
}

function buildAdminRealtimeUrl(): URL {
  const streamUrl = new URL(`${API_BASE_URL}/sync/stream`, window.location.origin);
  streamUrl.searchParams.set('scope', 'admin');
  streamUrl.searchParams.set('workspaceId', '*');
  return streamUrl;
}

export function connectAdminRealtime(handlers: AdminRealtimeHandlers = {}) {
  let source: EventSource | null = null;
  let disconnected = false;
  let status: AdminRealtimeStatus = 'offline';

  const setStatus = (next: AdminRealtimeStatus) => {
    if (status === next) return;
    status = next;
    handlers.onStatusChange?.(next);
  };

  const connect = () => {
    if (disconnected) return;
    try {
      const streamUrl = buildAdminRealtimeUrl();
      setStatus('reconnecting');
      source = new EventSource(streamUrl.toString(), {
        withCredentials: true,
      });
    } catch (error) {
      handlers.onError?.(error);
      setStatus('offline');
      return;
    }

    source.onopen = () => {
      setStatus('connected');
    };

    source.addEventListener('sync.status', () => {
      setStatus('connected');
    });
    source.addEventListener('sync.invalidate', (event) => {
      handlers.onInvalidate?.(safeParseEventData(event));
    });
    source.addEventListener('admin.event', (event) => {
      handlers.onEvent?.(safeParseEventData(event));
    });
    source.addEventListener('admin.delta', (event) => {
      handlers.onDelta?.(safeParseEventData(event));
    });

    source.onerror = () => {
      if (disconnected) {
        setStatus('offline');
        return;
      }
      setStatus('reconnecting');
      handlers.onError?.({ message: 'Admin realtime stream disconnected' });
    };
  };

  connect();

  return () => {
    disconnected = true;
    if (source) {
      source.close();
      source = null;
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
    deleteAdminUser,
    listAdminWorkspaces,
    connectAdminRealtime,
  };
}


import { httpRequest } from '../../core/http/client';
import { getStoredUser } from '../../core/auth/session';
import { API_BASE_URL } from '../../config/api';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_AUTH_FAILURE_EVENT = 'orbit:task-auth-failure';
const TASK_AUTH_SUCCESS_EVENT = 'orbit:task-auth-success';
const SESSION_ERROR_CODES = new Set([
  'AUTH_UNAUTHORIZED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_MISSING',
  'REFRESH_INVALID',
  'REFRESH_EXPIRED',
  'REFRESH_REUSED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
]);

type WorkspaceRequestOptions = {
  workspaceId?: string;
  idempotencyKey?: string;
};

type TaskAuthEventDetail = {
  source: 'task-api';
  status: number;
  code: string;
  path: string;
  method: string;
  ts: number;
};

function resolveWorkspaceHeader(workspaceId?: string): string {
  if (typeof workspaceId === 'string' && UUID_REGEX.test(workspaceId)) {
    return workspaceId;
  }

  const workspaceIdHint = (window as Window & {
    __ORBIT_ACTIVE_WORKSPACE_ID?: string;
  }).__ORBIT_ACTIVE_WORKSPACE_ID;
  if (typeof workspaceIdHint === 'string' && UUID_REGEX.test(workspaceIdHint)) {
    return workspaceIdHint;
  }

  return '';
}

function toPageQuery(page?: number, limit?: number): string {
  const query = new URLSearchParams();
  if (Number.isInteger(page) && Number(page) > 0) {
    query.set('page', String(page));
  }
  if (Number.isInteger(limit) && Number(limit) > 0) {
    query.set('limit', String(limit));
  }

  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

function withLegacyTaskAliases(task: Record<string, unknown>): Record<string, unknown> {
  const next = { ...task };
  if (typeof next.assigneeUserId === 'string' || next.assigneeUserId === null) {
    next.assigneeId = next.assigneeUserId;
  }
  if (typeof next.createdByUserId === 'string') {
    next.createdBy = next.createdByUserId;
  }
  return next;
}

function normalizeTaskPayload(payload: unknown): Record<string, unknown> {
  const input = payload && typeof payload === 'object'
    ? ({ ...(payload as Record<string, unknown>) })
    : {};

  if (input.assigneeId !== undefined && input.assigneeUserId === undefined) {
    input.assigneeUserId = input.assigneeId;
  }

  return input;
}

function normalizeBoardResponse(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const data = body as Record<string, unknown>;
  const columns = Array.isArray((data as { columns?: unknown[] }).columns)
    ? (data as { columns: unknown[] }).columns
    : [];

  const normalizedColumns = columns.map((column) => {
    if (!column || typeof column !== 'object') {
      return column;
    }

    const rawColumn = column as Record<string, unknown>;
    const tasks = Array.isArray(rawColumn.tasks) ? rawColumn.tasks : [];
    return {
      ...rawColumn,
      tasks: tasks.map((task) =>
        task && typeof task === 'object'
          ? withLegacyTaskAliases(task as Record<string, unknown>)
          : task,
      ),
    };
  });

  return {
    ...data,
    columns: normalizedColumns,
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  requestOptions: WorkspaceRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const workspaceHeader = resolveWorkspaceHeader(requestOptions.workspaceId);
  if (workspaceHeader) {
    headers.set('x-workspace-id', workspaceHeader);
  }
  const idempotencyKey = String(requestOptions.idempotencyKey || '').trim();
  if (idempotencyKey) {
    headers.set('idempotency-key', idempotencyKey);
  }

  const method = String(options.method || 'GET').toUpperCase();
  const normalizedPath = String(path || '').trim() || '/';
  try {
    const result = await httpRequest<T>(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
    emitTaskAuthSuccess(normalizedPath, method);
    return result;
  } catch (error) {
    emitTaskAuthFailure(error, normalizedPath, method);
    throw error;
  }
}

function getSessionHintToken(): string | null {
  const storedUser = getStoredUser();
  return storedUser ? 'cookie-session' : null;
}

function emitTaskAuthSuccess(path: string, method: string): void {
  emitWindowEvent(TASK_AUTH_SUCCESS_EVENT, {
    source: 'task-api',
    status: 200,
    code: '',
    path,
    method,
    ts: Date.now(),
  });
}

function emitTaskAuthFailure(
  error: unknown,
  path: string,
  method: string,
): void {
  const status = readErrorStatus(error);
  const code = readErrorCode(error);
  const isSessionError = SESSION_ERROR_CODES.has(code);

  if (!isSessionError) {
    return;
  }

  const detail: TaskAuthEventDetail = {
    source: 'task-api',
    status,
    code,
    path,
    method,
    ts: Date.now(),
  };
  emitWindowEvent(TASK_AUTH_FAILURE_EVENT, detail);
}

function readErrorStatus(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 0;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : 0;
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') {
    return '';
  }

  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function emitWindowEvent(name: string, detail: TaskAuthEventDetail): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (typeof window.dispatchEvent !== 'function') {
    return;
  }
  if (typeof CustomEvent !== 'function') {
    return;
  }

  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // ignore unsupported browser environments
  }
}

export async function listWorkspaces(page?: number, limit?: number) {
  const body = await request<{ data?: unknown[]; meta?: unknown }>(
    `/workspaces${toPageQuery(page, limit)}`,
    { method: 'GET' },
  );
  return {
    data: Array.isArray(body.data) ? body.data : [],
    meta: body.meta || null,
  };
}

export async function getWorkspace(
  workspaceId: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return body.data || null;
}

export async function createWorkspace(payload: unknown) {
  const body = await request<{ data?: unknown }>('/workspaces', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
  return body.data || null;
}

export async function updateWorkspace(
  workspaceId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function getWorkspaceSettings(
  workspaceId: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/settings`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return body.data || null;
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/settings`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function deleteWorkspace(
  workspaceId: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<Record<string, unknown>>(
    `/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: 'DELETE',
    },
    requestOptions,
  );
  return body || { success: true };
}

export async function ensureWorkspace(name: string) {
  const list = await listWorkspaces(1, 1);
  if (list.data.length > 0) {
    return list.data[0];
  }

  return createWorkspace({
    name: String(name || 'My Workspace').slice(0, 120) || 'My Workspace',
  });
}

export async function listProjects(
  workspaceId: string,
  page?: number,
  limit?: number,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown[]; meta?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/projects${toPageQuery(page, limit)}`,
    { method: 'GET' },
    requestOptions,
  );
  return {
    data: Array.isArray(body.data) ? body.data : [],
    meta: body.meta || null,
  };
}

export async function createProject(
  workspaceId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/projects`,
    {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function updateProject(
  projectId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function deleteProject(projectId: string, requestOptions: WorkspaceRequestOptions = {}) {
  const body = await request<Record<string, unknown>>(
    `/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'DELETE',
    },
    requestOptions,
  );
  return body || { success: true };
}

export async function getProjectSettings(projectId: string, requestOptions: WorkspaceRequestOptions = {}) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/settings`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return body.data || null;
}

export async function updateProjectSettings(
  projectId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/settings`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function listWorkspaceMembers(workspaceId: string, requestOptions: WorkspaceRequestOptions = {}) {
  const body = await request<{ data?: unknown[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return Array.isArray(body.data) ? body.data : [];
}

export async function addWorkspaceMemberByEmail(
  workspaceId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberUserId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberUserId)}/role`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberUserId: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<Record<string, unknown>>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberUserId)}`,
    {
      method: 'DELETE',
    },
    requestOptions,
  );
  return body || { success: true };
}

export async function listProjectMembers(projectId: string, requestOptions: WorkspaceRequestOptions = {}) {
  const body = await request<{ data?: unknown[] }>(
    `/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return Array.isArray(body.data) ? body.data : [];
}

export async function addProjectMemberByEmail(
  projectId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function updateProjectMemberRole(
  projectId: string,
  memberUserId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberUserId)}/role`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export async function removeProjectMember(
  projectId: string,
  memberUserId: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<Record<string, unknown>>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberUserId)}`,
    {
      method: 'DELETE',
    },
    requestOptions,
  );
  return body || { success: true };
}

export async function getBoard(projectId: string, requestOptions: WorkspaceRequestOptions = {}) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/board`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return normalizeBoardResponse(body.data || null);
}

export async function getWorkspaceBoard(
  workspaceId: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/board`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return normalizeBoardResponse(body.data || null);
}

export async function getCalendar(
  projectId: string,
  from?: string,
  to?: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString();
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/calendar${suffix ? `?${suffix}` : ''}`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return body.data || null;
}

export async function getWorkspaceCalendar(
  workspaceId: string,
  from?: string,
  to?: string,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString();
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/calendar${suffix ? `?${suffix}` : ''}`,
    {
      method: 'GET',
    },
    requestOptions,
  );
  return body.data || null;
}

export async function createTask(
  projectId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/tasks`,
    {
      method: 'POST',
      body: JSON.stringify(normalizeTaskPayload(payload)),
    },
    requestOptions,
  );

  if (body.data && typeof body.data === 'object') {
    return withLegacyTaskAliases(body.data as Record<string, unknown>);
  }
  return body.data || null;
}

export async function createWorkspaceTask(
  workspaceId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/tasks`,
    {
      method: 'POST',
      body: JSON.stringify(normalizeTaskPayload(payload)),
    },
    requestOptions,
  );

  if (body.data && typeof body.data === 'object') {
    return withLegacyTaskAliases(body.data as Record<string, unknown>);
  }
  return body.data || null;
}

export async function updateTask(
  taskId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(normalizeTaskPayload(payload)),
    },
    requestOptions,
  );

  if (body.data && typeof body.data === 'object') {
    return withLegacyTaskAliases(body.data as Record<string, unknown>);
  }
  return body.data || null;
}

export async function deleteTask(taskId: string, requestOptions: WorkspaceRequestOptions = {}) {
  const body = await request<Record<string, unknown>>(
    `/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'DELETE',
    },
    requestOptions,
  );
  return body || { success: true };
}

export async function moveTask(
  taskId: string,
  payload: unknown,
  requestOptions: WorkspaceRequestOptions = {},
) {
  const body = await request<{ data?: unknown }>(
    `/tasks/${encodeURIComponent(taskId)}/move`,
    {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    },
    requestOptions,
  );
  return body.data || null;
}

export function createTaskApiCompat() {
  return {
    apiBase: API_BASE_URL,
    getToken: getSessionHintToken,
    request,
    listWorkspaces,
    getWorkspace,
    createWorkspace,
    updateWorkspace,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    deleteWorkspace,
    ensureWorkspace,
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    getProjectSettings,
    updateProjectSettings,
    listWorkspaceMembers,
    addWorkspaceMemberByEmail,
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
    listProjectMembers,
    addProjectMemberByEmail,
    updateProjectMemberRole,
    removeProjectMember,
    getBoard,
    getWorkspaceBoard,
    getCalendar,
    getWorkspaceCalendar,
    createTask,
    createWorkspaceTask,
    updateTask,
    deleteTask,
    moveTask,
  };
}

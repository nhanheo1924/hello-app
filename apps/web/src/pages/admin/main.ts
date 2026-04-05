import { registerLegacyGlobals } from '../../legacy/register-globals';
import { requireAuth } from '../../core/auth/auth-api';
import { resolveAppPath } from '../../core/config/routes';
import {
  connectAdminRealtime,
  deleteAdminUser,
  exportReportCsv,
  getAdminSecurityDashboard,
  listAdminAuditLogs,
  listAdminUserSessions,
  listAdminUsers,
  listAdminWorkspaces,
  revokeAdminUserSessions,
  updateAdminUserStatus,
  updateAdminUserSystemRole,
} from '../../modules/governance/governance-api';
import { openDialog, showToast } from '../../core/ui/overlay';

registerLegacyGlobals();

type AdminRealtimeStatus = 'connected' | 'reconnecting' | 'offline';

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type AdminUser = {
  id: string;
  email: string;
  status: string;
  systemRole: string;
  twoFactorEnabled?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type AdminAuditLog = {
  id?: string;
  createdAt?: string | null;
  action?: string;
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  detail?: unknown;
};

type AdminWorkspace = {
  id: string;
  name: string;
  ownerUserId: string;
  taskCount?: number;
  memberCount?: number;
  projectCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

const PAGE_SIZE = 20;
const EVENT_FEED_MAX_ITEMS = 120;
const ENABLE_ADMIN_REALTIME_EVENTS_PANEL = false;
const ADMIN_AUTH_EVENT_RELOAD_DELAY_MS = 800;

const currentUser = await requireAuth('/signin/');
if (!currentUser) {
  throw new Error('Authentication required');
}

const systemRole = String(currentUser.systemRole || '').toUpperCase();
if (systemRole !== 'SYSTEM_ADMIN' && systemRole !== 'SUPER_ADMIN') {
  window.location.replace(resolveAppPath('/home/'));
  throw new Error('Admin permission required');
}

const securityMetrics = document.getElementById('securityMetrics');
const usersTableBody = document.getElementById('usersTableBody');
const auditTableBody = document.getElementById('auditTableBody');
const reportStatus = document.getElementById('reportStatus');
const realtimeStatus = document.getElementById('realtimeStatus');
const realtimeEventsFeed = document.getElementById('realtimeEventsFeed');
const workspaceGrid = document.getElementById('workspaceGrid');
const realtimeEventsCard = document.getElementById('realtimeEventsCard');
const workspaceManagementCard = document.getElementById('workspaceManagementCard');

const userSearchInput = document.getElementById('userSearchInput') as HTMLInputElement | null;
const userStatusFilter = document.getElementById('userStatusFilter') as HTMLSelectElement | null;
const userRoleFilter = document.getElementById('userRoleFilter') as HTMLSelectElement | null;
const auditActionInput = document.getElementById('auditActionInput') as HTMLInputElement | null;
const auditEmailInput = document.getElementById('auditEmailInput') as HTMLInputElement | null;

const loadMoreUsersBtn = document.getElementById('loadMoreUsersBtn') as HTMLButtonElement | null;
const loadMoreAuditBtn = document.getElementById('loadMoreAuditBtn') as HTMLButtonElement | null;
const loadMoreWorkspacesBtn = document.getElementById('loadMoreWorkspacesBtn') as HTMLButtonElement | null;

const isRealtimeEventsPanelEnabled =
  ENABLE_ADMIN_REALTIME_EVENTS_PANEL &&
  Boolean(realtimeEventsCard && realtimeEventsFeed);
const isWorkspaceManagementPanelEnabled = Boolean(workspaceManagementCard && workspaceGrid);

if (realtimeEventsCard) {
  realtimeEventsCard.hidden = !isRealtimeEventsPanelEnabled;
}
if (workspaceManagementCard) {
  workspaceManagementCard.hidden = !isWorkspaceManagementPanelEnabled;
}

const state = {
  users: {
    rows: [] as AdminUser[],
    meta: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 } as PaginationMeta,
    loading: false,
  },
  audits: {
    rows: [] as AdminAuditLog[],
    meta: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 } as PaginationMeta,
    loading: false,
  },
  workspaces: {
    rows: [] as AdminWorkspace[],
    meta: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 } as PaginationMeta,
    loading: false,
  },
  security: {
    users: { total: 0, active: 0, locked: 0, disabled: 0 },
    sessions: { active: 0, revokedLast24h: 0 },
    security: { twoFactorEnabledUsers: 0, loginFailuresLast24h: 0 },
  },
};

let adminReloadTimer: number | null = null;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function parseRows<T extends Record<string, unknown>>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === 'object') as T[];
}

function parseMeta(raw: unknown): PaginationMeta {
  const meta = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const page = Number(meta.page);
  const limit = Number(meta.limit);
  const total = Number(meta.total);
  const totalPages = Number(meta.totalPages);
  return {
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : PAGE_SIZE,
    total: Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 1,
  };
}

function updateRealtimeStatus(status: AdminRealtimeStatus): void {
  if (!realtimeStatus) return;
  realtimeStatus.setAttribute('data-status', status);
  if (status === 'connected') {
    realtimeStatus.textContent = 'Realtime: Connected';
  } else if (status === 'reconnecting') {
    realtimeStatus.textContent = 'Realtime: Reconnecting...';
  } else {
    realtimeStatus.textContent = 'Realtime: Offline';
  }
}

function renderSecurityDashboard(): void {
  if (!securityMetrics) return;
  const metrics: Array<[string, unknown]> = [
    ['Users Total', state.security.users.total],
    ['Users Active', state.security.users.active],
    ['Users Locked', state.security.users.locked],
    ['Users Disabled', state.security.users.disabled],
    ['Active Sessions', state.security.sessions.active],
    ['Revoked 24h', state.security.sessions.revokedLast24h],
    ['2FA Enabled Users', state.security.security.twoFactorEnabledUsers],
    ['Login Fail 24h', state.security.security.loginFailuresLast24h],
  ];

  securityMetrics.innerHTML = metrics
    .map(([label, value]) => `
      <article class="metric">
        <span>${escapeHtml(label)}</span>
        <b>${escapeHtml(value)}</b>
      </article>
    `)
    .join('');
}

async function loadSecurityDashboard(): Promise<void> {
  if (!securityMetrics) return;
  securityMetrics.innerHTML = '<div class="metric">Loading...</div>';
  try {
    const response = await getAdminSecurityDashboard();
    const data = response.data && typeof response.data === 'object'
      ? response.data as Record<string, unknown>
      : {};
    const users = data.users && typeof data.users === 'object'
      ? data.users as Record<string, unknown>
      : {};
    const sessions = data.sessions && typeof data.sessions === 'object'
      ? data.sessions as Record<string, unknown>
      : {};
    const security = data.security && typeof data.security === 'object'
      ? data.security as Record<string, unknown>
      : {};

    state.security = {
      users: {
        total: Number(users.total) || 0,
        active: Number(users.active) || 0,
        locked: Number(users.locked) || 0,
        disabled: Number(users.disabled) || 0,
      },
      sessions: {
        active: Number(sessions.active) || 0,
        revokedLast24h: Number(sessions.revokedLast24h) || 0,
      },
      security: {
        twoFactorEnabledUsers: Number(security.twoFactorEnabledUsers) || 0,
        loginFailuresLast24h: Number(security.loginFailuresLast24h) || 0,
      },
    };
    renderSecurityDashboard();
  } catch (error) {
    securityMetrics.innerHTML = `<div class="metric">Cannot load dashboard: ${escapeHtml((error as { message?: string }).message || '')}</div>`;
  }
}

function renderUsersTable(): void {
  if (!usersTableBody) return;
  if (state.users.rows.length === 0) {
    usersTableBody.innerHTML = '<tr><td colspan="6">No users found</td></tr>';
  } else {
    usersTableBody.innerHTML = state.users.rows
      .map((row) => `
        <tr data-user-id="${escapeHtml(row.id)}">
          <td>${escapeHtml(row.email)}</td>
          <td>
            <select data-user-status>
              <option value="ACTIVE" ${row.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="LOCKED" ${row.status === 'LOCKED' ? 'selected' : ''}>LOCKED</option>
              <option value="DISABLED" ${row.status === 'DISABLED' ? 'selected' : ''}>DISABLED</option>
            </select>
          </td>
          <td>
            <select data-user-role>
              <option value="USER" ${row.systemRole === 'USER' ? 'selected' : ''}>USER</option>
              <option value="SYSTEM_ADMIN" ${row.systemRole === 'SYSTEM_ADMIN' ? 'selected' : ''}>SYSTEM_ADMIN</option>
              <option value="SUPER_ADMIN" ${row.systemRole === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN</option>
            </select>
          </td>
          <td>${row.twoFactorEnabled === true ? 'Enabled' : 'Off'}</td>
          <td>${formatDateTime(row.lastLoginAt)}</td>
          <td>
            <div class="row-actions">
              <button type="button" data-act="save">Save</button>
              <button type="button" data-act="sessions">Sessions</button>
              <button type="button" class="danger" data-act="revoke">Revoke All</button>
              <button type="button" class="danger" data-act="delete">Delete</button>
            </div>
          </td>
        </tr>
      `)
      .join('');
  }

  if (loadMoreUsersBtn) {
    const hasMore = state.users.meta.page < state.users.meta.totalPages;
    loadMoreUsersBtn.disabled = state.users.loading || !hasMore;
    loadMoreUsersBtn.textContent = hasMore
      ? `Load more users (${state.users.rows.length}/${state.users.meta.total})`
      : `All users loaded (${state.users.rows.length})`;
  }
}

async function loadUsers(append = false): Promise<void> {
  if (!usersTableBody) return;
  if (state.users.loading) return;
  state.users.loading = true;
  renderUsersTable();

  const nextPage = append ? state.users.meta.page + 1 : 1;
  try {
    const response = await listAdminUsers({
      page: nextPage,
      limit: PAGE_SIZE,
      q: userSearchInput?.value?.trim() || undefined,
      status: userStatusFilter?.value || undefined,
      systemRole: userRoleFilter?.value || undefined,
    });

    const rows = parseRows<AdminUser>(response.data);
    const meta = parseMeta(response.meta);
    state.users.meta = meta;
    state.users.rows = append ? [...state.users.rows, ...rows] : rows;
    renderUsersTable();
  } catch (error) {
    usersTableBody.innerHTML = `<tr><td colspan="6">Cannot load users: ${escapeHtml((error as { message?: string }).message || '')}</td></tr>`;
  } finally {
    state.users.loading = false;
    renderUsersTable();
  }
}

function renderAuditLogs(): void {
  if (!auditTableBody) return;
  if (state.audits.rows.length === 0) {
    auditTableBody.innerHTML = '<tr><td colspan="6">No audit logs</td></tr>';
  } else {
    auditTableBody.innerHTML = state.audits.rows
      .map((row) => {
        const detail = row.detail ? JSON.stringify(row.detail).slice(0, 180) : '';
        return `
          <tr>
            <td>${formatDateTime(row.createdAt)}</td>
            <td>${escapeHtml(row.action)}</td>
            <td>${escapeHtml(row.userId)}</td>
            <td>${escapeHtml(row.email)}</td>
            <td>${escapeHtml(row.ip)}</td>
            <td>${escapeHtml(detail)}</td>
          </tr>
        `;
      })
      .join('');
  }

  if (loadMoreAuditBtn) {
    const hasMore = state.audits.meta.page < state.audits.meta.totalPages;
    loadMoreAuditBtn.disabled = state.audits.loading || !hasMore;
    loadMoreAuditBtn.textContent = hasMore
      ? `Load more logs (${state.audits.rows.length}/${state.audits.meta.total})`
      : `All logs loaded (${state.audits.rows.length})`;
  }
}

async function loadAuditLogs(append = false): Promise<void> {
  if (!auditTableBody) return;
  if (state.audits.loading) return;
  state.audits.loading = true;
  renderAuditLogs();

  const nextPage = append ? state.audits.meta.page + 1 : 1;
  try {
    const response = await listAdminAuditLogs({
      page: nextPage,
      limit: PAGE_SIZE,
      action: auditActionInput?.value?.trim() || undefined,
      email: auditEmailInput?.value?.trim() || undefined,
    });
    const rows = parseRows<AdminAuditLog>(response.data);
    const meta = parseMeta(response.meta);
    state.audits.meta = meta;
    state.audits.rows = append ? [...state.audits.rows, ...rows] : rows;
    renderAuditLogs();
  } catch (error) {
    auditTableBody.innerHTML = `<tr><td colspan="6">Cannot load audit logs: ${escapeHtml((error as { message?: string }).message || '')}</td></tr>`;
  } finally {
    state.audits.loading = false;
    renderAuditLogs();
  }
}

function renderWorkspaceGrid(): void {
  if (!isWorkspaceManagementPanelEnabled) return;
  if (!workspaceGrid) return;
  if (state.workspaces.rows.length === 0) {
    workspaceGrid.innerHTML = '<article class="workspace-card muted">No workspaces found</article>';
  } else {
    workspaceGrid.innerHTML = state.workspaces.rows
      .map((workspace) => `
        <article class="workspace-card" data-workspace-id="${escapeHtml(workspace.id)}">
          <h3>${escapeHtml(workspace.name || 'Untitled Workspace')}</h3>
          <p>${escapeHtml(workspace.id)}</p>
          <p>Owner: ${escapeHtml(workspace.ownerUserId || '—')}</p>
          <div class="workspace-meta">
            <span>Tasks<b>${escapeHtml(workspace.taskCount ?? 0)}</b></span>
            <span>Members<b>${escapeHtml(workspace.memberCount ?? 0)}</b></span>
            <span>Projects<b>${escapeHtml(workspace.projectCount ?? 0)}</b></span>
          </div>
          <p>Created: ${escapeHtml(formatDateTime(workspace.createdAt))}</p>
          <p>Updated: ${escapeHtml(formatDateTime(workspace.updatedAt))}</p>
        </article>
      `)
      .join('');
  }

  if (loadMoreWorkspacesBtn) {
    const hasMore = state.workspaces.meta.page < state.workspaces.meta.totalPages;
    loadMoreWorkspacesBtn.disabled = state.workspaces.loading || !hasMore;
    loadMoreWorkspacesBtn.textContent = hasMore
      ? `Load more workspaces (${state.workspaces.rows.length}/${state.workspaces.meta.total})`
      : `All workspaces loaded (${state.workspaces.rows.length})`;
  }
}

async function loadWorkspaces(append = false): Promise<void> {
  if (!isWorkspaceManagementPanelEnabled) return;
  if (!workspaceGrid) return;
  if (state.workspaces.loading) return;
  state.workspaces.loading = true;
  renderWorkspaceGrid();

  const nextPage = append ? state.workspaces.meta.page + 1 : 1;
  try {
    const response = await listAdminWorkspaces({
      page: nextPage,
      limit: PAGE_SIZE,
    });
    const rows = parseRows<AdminWorkspace>(response.data);
    const meta = parseMeta(response.meta);
    state.workspaces.meta = meta;
    state.workspaces.rows = append ? [...state.workspaces.rows, ...rows] : rows;
    renderWorkspaceGrid();
  } catch (error) {
    workspaceGrid.innerHTML = `<article class="workspace-card muted">Cannot load workspaces: ${escapeHtml((error as { message?: string }).message || '')}</article>`;
  } finally {
    state.workspaces.loading = false;
    renderWorkspaceGrid();
  }
}

function appendRealtimeEvent(payload: unknown): void {
  if (!isRealtimeEventsPanelEnabled) return;
  if (!realtimeEventsFeed) return;
  realtimeEventsFeed.querySelectorAll('.event-feed-empty').forEach((node) => node.remove());

  const record = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const category = typeof record.category === 'string' ? record.category : 'sync';
  const action = typeof record.action === 'string' ? record.action : 'event';
  const outcome = typeof record.outcome === 'string' ? record.outcome : '';
  const metadata = record.metadata && typeof record.metadata === 'object'
    ? record.metadata as Record<string, unknown>
    : {};
  const detailParts = [
    typeof metadata.code === 'string' ? metadata.code : '',
    typeof metadata.message === 'string' ? metadata.message : '',
    typeof record.workspaceId === 'string' ? `workspace=${record.workspaceId}` : '',
  ].filter((part) => part.length > 0);
  const timestampValue =
    typeof record.timestamp === 'number'
      ? record.timestamp
      : Date.now();

  const item = document.createElement('li');
  item.className = 'event-feed-item';
  item.innerHTML = `
    <div class="event-feed-item-head">
      <span class="event-feed-resource">${escapeHtml(`${category}.${action}${outcome ? ` (${outcome})` : ''}`)}</span>
      <span class="event-feed-time">${escapeHtml(new Date(timestampValue).toLocaleTimeString())}</span>
    </div>
    <div class="event-feed-detail">${escapeHtml(detailParts.join(' | ') || 'Realtime update')}</div>
  `;
  realtimeEventsFeed.insertBefore(item, realtimeEventsFeed.firstChild);

  while (realtimeEventsFeed.childElementCount > EVENT_FEED_MAX_ITEMS) {
    realtimeEventsFeed.lastElementChild?.remove();
  }
}

function applyAdminDelta(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const delta = payload as Record<string, unknown>;
  const resource = typeof delta.resource === 'string' ? delta.resource : '';
  const operation = typeof delta.operation === 'string' ? delta.operation : '';
  const row = delta.payload && typeof delta.payload === 'object'
    ? delta.payload as Record<string, unknown>
    : null;

  if (resource === 'user' && row) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) return;
    const index = state.users.rows.findIndex((item) => item.id === id);
    if (operation === 'delete') {
      if (index >= 0) {
        state.users.rows.splice(index, 1);
        renderUsersTable();
      }
      return;
    }
    if (index >= 0) {
      state.users.rows[index] = { ...state.users.rows[index], ...row } as AdminUser;
    } else if (operation === 'create') {
      state.users.rows.unshift(row as AdminUser);
    }
    renderUsersTable();
    return;
  }

  if (resource === 'workspace' && row) {
    if (!isWorkspaceManagementPanelEnabled) return;
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) return;
    const index = state.workspaces.rows.findIndex((item) => item.id === id);
    if (operation === 'delete') {
      if (index >= 0) {
        state.workspaces.rows.splice(index, 1);
        renderWorkspaceGrid();
      }
      return;
    }
    if (index >= 0) {
      state.workspaces.rows[index] = { ...state.workspaces.rows[index], ...row } as AdminWorkspace;
    } else if (operation === 'create') {
      state.workspaces.rows.unshift(row as AdminWorkspace);
    }
    renderWorkspaceGrid();
    return;
  }

  if (resource === 'task' || resource === 'membership' || resource === 'project') {
    if (!isWorkspaceManagementPanelEnabled) return;
    const workspaceId = row && typeof row.workspaceId === 'string' ? row.workspaceId : '';
    if (!workspaceId) return;
    const workspace = state.workspaces.rows.find((item) => item.id === workspaceId);
    if (!workspace) return;

    if (resource === 'task') {
      if (operation === 'create') {
        workspace.taskCount = Number(workspace.taskCount || 0) + 1;
      } else if (operation === 'delete') {
        workspace.taskCount = Math.max(0, Number(workspace.taskCount || 0) - 1);
      }
    }

    if (resource === 'membership') {
      if (operation === 'create') {
        workspace.memberCount = Number(workspace.memberCount || 0) + 1;
      } else if (operation === 'delete') {
        workspace.memberCount = Math.max(0, Number(workspace.memberCount || 0) - 1);
      }
    }

    if (resource === 'project') {
      if (operation === 'create') {
        workspace.projectCount = Number(workspace.projectCount || 0) + 1;
      } else if (operation === 'delete') {
        workspace.projectCount = Math.max(0, Number(workspace.projectCount || 0) - 1);
      }
    }

    renderWorkspaceGrid();
  }
}

function applyRealtimeSecurityDelta(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const record = payload as Record<string, unknown>;
  const category = typeof record.category === 'string' ? record.category : '';
  const action = typeof record.action === 'string' ? record.action : '';
  const outcome = typeof record.outcome === 'string' ? record.outcome : '';

  if (category === 'auth' && action === 'login' && outcome === 'failure') {
    state.security.security.loginFailuresLast24h += 1;
    renderSecurityDashboard();
    return;
  }
  if (category === 'auth' && (action === 'signup' || action === 'register') && outcome === 'success') {
    state.security.users.total += 1;
    state.security.users.active += 1;
    renderSecurityDashboard();
    return;
  }
  if (category === 'auth' && action.startsWith('admin/users') && outcome === 'success') {
    void loadSecurityDashboard();
  }
}

function shouldReloadForAuthLifecycleEvent(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  const category = typeof record.category === 'string' ? record.category.toLowerCase() : '';
  if (category !== 'auth') return false;

  const outcome = typeof record.outcome === 'string' ? record.outcome.toLowerCase() : '';
  if (outcome !== 'success') return false;

  const action = typeof record.action === 'string' ? record.action.toLowerCase() : '';
  return action === 'login' || action === 'logout' || action === 'signup' || action === 'register';
}

function scheduleAdminReloadForAuthLifecycle(payload: unknown): void {
  if (!shouldReloadForAuthLifecycleEvent(payload)) return;
  if (adminReloadTimer !== null) return;
  adminReloadTimer = window.setTimeout(() => {
    window.location.reload();
  }, ADMIN_AUTH_EVENT_RELOAD_DELAY_MS);
}

async function handleUserAction(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('button[data-act]');
  if (!button) return;

  const row = button.closest<HTMLTableRowElement>('tr[data-user-id]');
  const userId = row?.dataset.userId || '';
  if (!userId || !row) return;

  const action = button.dataset.act;
  if (action === 'save') {
    const statusSelect = row.querySelector<HTMLSelectElement>('select[data-user-status]');
    const roleSelect = row.querySelector<HTMLSelectElement>('select[data-user-role]');
    const status = statusSelect?.value || '';
    const role = roleSelect?.value || '';
    await updateAdminUserStatus(userId, status);
    await updateAdminUserSystemRole(userId, role);
    showToast('User updated');
    return;
  }

  if (action === 'sessions') {
    const response = await listAdminUserSessions(userId);
    const sessions = parseRows<Record<string, unknown>>(response.data);
    const text = sessions
      .slice(0, 20)
      .map((session) => `${session.id} | ${formatDateTime(session.createdAt)} | ${escapeHtml(session.createdByIp)}`)
      .join('\n');
    await openDialog({
      title: 'Active Sessions',
      message: text || 'No sessions',
      confirmLabel: 'Close',
      type: 'info',
    });
    return;
  }

  if (action === 'revoke') {
    const confirmed = await openDialog({
      title: 'Revoke Sessions',
      message: 'Revoke all active sessions for this user?',
      confirmLabel: 'Revoke',
      cancelLabel: 'Cancel',
      type: 'confirm',
    });
    if (!confirmed.confirmed) return;
    await revokeAdminUserSessions(userId);
    showToast('Sessions revoked');
    return;
  }

  if (action === 'delete') {
    const confirmed = await openDialog({
      title: 'Delete User',
      message: 'This permanently deletes the user account. Continue?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      type: 'confirm',
    });
    if (!confirmed.confirmed) return;
    await deleteAdminUser(userId);
    state.users.rows = state.users.rows.filter((entry) => entry.id !== userId);
    renderUsersTable();
    showToast('User deleted');
  }
}

async function handleExportReport(): Promise<void> {
  const workspaceInput = document.getElementById('reportWorkspaceId') as HTMLInputElement | null;
  const fromInput = document.getElementById('reportFrom') as HTMLInputElement | null;
  const toInput = document.getElementById('reportTo') as HTMLInputElement | null;
  const typeInput = document.getElementById('reportType') as HTMLSelectElement | null;

  const workspaceId = workspaceInput?.value?.trim() || '';
  if (!workspaceId) {
    if (reportStatus) reportStatus.textContent = 'Workspace ID is required';
    showToast('Workspace ID is required');
    return;
  }

  if (reportStatus) reportStatus.textContent = 'Exporting...';
  try {
    const result = await exportReportCsv(workspaceId, {
      from: fromInput?.value || undefined,
      to: toInput?.value || undefined,
      type: typeInput?.value || 'summary',
    });
    const objectUrl = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    if (reportStatus) reportStatus.textContent = `Exported ${result.filename}`;
    showToast(`Exported ${result.filename}`);
  } catch (error) {
    if (reportStatus) {
      reportStatus.textContent = `Export failed: ${String((error as { message?: string }).message || 'Unknown error')}`;
    }
    showToast('Export failed');
  }
}

async function refreshAll(): Promise<void> {
  const tasks: Array<Promise<void>> = [
    loadSecurityDashboard(),
    loadUsers(false),
    loadAuditLogs(false),
  ];
  if (isWorkspaceManagementPanelEnabled) {
    tasks.push(loadWorkspaces(false));
  }
  await Promise.all(tasks);
}

document.getElementById('refreshBtn')?.addEventListener('click', () => {
  void refreshAll();
});
document.getElementById('applyUserFilterBtn')?.addEventListener('click', () => {
  void loadUsers(false);
});
document.getElementById('applyAuditFilterBtn')?.addEventListener('click', () => {
  void loadAuditLogs(false);
});
document.getElementById('exportReportBtn')?.addEventListener('click', () => {
  void handleExportReport();
});
loadMoreUsersBtn?.addEventListener('click', () => {
  void loadUsers(true);
});
loadMoreAuditBtn?.addEventListener('click', () => {
  void loadAuditLogs(true);
});
loadMoreWorkspacesBtn?.addEventListener('click', () => {
  if (!isWorkspaceManagementPanelEnabled) return;
  void loadWorkspaces(true);
});
usersTableBody?.addEventListener('click', (event) => {
  void handleUserAction(event);
});

updateRealtimeStatus('reconnecting');
let hadConnection = false;
const disconnectAdminRealtime = connectAdminRealtime({
  onInvalidate: (payload) => {
    appendRealtimeEvent(payload);
  },
  onEvent: (payload) => {
    appendRealtimeEvent(payload);
    applyRealtimeSecurityDelta(payload);
    scheduleAdminReloadForAuthLifecycle(payload);
  },
  onDelta: (payload) => {
    applyAdminDelta(payload);
  },
  onStatusChange: (status) => {
    const wasDisconnected = hadConnection && status === 'connected';
    if (status === 'connected') {
      hadConnection = true;
    }
    updateRealtimeStatus(status);
    if (wasDisconnected) {
      void refreshAll();
    }
  },
  onError: (payload) => {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Admin realtime connection error';
    console.warn('Admin realtime error:', message);
  },
});

window.addEventListener('beforeunload', () => {
  if (adminReloadTimer !== null) {
    window.clearTimeout(adminReloadTimer);
    adminReloadTimer = null;
  }
  disconnectAdminRealtime();
}, { once: true });

void refreshAll();

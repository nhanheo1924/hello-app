import { registerLegacyGlobals } from '../../legacy/register-globals';
import { requireAuth } from '../../core/auth/auth-api';
import { resolveAppPath } from '../../core/config/routes';
import {
  connectAdminRealtime,
  exportReportCsv,
  getAdminSecurityDashboard,
  listAdminAuditLogs,
  listAdminUserSessions,
  listAdminUsers,
  revokeAdminUserSessions,
  updateAdminUserStatus,
  updateAdminUserSystemRole,
} from '../../modules/governance/governance-api';
import { openDialog, showToast } from '../../core/ui/overlay';

registerLegacyGlobals();

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

const userSearchInput = document.getElementById('userSearchInput') as HTMLInputElement | null;
const userStatusFilter = document.getElementById('userStatusFilter') as HTMLSelectElement | null;
const userRoleFilter = document.getElementById('userRoleFilter') as HTMLSelectElement | null;
const auditActionInput = document.getElementById('auditActionInput') as HTMLInputElement | null;
const auditEmailInput = document.getElementById('auditEmailInput') as HTMLInputElement | null;

type AdminSectionKey = 'security' | 'users' | 'audit';

const sectionRefreshTimers = new Map<AdminSectionKey, number>();
const sectionDebounceMs: Record<AdminSectionKey, number> = {
  security: 200,
  users: 220,
  audit: 260,
};

const EVENT_FEED_MAX_ITEMS = 60;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}

function parseRows(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
}

function resolveInvalidateResource(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as Record<string, unknown>;
  return typeof record.resource === 'string' ? record.resource.trim().toLowerCase() : '';
}

function resolveInvalidateWorkspace(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as Record<string, unknown>;
  return typeof record.workspaceId === 'string' ? record.workspaceId.trim() : '';
}

function appendRealtimeEvent(payload: unknown): void {
  if (!realtimeEventsFeed) {
    return;
  }

  realtimeEventsFeed.querySelectorAll('.event-feed-empty').forEach((node) => node.remove());

  const resource = resolveInvalidateResource(payload) || 'sync.invalidate';
  const workspaceId = resolveInvalidateWorkspace(payload);
  const time = new Date();
  const item = document.createElement('li');
  item.className = 'event-feed-item';
  item.innerHTML = `
    <div class="event-feed-item-head">
      <span class="event-feed-resource">${escapeHtml(resource)}</span>
      <span class="event-feed-time">${escapeHtml(time.toLocaleTimeString())}</span>
    </div>
    <div class="event-feed-detail">${escapeHtml(workspaceId ? `Workspace ${workspaceId}` : 'Global scope')}</div>
  `;
  realtimeEventsFeed.insertBefore(item, realtimeEventsFeed.firstChild);

  while (realtimeEventsFeed.childElementCount > EVENT_FEED_MAX_ITEMS) {
    realtimeEventsFeed.lastElementChild?.remove();
  }
}

function resolveSectionsForResource(resource: string): AdminSectionKey[] {
  switch (resource) {
    case 'admin.users':
      return ['users', 'security'];
    case 'admin.audit':
      return ['audit', 'security'];
    case 'admin.security':
      return ['security'];
    case 'admin.tasks':
      return ['audit', 'security'];
    default:
      return ['security', 'users', 'audit'];
  }
}

function refreshSection(section: AdminSectionKey): void {
  if (section === 'security') {
    void loadSecurityDashboard();
    return;
  }
  if (section === 'users') {
    void loadUsers();
    return;
  }
  void loadAuditLogs();
}

function scheduleSectionRefresh(section: AdminSectionKey): void {
  const existing = sectionRefreshTimers.get(section);
  if (typeof existing === 'number') {
    window.clearTimeout(existing);
  }

  const timeout = window.setTimeout(() => {
    sectionRefreshTimers.delete(section);
    refreshSection(section);
  }, sectionDebounceMs[section]);
  sectionRefreshTimers.set(section, timeout);
}

function scheduleResourceRefresh(payload: unknown): void {
  const resource = resolveInvalidateResource(payload);
  const sections = resolveSectionsForResource(resource);
  sections.forEach((section) => {
    scheduleSectionRefresh(section);
  });
}

function updateRealtimeStatus(status: 'connected' | 'reconnecting' | 'offline'): void {
  if (!realtimeStatus) {
    return;
  }
  realtimeStatus.setAttribute('data-status', status);
  if (status === 'connected') {
    realtimeStatus.textContent = 'Realtime: Connected';
    return;
  }
  if (status === 'reconnecting') {
    realtimeStatus.textContent = 'Realtime: Reconnecting...';
    return;
  }
  realtimeStatus.textContent = 'Realtime: Offline';
}

async function loadSecurityDashboard(): Promise<void> {
  if (!securityMetrics) {
    return;
  }

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

    const metrics = [
      ['Users Total', users.total],
      ['Users Active', users.active],
      ['Users Locked', users.locked],
      ['Users Disabled', users.disabled],
      ['Active Sessions', sessions.active],
      ['Revoked 24h', sessions.revokedLast24h],
      ['2FA Enabled Users', security.twoFactorEnabledUsers],
      ['Login Fail 24h', security.loginFailuresLast24h],
    ];

    securityMetrics.innerHTML = metrics
      .map(([label, value]) => `
        <article class="metric">
          <span>${escapeHtml(label)}</span>
          <b>${escapeHtml(value)}</b>
        </article>
      `)
      .join('');
  } catch (error) {
    securityMetrics.innerHTML = `<div class="metric">Cannot load dashboard: ${escapeHtml((error as { message?: string }).message || '')}</div>`;
  }
}

async function loadUsers(): Promise<void> {
  if (!usersTableBody) {
    return;
  }

  usersTableBody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
  try {
    const response = await listAdminUsers({
      page: 1,
      limit: 50,
      q: userSearchInput?.value?.trim() || undefined,
      status: userStatusFilter?.value || undefined,
      systemRole: userRoleFilter?.value || undefined,
    });

    const rows = parseRows(response.data);
    if (rows.length === 0) {
      usersTableBody.innerHTML = '<tr><td colspan="6">No users found</td></tr>';
      return;
    }

    usersTableBody.innerHTML = rows
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id : '';
        const status = typeof row.status === 'string' ? row.status : 'USER';
        const role = typeof row.systemRole === 'string' ? row.systemRole : 'USER';
        return `
          <tr data-user-id="${escapeHtml(id)}">
            <td>${escapeHtml(row.email)}</td>
            <td>
              <select data-user-status>
                <option value="ACTIVE" ${status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
                <option value="LOCKED" ${status === 'LOCKED' ? 'selected' : ''}>LOCKED</option>
                <option value="DISABLED" ${status === 'DISABLED' ? 'selected' : ''}>DISABLED</option>
              </select>
            </td>
            <td>
              <select data-user-role>
                <option value="USER" ${role === 'USER' ? 'selected' : ''}>USER</option>
                <option value="SYSTEM_ADMIN" ${role === 'SYSTEM_ADMIN' ? 'selected' : ''}>SYSTEM_ADMIN</option>
                <option value="SUPER_ADMIN" ${role === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN</option>
              </select>
            </td>
            <td>${row.twoFactorEnabled === true ? 'Enabled' : 'Off'}</td>
            <td>${formatDateTime(row.lastLoginAt)}</td>
            <td>
              <div class="row-actions">
                <button type="button" data-act="save">Save</button>
                <button type="button" data-act="sessions">Sessions</button>
                <button type="button" class="danger" data-act="revoke">Revoke All</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (error) {
    usersTableBody.innerHTML = `<tr><td colspan="6">Cannot load users: ${escapeHtml((error as { message?: string }).message || '')}</td></tr>`;
  }
}

async function loadAuditLogs(): Promise<void> {
  if (!auditTableBody) {
    return;
  }

  auditTableBody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
  try {
    const response = await listAdminAuditLogs({
      page: 1,
      limit: 60,
      action: auditActionInput?.value?.trim() || undefined,
      email: auditEmailInput?.value?.trim() || undefined,
    });

    const rows = parseRows(response.data);
    if (rows.length === 0) {
      auditTableBody.innerHTML = '<tr><td colspan="6">No audit logs</td></tr>';
      return;
    }

    auditTableBody.innerHTML = rows
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
  } catch (error) {
    auditTableBody.innerHTML = `<tr><td colspan="6">Cannot load audit logs: ${escapeHtml((error as { message?: string }).message || '')}</td></tr>`;
  }
}

async function handleUserAction(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('button[data-act]');
  if (!button) {
    return;
  }

  const row = button.closest<HTMLTableRowElement>('tr[data-user-id]');
  const userId = row?.dataset.userId || '';
  if (!userId || !row) {
    return;
  }

  const action = button.dataset.act;
  if (action === 'save') {
    const statusSelect = row.querySelector<HTMLSelectElement>('select[data-user-status]');
    const roleSelect = row.querySelector<HTMLSelectElement>('select[data-user-role]');
    const status = statusSelect?.value || '';
    const role = roleSelect?.value || '';

    await updateAdminUserStatus(userId, status);
    await updateAdminUserSystemRole(userId, role);
    await loadUsers();
    return;
  }

  if (action === 'sessions') {
    const response = await listAdminUserSessions(userId);
    const sessions = parseRows(response.data);
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
    if (!confirmed.confirmed) {
      return;
    }

    await revokeAdminUserSessions(userId);
    await loadUsers();
    showToast('Sessions revoked');
  }
}

async function handleExportReport(): Promise<void> {
  const workspaceInput = document.getElementById('reportWorkspaceId') as HTMLInputElement | null;
  const fromInput = document.getElementById('reportFrom') as HTMLInputElement | null;
  const toInput = document.getElementById('reportTo') as HTMLInputElement | null;
  const typeInput = document.getElementById('reportType') as HTMLSelectElement | null;

  const workspaceId = workspaceInput?.value?.trim() || '';
  if (!workspaceId) {
    if (reportStatus) {
      reportStatus.textContent = 'Workspace ID is required';
    }
    showToast('Workspace ID is required');
    return;
  }

  if (reportStatus) {
    reportStatus.textContent = 'Exporting...';
  }

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

    if (reportStatus) {
      reportStatus.textContent = `Exported ${result.filename}`;
    }
    showToast(`Exported ${result.filename}`);
  } catch (error) {
    if (reportStatus) {
      reportStatus.textContent = `Export failed: ${String((error as { message?: string }).message || 'Unknown error')}`;
    }
    showToast('Export failed');
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([loadSecurityDashboard(), loadUsers(), loadAuditLogs()]);
}

document.getElementById('refreshBtn')?.addEventListener('click', () => {
  void refreshAll();
});
document.getElementById('applyUserFilterBtn')?.addEventListener('click', () => {
  void loadUsers();
});
document.getElementById('applyAuditFilterBtn')?.addEventListener('click', () => {
  void loadAuditLogs();
});
document.getElementById('exportReportBtn')?.addEventListener('click', () => {
  void handleExportReport();
});
usersTableBody?.addEventListener('click', (event) => {
  void handleUserAction(event);
});

updateRealtimeStatus('reconnecting');
const disconnectAdminRealtime = connectAdminRealtime({
  onInvalidate: (payload) => {
    appendRealtimeEvent(payload);
    scheduleResourceRefresh(payload);
  },
  onStatusChange: (status) => {
    updateRealtimeStatus(status);
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
  sectionRefreshTimers.forEach((timer) => {
    window.clearTimeout(timer);
  });
  sectionRefreshTimers.clear();
  disconnectAdminRealtime();
}, { once: true });

void refreshAll();


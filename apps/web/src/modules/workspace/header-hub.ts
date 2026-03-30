import { getToken } from '../../core/auth/session';

const STYLE_ID = 'orbit-header-hub-style';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'orbitActiveWorkspaceIdV1';
const WORKSPACE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WorkspaceMemberRow = {
  userId?: string;
  role?: string;
  user?: {
    displayName?: string | null;
    fullName?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  } | null;
};

function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID_REGEX.test(value.trim());
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  .orbit-workspace-switch { display: inline-flex; align-items: center; gap: 8px; margin-right: 10px; }
  .orbit-workspace-switch label { font-size: 12px; color: rgba(255,255,255,0.74); text-transform: uppercase; letter-spacing: 0.05em; }
  .orbit-workspace-switch select {
    min-width: 180px; max-width: 280px; height: 36px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.92); padding: 0 10px; outline: none;
  }
  .header-governance-actions { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
  .header-share-btn, .header-profile-btn {
    height: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.24);
    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.9); cursor: pointer;
  }
  .header-share-btn { padding: 0 14px; font-size: 14px; font-weight: 600; }
  .header-profile-btn {
    width: 40px; min-width: 40px; border-radius: 999px; padding: 0; overflow: hidden;
    display: inline-flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700;
  }
  .header-profile-btn img { width: 100%; height: 100%; object-fit: cover; }
  .orbit-share-panel {
    position: absolute; top: calc(100% + 8px); right: 0; width: min(440px, 92vw);
    max-height: min(62vh, 560px); overflow: auto; z-index: 90;
    background: rgba(12,12,14,0.98); border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
    box-shadow: 0 18px 36px rgba(0,0,0,0.35); color: #dbeafe; padding: 10px;
  }
  .orbit-share-panel[hidden] { display: none; }
  .orbit-share-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .orbit-share-head b { color: #fff; font-size: 14px; }
  .orbit-share-head button {
    height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.92);
    padding: 0 10px; cursor: pointer; font-size: 12px;
  }
  .orbit-share-tools {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin-bottom: 8px; padding: 6px 8px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03);
  }
  .orbit-share-tools span { color: rgba(255,255,255,0.86); font-size: 11px; letter-spacing: 0.01em; }
  .orbit-share-tools button {
    height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.95);
    padding: 0 10px; cursor: pointer; font-size: 11px; font-weight: 600;
  }
  .orbit-share-tools button:hover { background: rgba(255,255,255,0.14); }
  .orbit-share-add { display: grid; grid-template-columns: 1fr 116px auto; gap: 8px; margin-bottom: 8px; }
  .orbit-share-add input, .orbit-share-add select {
    height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.92); padding: 0 10px;
    font-size: 12px;
  }
  .orbit-share-add button {
    height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.9);
    color: #000; padding: 0 12px; cursor: pointer; font-weight: 600;
    font-size: 12px;
  }
  .orbit-share-list { display: grid; gap: 8px; }
  .orbit-share-row {
    display: grid; grid-template-columns: 1fr 120px auto auto; gap: 8px; align-items: center;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 10px;
  }
  .orbit-share-row.is-owner {
    grid-template-columns: 1fr auto;
  }
  .orbit-share-user { display: grid; gap: 2px; }
  .orbit-share-name { color: #fff; font-size: 13px; font-weight: 600; }
  .orbit-share-email { color: rgba(219,234,254,0.8); font-size: 12px; }
  .orbit-share-owner-chip {
    height: 30px; min-width: 90px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.95);
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0 12px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
  }
  .orbit-share-row select {
    height: 32px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.92); padding: 0 8px;
    font-size: 12px;
  }
  .orbit-share-row button {
    height: 32px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); padding: 0 10px; cursor: pointer;
    font-size: 12px;
  }
  .orbit-share-row button[data-act="remove"] { color: #fecaca; border-color: rgba(248,113,113,0.35); }
  .orbit-share-status { min-height: 16px; margin-bottom: 6px; font-size: 11px; color: #bfdbfe; }
  .orbit-share-empty { color: rgba(219,234,254,0.78); font-size: 11px; padding: 8px 4px; }
  @media (max-width: 900px) {
    .orbit-workspace-switch { width: 100%; margin: 8px 0 0; }
    .orbit-workspace-switch select { min-width: 0; width: 100%; }
    .orbit-share-add { grid-template-columns: 1fr; }
    .orbit-share-row { grid-template-columns: 1fr; }
  }
  `;
  document.head.appendChild(style);
}

function getActiveWorkspaceId(): string {
  const stored = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || '';
  if (isWorkspaceId(stored)) {
    return stored;
  }
  const hinted = (window as Window & { __ORBIT_ACTIVE_WORKSPACE_ID?: string })
    .__ORBIT_ACTIVE_WORKSPACE_ID;
  return isWorkspaceId(hinted) ? hinted : '';
}

function setActiveWorkspaceId(workspaceId: string, dispatch = true): void {
  if (!isWorkspaceId(workspaceId)) {
    return;
  }
  (window as Window & { __ORBIT_ACTIVE_WORKSPACE_ID?: string }).__ORBIT_ACTIVE_WORKSPACE_ID =
    workspaceId;
  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  if (dispatch) {
    window.dispatchEvent(
      new CustomEvent('orbit:workspace-changed', { detail: { workspaceId } }),
    );
  }
}

function getDisplayName(member: WorkspaceMemberRow): string {
  const user = member.user || {};
  const displayName =
    (typeof user.displayName === 'string' ? user.displayName.trim() : '') ||
    (typeof user.fullName === 'string' ? user.fullName.trim() : '');
  if (displayName) {
    return displayName;
  }
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  if (email.includes('@')) {
    return email.split('@')[0];
  }
  return 'User';
}

function getEmail(member: WorkspaceMemberRow): string {
  const email = typeof member.user?.email === 'string' ? member.user.email.trim() : '';
  return email || 'No email';
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getProfileSeed(): { label: string; avatarUrl: string } {
  const authUser =
    window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
      ? window.OrbitAuth.getStoredUser()
      : null;
  const seed =
    (typeof authUser?.displayName === 'string' && authUser.displayName.trim()) ||
    (typeof authUser?.fullName === 'string' && authUser.fullName.trim()) ||
    (typeof authUser?.username === 'string' && authUser.username.trim()) ||
    (typeof authUser?.email === 'string' && authUser.email.trim()) ||
    'U';
  const avatarUrl =
    typeof authUser?.avatarUrl === 'string' && authUser.avatarUrl.trim().length > 0
      ? authUser.avatarUrl.trim()
      : '';
  return { label: seed.slice(0, 1).toUpperCase(), avatarUrl };
}

function setStatus(node: HTMLElement | null, message: string): void {
  if (!node) {
    return;
  }
  node.textContent = message;
}

function ensureHubConfirmModal(): HTMLElement {
  let modal = document.getElementById('orbit-share-confirm-modal');
  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'orbit-share-confirm-modal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.display = 'none';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.background = 'rgba(0,0,0,0.55)';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="width:min(420px,92vw);background:rgba(12,12,14,0.98);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:14px;">
      <div id="orbit-share-confirm-title" style="color:#fff;font-size:15px;font-weight:600;letter-spacing:0.04em;margin-bottom:8px;">Confirm</div>
      <div id="orbit-share-confirm-message" style="color:rgba(255,255,255,0.86);font-size:13px;line-height:1.45;margin-bottom:14px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button id="orbit-share-confirm-cancel" type="button" style="height:34px;border-radius:9px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.9);padding:0 12px;cursor:pointer;">Cancel</button>
        <button id="orbit-share-confirm-ok" type="button" style="height:34px;border-radius:9px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.92);color:#000;padding:0 14px;cursor:pointer;font-weight:600;">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function confirmHubAction(title: string, message: string): Promise<boolean> {
  const modal = ensureHubConfirmModal();
  const titleNode = document.getElementById('orbit-share-confirm-title');
  const messageNode = document.getElementById('orbit-share-confirm-message');
  const cancelBtn = document.getElementById('orbit-share-confirm-cancel');
  const okBtn = document.getElementById('orbit-share-confirm-ok');
  if (!titleNode || !messageNode || !cancelBtn || !okBtn) {
    return Promise.resolve(false);
  }

  titleNode.textContent = title;
  messageNode.textContent = message;

  return new Promise((resolve) => {
    const close = (result: boolean): void => {
      modal.style.display = 'none';
      modal.onclick = null;
      cancelBtn.onclick = null;
      okBtn.onclick = null;
      resolve(result);
    };

    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    modal.onclick = (event) => {
      if (event.target === modal) {
        close(false);
      }
    };
    modal.style.display = 'flex';
    (okBtn as HTMLButtonElement).focus();
  });
}

function getErrorCode(error: unknown): string {
  const code =
    error &&
    typeof error === 'object' &&
    (error as { body?: { code?: unknown } }).body &&
    typeof (error as { body?: { code?: unknown } }).body?.code === 'string'
      ? (error as { body: { code: string } }).body.code
      : '';
  return code;
}

function resolveWorkspaceSettingsPath(workspaceId: string): string {
  const basePath =
    window.OrbitAuth && typeof window.OrbitAuth.resolvePath === 'function'
      ? window.OrbitAuth.resolvePath('/workspace-setting/')
      : '/workspace-setting/';
  const url = new URL(basePath, window.location.origin);
  if (isWorkspaceId(workspaceId)) {
    url.searchParams.set('workspaceId', workspaceId);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function mountHeaderHub(): void {
  if (!getToken()) {
    return;
  }

  const header = document.querySelector<HTMLElement>('.content-header');
  if (!header) {
    return;
  }

  ensureStyle();

  const headerLeft = header.querySelector<HTMLElement>('.header-left');
  const headerRight =
    header.querySelector<HTMLElement>('.header-right') ||
    (() => {
      const node = document.createElement('div');
      node.className = 'header-right';
      header.appendChild(node);
      return node;
    })();

  // Workspace selector is intentionally hidden from UI.

  if (headerRight.querySelector('.header-governance-actions')) {
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'header-governance-actions';
  actions.style.position = 'relative';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'header-share-btn';
  shareButton.textContent = 'Share';

  const profileButton = document.createElement('button');
  profileButton.type = 'button';
  profileButton.className = 'header-profile-btn';
  profileButton.setAttribute('aria-label', 'Profile');
  profileButton.title = 'Profile';
  const profile = getProfileSeed();
  if (profile.avatarUrl) {
    const img = document.createElement('img');
    img.src = profile.avatarUrl;
    img.alt = 'profile';
    profileButton.appendChild(img);
  } else {
    profileButton.textContent = profile.label;
  }
  profileButton.addEventListener('click', () => {
    const path =
      window.OrbitAuth && typeof window.OrbitAuth.resolvePath === 'function'
        ? window.OrbitAuth.resolvePath('/setting/#tab-account')
        : '/setting/#tab-account';
    window.location.href = path;
  });

  const panel = document.createElement('section');
  panel.className = 'orbit-share-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="orbit-share-head">
      <b>Workspace Members</b>
      <button type="button" data-act="refresh">Refresh</button>
    </div>
    <div class="orbit-share-status" data-el="status"></div>
    <div class="orbit-share-tools">
      <span>Workspace Settings</span>
      <button type="button" data-act="open-workspace-settings">Open</button>
    </div>
    <div class="orbit-share-add">
      <input type="email" data-el="email" placeholder="member@example.com" />
      <select data-el="role">
        <option value="MEMBER">MEMBER</option>
        <option value="ADMIN">ADMIN</option>
        <option value="VIEWER">VIEWER</option>
      </select>
      <button type="button" data-act="invite">Invite</button>
    </div>
    <div class="orbit-share-list" data-el="list"></div>
  `;

  const statusNode = panel.querySelector<HTMLElement>('[data-el="status"]');
  const listNode = panel.querySelector<HTMLElement>('[data-el="list"]');
  const emailInput = panel.querySelector<HTMLInputElement>('[data-el="email"]');
  const roleSelect = panel.querySelector<HTMLSelectElement>('[data-el="role"]');

  async function loadWorkspaceSelector(): Promise<void> {
    const selector = document.getElementById('orbitWorkspaceSelector') as HTMLSelectElement | null;
    if (!selector || !window.OrbitTaskApi || typeof window.OrbitTaskApi.listWorkspaces !== 'function') {
      return;
    }

    const response = await window.OrbitTaskApi.listWorkspaces(1, 100);
    const rows = Array.isArray(response?.data) ? response.data : [];
    if (rows.length === 0 && typeof window.OrbitTaskApi.ensureWorkspace === 'function') {
      await window.OrbitTaskApi.ensureWorkspace('My Workspace');
      const refreshed = await window.OrbitTaskApi.listWorkspaces(1, 100);
      const refreshedRows = Array.isArray(refreshed?.data) ? refreshed.data : [];
      selector.innerHTML = refreshedRows
        .map((workspace: any) => `<option value="${workspace.id}">${workspace.name}</option>`)
        .join('');
      if (refreshedRows.length > 0) {
        const fallbackId = getActiveWorkspaceId() || String(refreshedRows[0].id || '');
        if (isWorkspaceId(fallbackId)) {
          selector.value = fallbackId;
          setActiveWorkspaceId(fallbackId, true);
        }
      }
      return;
    }

    selector.innerHTML = rows
      .map((workspace: any) => `<option value="${workspace.id}">${workspace.name}</option>`)
      .join('');
    if (rows.length > 0) {
      const fallbackId = getActiveWorkspaceId() || String(rows[0].id || '');
      if (isWorkspaceId(fallbackId)) {
        selector.value = fallbackId;
        setActiveWorkspaceId(fallbackId, true);
      }
    }
  }

  function currentWorkspaceId(): string {
    const selector = document.getElementById('orbitWorkspaceSelector') as HTMLSelectElement | null;
    if (selector && isWorkspaceId(selector.value)) {
      return selector.value;
    }
    return getActiveWorkspaceId();
  }

  async function refreshMembers(): Promise<void> {
    if (!listNode || !window.OrbitTaskApi) {
      return;
    }
    const workspaceId = currentWorkspaceId();
    if (!isWorkspaceId(workspaceId)) {
      listNode.innerHTML = '<div class="orbit-share-empty">Workspace is not selected</div>';
      return;
    }

    setStatus(statusNode, 'Loading members...');
    try {
      const members = await window.OrbitTaskApi.listWorkspaceMembers(workspaceId);
      const rows = Array.isArray(members) ? members : [];
      if (rows.length === 0) {
        listNode.innerHTML = '<div class="orbit-share-empty">No members yet</div>';
        setStatus(statusNode, '');
        return;
      }

      listNode.innerHTML = rows
        .map((member: WorkspaceMemberRow) => {
          const memberUserId = typeof member.userId === 'string' ? member.userId : '';
          const role = typeof member.role === 'string' ? member.role : 'MEMBER';
          const isOwner = role === 'OWNER';
          const displayName = escapeHtml(getDisplayName(member));
          const displayEmail = escapeHtml(getEmail(member));
          if (isOwner) {
            return `
              <div class="orbit-share-row is-owner" data-user-id="${escapeHtml(memberUserId)}">
                <div class="orbit-share-user">
                  <div class="orbit-share-name">${displayName}</div>
                  <div class="orbit-share-email">${displayEmail}</div>
                </div>
                <div class="orbit-share-owner-chip">OWNER</div>
              </div>
            `;
          }
          const roleOptions = isOwner
            ? '<option value="OWNER">OWNER</option>'
            : `
              <option value="ADMIN" ${role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
              <option value="MEMBER" ${role === 'MEMBER' ? 'selected' : ''}>MEMBER</option>
              <option value="VIEWER" ${role === 'VIEWER' ? 'selected' : ''}>VIEWER</option>
            `;
          return `
            <div class="orbit-share-row" data-user-id="${escapeHtml(memberUserId)}">
              <div class="orbit-share-user">
                <div class="orbit-share-name">${displayName}</div>
                <div class="orbit-share-email">${displayEmail}</div>
              </div>
              <select ${isOwner ? 'disabled' : ''}>${roleOptions}</select>
              <button type="button" data-act="save-role" ${isOwner ? 'disabled' : ''}>Save</button>
              <button type="button" data-act="remove" title="Remove member" aria-label="Remove member" ${isOwner ? 'disabled' : ''}>\u2A02</button>
            </div>
          `;
        })
        .join('');
      setStatus(statusNode, '');
    } catch (error) {
      setStatus(
        statusNode,
        `Cannot load members: ${String((error as { message?: string }).message || 'Unknown error')}`,
      );
      listNode.innerHTML = '<div class="orbit-share-empty">Failed to load members</div>';
    }
  }

  async function addMember(): Promise<void> {
    if (!window.OrbitTaskApi || !emailInput || !roleSelect) {
      return;
    }
    const workspaceId = currentWorkspaceId();
    if (!isWorkspaceId(workspaceId)) {
      setStatus(statusNode, 'Workspace is not selected');
      return;
    }

    const email = String(emailInput.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus(statusNode, 'Please enter a valid email');
      return;
    }
    const role = String(roleSelect.value || 'MEMBER').toUpperCase();

    try {
      await window.OrbitTaskApi.addWorkspaceMemberByEmail(workspaceId, { email, role });
      emailInput.value = '';
      setStatus(statusNode, 'Member invited');
      await refreshMembers();
    } catch (error) {
      if (getErrorCode(error) === 'USER_NOT_REGISTERED') {
        setStatus(statusNode, 'USER_NOT_REGISTERED: Email has not registered yet');
        return;
      }
      setStatus(
        statusNode,
        `Invite failed: ${String((error as { message?: string }).message || 'Unknown error')}`,
      );
    }
  }

  actions.appendChild(shareButton);
  actions.appendChild(profileButton);
  actions.appendChild(panel);
  headerRight.appendChild(actions);

  const selector = document.getElementById('orbitWorkspaceSelector') as HTMLSelectElement | null;
  selector?.addEventListener('change', () => {
    if (!isWorkspaceId(selector.value)) {
      return;
    }
    setActiveWorkspaceId(selector.value, true);
    void refreshMembers();
  });

  window.addEventListener('orbit:workspace-changed', (event) => {
    const detail =
      event && typeof event === 'object' && 'detail' in event
        ? (event as CustomEvent<{ workspaceId?: unknown }>).detail
        : null;
    const workspaceId = detail && typeof detail.workspaceId === 'string' ? detail.workspaceId : '';
    if (!isWorkspaceId(workspaceId) || !selector) {
      return;
    }
    if (selector.value !== workspaceId) {
      selector.value = workspaceId;
    }
  });

  shareButton.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      void refreshMembers();
    }
  });

  panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionNode = target.closest<HTMLElement>('[data-act]');
    if (!actionNode) {
      return;
    }
    const action = actionNode.dataset.act;

    if (action === 'refresh') {
      void refreshMembers();
      return;
    }
    if (action === 'open-workspace-settings') {
      const workspaceId = currentWorkspaceId();
      if (isWorkspaceId(workspaceId)) {
        setActiveWorkspaceId(workspaceId, false);
      }
      panel.hidden = true;
      const openEvent = new CustomEvent('orbit:open-workspace-settings', {
        detail: { workspaceId },
        cancelable: true,
      });
      const shouldFallbackNavigation = window.dispatchEvent(openEvent);
      if (shouldFallbackNavigation) {
        window.location.href = resolveWorkspaceSettingsPath(workspaceId);
      }
      return;
    }
    if (action === 'invite') {
      void addMember();
      return;
    }
    if (!window.OrbitTaskApi) {
      return;
    }

    const row = target.closest<HTMLElement>('.orbit-share-row[data-user-id]');
    const memberUserId = row?.dataset.userId || '';
    const workspaceId = currentWorkspaceId();
    if (!row || !isWorkspaceId(workspaceId) || !isWorkspaceId(memberUserId)) {
      return;
    }

    if (action === 'save-role') {
      const select = row.querySelector<HTMLSelectElement>('select');
      const role = String(select?.value || 'MEMBER').toUpperCase();
      const nameNode = row.querySelector<HTMLElement>('.orbit-share-name');
      const memberName = String(nameNode?.textContent || 'member').trim() || 'member';
      void confirmHubAction(
        'Confirm Role Update',
        `Update role for ${memberName} to ${role}?`,
      )
        .then((confirmed) => {
          if (!confirmed) {
            return null;
          }
          return window.OrbitTaskApi.updateWorkspaceMemberRole(workspaceId, memberUserId, { role });
        })
        .then((result) => {
          if (result === null) {
            return;
          }
          setStatus(statusNode, 'Member role updated');
          void refreshMembers();
        })
        .catch((error: unknown) => {
          setStatus(
            statusNode,
            `Update failed: ${String((error as { message?: string }).message || 'Unknown error')}`,
          );
        });
      return;
    }

    if (action === 'remove') {
      const nameNode = row.querySelector<HTMLElement>('.orbit-share-name');
      const memberName = String(nameNode?.textContent || 'member').trim() || 'member';
      void confirmHubAction(
        'Confirm Member Removal',
        `Remove ${memberName} from this workspace?`,
      )
        .then((confirmed) => {
          if (!confirmed) {
            return null;
          }
          return window.OrbitTaskApi.removeWorkspaceMember(workspaceId, memberUserId);
        })
        .then((result) => {
          if (result === null) {
            return;
          }
          setStatus(statusNode, 'Member removed');
          void refreshMembers();
        })
        .catch((error: unknown) => {
          setStatus(
            statusNode,
            `Remove failed: ${String((error as { message?: string }).message || 'Unknown error')}`,
          );
        });
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!actions.contains(target)) {
      panel.hidden = true;
    }
  });

  if (selector) {
    void loadWorkspaceSelector();
  }
}

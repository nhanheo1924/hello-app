async function bootstrapSettingPage() {
    const auth = window.OrbitAuth;
    const route = (path) => (
        auth && typeof auth.resolvePath === 'function'
            ? auth.resolvePath(path)
            : path
    );
    if (!auth) {
        window.location.href = route('/signin/');
        return;
    }
    const user = await auth.requireAuth('/signin/');
    if (!user) {
        return;
    }

    function toProfile(input) {
        if (!input || typeof input !== 'object') return null;
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!email) return null;
        const firstName = typeof input.firstName === 'string' && input.firstName.trim()
            ? input.firstName.trim()
            : '';
        const lastName = typeof input.lastName === 'string' && input.lastName.trim()
            ? input.lastName.trim()
            : '';
        const fullName = typeof input.fullName === 'string' && input.fullName.trim()
            ? input.fullName.trim()
            : '';
        const profileDisplayName = typeof input.displayName === 'string' && input.displayName.trim()
            ? input.displayName.trim()
            : '';
        const username = typeof input.username === 'string' && input.username.trim()
            ? input.username.trim()
            : '';
        const splitName = [firstName, lastName].filter(Boolean).join(' ').trim();
        const dob = typeof input.dob === 'string' && input.dob.trim()
            ? input.dob.trim().slice(0, 10)
            : '';
        const address = typeof input.address === 'string' && input.address.trim()
            ? input.address.trim()
            : '';
        const displayName = splitName || profileDisplayName || fullName || username || email.split('@')[0];
        return {
            email,
            displayName,
            fullName: fullName || null,
            firstName: firstName || null,
            lastName: lastName || null,
            dob: dob || null,
            address: address || null,
            timezone: typeof input.timezone === 'string' ? input.timezone.trim() : '',
            locale: typeof input.locale === 'string' ? input.locale.trim().toLowerCase() : '',
            twoFactorEnabled: input.twoFactorEnabled === true
        };
    }

    const navIcons = document.querySelectorAll('.nav-menu .nav-icon');
    if (navIcons[0]) navIcons[0].textContent = '\u25CB';
    if (navIcons[1]) navIcons[1].textContent = '\u2699';
    const navChevron = document.querySelector('.nav-menu .chevron');
    if (navChevron) navChevron.textContent = '\u25BE';
    const saveIcon = document.querySelector('.save-icon');
    if (saveIcon) saveIcon.textContent = '\u2726';
    const rangePreviewEl = document.getElementById('rangePreview');
    if (rangePreviewEl) rangePreviewEl.textContent = '\u2014 days selected';
    const langSelectEl = document.getElementById('langSelect');
    if (langSelectEl) {
        const langMap = { vi: 'Tieng Viet', ja: 'Japanese', fr: 'Francais' };
        [...langSelectEl.options].forEach((opt) => {
            if (langMap[opt.value]) opt.textContent = langMap[opt.value];
        });
    }
    const uploadText = document.querySelector('label[for="bgUpload"] span');
    if (uploadText) uploadText.textContent = '\u2191 Upload';
    const exportBtnLabel = document.getElementById('exportBtn');
    if (exportBtnLabel) exportBtnLabel.textContent = 'Export \u2193';
    const durMinusBtn = document.getElementById('durMinus');
    if (durMinusBtn) durMinusBtn.textContent = '\u2212';
    const remMinusBtn = document.getElementById('remMinus');
    if (remMinusBtn) remMinusBtn.textContent = '\u2212';
    const avatarDisplay = document.getElementById('avatarDisplay');
    if (avatarDisplay && !avatarDisplay.querySelector('img')) avatarDisplay.textContent = '\u2726';
    const HOT_ROUTE_NAV_KEY = 'orbitHotRouteNavV1';
    const HOT_ROUTE_NAV_TTL_MS = 2 * 60 * 1000;

    function parseHotRouteNavigation() {
        try {
            const raw = sessionStorage.getItem(HOT_ROUTE_NAV_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function clearHotRouteNavigation() {
        try {
            sessionStorage.removeItem(HOT_ROUTE_NAV_KEY);
        } catch (_) {
            // ignore cache cleanup failures
        }
    }

    function resolveHomePath() {
        const homeUrl = new URL(route('/home/'), window.location.origin);
        return `${homeUrl.pathname}${homeUrl.search}${homeUrl.hash}`;
    }

    function canBackToHomeFromHistory() {
        if (window.history.length <= 1) {
            return false;
        }

        const navHint = parseHotRouteNavigation();
        const fromPath = navHint && typeof navHint.from === 'string' ? navHint.from : '';
        const toPath = navHint && typeof navHint.to === 'string' ? navHint.to : '';
        const changedAt = Number(navHint && navHint.at);
        const normalizedFromPath = String(fromPath || '').trim();
        const normalizedToPath = String(toPath || '').trim();
        const isHotPathHint = normalizedFromPath.endsWith('/home/') && normalizedToPath.endsWith('/setting/');
        const isFreshHint = Number.isFinite(changedAt) && Date.now() - changedAt <= HOT_ROUTE_NAV_TTL_MS;

        if (isHotPathHint && isFreshHint) {
            return true;
        }

        if (!document.referrer) {
            return false;
        }

        try {
            const referrerUrl = new URL(document.referrer);
            return referrerUrl.origin === window.location.origin && referrerUrl.pathname.endsWith('/home/');
        } catch (_) {
            return false;
        }
    }

    function navigateBackToHome() {
        const homePath = resolveHomePath();
        const shouldUseHistoryBack = canBackToHomeFromHistory();
        clearHotRouteNavigation();

        if (shouldUseHistoryBack) {
            window.history.back();
            return;
        }

        if (window.parent && window.parent !== window) {
            window.parent.postMessage(
                {
                    type: 'orbit-shell-navigate',
                    path: homePath
                },
                window.location.origin
            );
            return;
        }

        window.location.href = homePath;
    }

    const logo = document.querySelector('.logo');
    if (logo) {
        logo.style.cursor = 'pointer';
        logo.addEventListener('click', navigateBackToHome);
    }

    const settingsBackToHomeNav = document.getElementById('settingsBackToHomeNav');
    if (settingsBackToHomeNav) {
        settingsBackToHomeNav.addEventListener('click', navigateBackToHome);
        settingsBackToHomeNav.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigateBackToHome();
            }
        });
    }

    const SETTINGS_KEY = 'orbitSettings';
    const PROJECTS_KEY = 'helloProjectsState';
    const REMOTE_PROJECTS_SNAPSHOT_KEY = 'orbitRemoteProjectsSnapshotSessionV1';
    const REMOTE_PROJECTS_SYNC_RESOURCE_KEY = 'tasks.remote.projectsSnapshot';
    const REMOTE_PROJECTS_TTL_MS = 10 * 1000;
    const LEGACY_TIMEZONE_MAP = {
        'UTC+7 (Ho Chi Minh)': 'Asia/Ho_Chi_Minh',
        'UTC+0 (London)': 'Europe/London',
        'UTC-5 (New York)': 'America/New_York',
        'UTC+9 (Tokyo)': 'Asia/Tokyo',
        'UTC+8 (Singapore)': 'Asia/Singapore'
    };

    const sessionSync =
        window.OrbitSessionSync && typeof window.OrbitSessionSync === 'object'
            ? window.OrbitSessionSync
            : null;

    function isUuid(value) {
        return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    function flattenBoardTasks(board) {
        const unique = new Map();
        const columns = board && Array.isArray(board.columns) ? board.columns : [];
        columns.forEach((column) => {
            const tasks = column && Array.isArray(column.tasks) ? column.tasks : [];
            tasks.forEach((task) => {
                if (!task || typeof task.id !== 'string') return;
                if (!unique.has(task.id)) {
                    unique.set(task.id, task);
                }
            });
        });
        return [...unique.values()];
    }

    async function mapWithConcurrency(items, limit, mapper) {
        const source = Array.isArray(items) ? items : [];
        if (source.length === 0) return [];

        const safeLimit = Math.max(1, Number(limit) || 1);
        const results = new Array(source.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(safeLimit, source.length) }).map(async () => {
            while (true) {
                const currentIndex = cursor;
                cursor += 1;
                if (currentIndex >= source.length) return;
                results[currentIndex] = await mapper(source[currentIndex], currentIndex);
            }
        });
        await Promise.all(workers);
        return results;
    }

    function readCachedRemoteProjectsSnapshot() {
        try {
            const raw = sessionStorage.getItem(REMOTE_PROJECTS_SNAPSHOT_KEY);
            if (!raw) return null;
            const parsed = safeParse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function writeCachedRemoteProjectsSnapshot(snapshot) {
        try {
            sessionStorage.setItem(REMOTE_PROJECTS_SNAPSHOT_KEY, JSON.stringify(snapshot));
        } catch (_) {
            // ignore session cache failures
        }
        if (sessionSync && typeof sessionSync.markFresh === 'function') {
            sessionSync.markFresh(REMOTE_PROJECTS_SYNC_RESOURCE_KEY);
        }
    }

    function clearCachedRemoteProjectsSnapshot() {
        try {
            sessionStorage.removeItem(REMOTE_PROJECTS_SNAPSHOT_KEY);
        } catch (_) {
            // ignore session cache failures
        }
        if (sessionSync && typeof sessionSync.invalidate === 'function') {
            sessionSync.invalidate(REMOTE_PROJECTS_SYNC_RESOURCE_KEY);
        }
    }

    function isCachedRemoteProjectsSnapshotFresh() {
        if (!sessionSync || typeof sessionSync.isFresh !== 'function') {
            return false;
        }
        return sessionSync.isFresh(REMOTE_PROJECTS_SYNC_RESOURCE_KEY, REMOTE_PROJECTS_TTL_MS);
    }

    async function loadRemoteProjectsSnapshot(options = {}) {
        const forceRefresh = options.forceRefresh === true;
        const cachedSnapshot = readCachedRemoteProjectsSnapshot();
        if (!forceRefresh && cachedSnapshot && isCachedRemoteProjectsSnapshotFresh()) {
            return cachedSnapshot;
        }

        if (!window.OrbitTaskApi || typeof window.OrbitTaskApi.ensureWorkspace !== 'function') {
            return cachedSnapshot || [];
        }
        try {
            const workspacesResponse = await window.OrbitTaskApi.listWorkspaces(1, 100);
            let workspaces = Array.isArray(workspacesResponse?.data) ? workspacesResponse.data : [];
            if (workspaces.length === 0) {
                const workspace = await window.OrbitTaskApi.ensureWorkspace('My Workspace');
                workspaces = workspace && isUuid(workspace.id) ? [workspace] : [];
            }
            const workspaceIds = workspaces
                .map((workspace) => (workspace && typeof workspace.id === 'string' ? workspace.id : ''))
                .filter((workspaceId) => isUuid(workspaceId));
            if (workspaceIds.length === 0) {
                return cachedSnapshot || [];
            }

            const workspaceById = new Map(
                workspaces
                    .filter((workspace) => workspace && typeof workspace.id === 'string')
                    .map((workspace) => [workspace.id, workspace])
            );

            const mappedSnapshot = await mapWithConcurrency(workspaceIds, 3, async (workspaceId) => {
                const workspaceMeta = workspaceById.get(workspaceId) || {};
                const board = await window.OrbitTaskApi.getWorkspaceBoard(workspaceId, { workspaceId });
                return {
                    id: workspaceId,
                    workspaceId,
                    name: typeof workspaceMeta.name === 'string' ? workspaceMeta.name : 'Workspace',
                    board,
                    tasks: flattenBoardTasks(board)
                };
            });
            const snapshot = mappedSnapshot.filter((item) => Boolean(item));

            writeCachedRemoteProjectsSnapshot(snapshot);
            return snapshot;
        } catch (error) {
            if (cachedSnapshot) {
                return cachedSnapshot;
            }
            throw error;
        }
    }

    async function clearRemoteTasks() {
        const projects = await loadRemoteProjectsSnapshot();
        const allTasks = projects.flatMap((project) => (Array.isArray(project.tasks) ? project.tasks : []));
        const taskIds = allTasks
            .map((task) => (task && typeof task.id === 'string' ? task.id : ''))
            .filter((id) => id);
        await mapWithConcurrency(taskIds, 4, async (taskId) => {
            await window.OrbitTaskApi.deleteTask(taskId);
            return true;
        });
        clearCachedRemoteProjectsSnapshot();
    }

    const WORKSPACE_MEMBER_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'];
    const workspaceMemberState = {
        workspaceId: '',
        members: [],
        canManage: false,
        loading: false
    };
    const workspaceIdFromQuery = new URLSearchParams(window.location.search).get('workspaceId') || '';
    if (isUuid(workspaceIdFromQuery)) {
        workspaceMemberState.workspaceId = workspaceIdFromQuery;
    }

    function normalizeEmailInput(value) {
        const email = String(value || '').trim().toLowerCase();
        if (!email) return '';
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
    }

    function resolveWorkspaceMemberIdentity(member) {
        const user = member && typeof member.user === 'object' ? member.user : {};
        const userId = typeof member?.userId === 'string' ? member.userId : '';
        const role = typeof member?.role === 'string' ? member.role.toUpperCase() : 'MEMBER';
        const displayName = (
            (typeof user.displayName === 'string' && user.displayName.trim()) ||
            (typeof user.fullName === 'string' && user.fullName.trim()) ||
            (typeof user.email === 'string' && user.email.includes('@') ? user.email.split('@')[0] : '') ||
            (typeof member?.email === 'string' && member.email.includes('@') ? member.email.split('@')[0] : '')
        ).trim() || 'User';
        const email = (
            (typeof user.email === 'string' && user.email.trim()) ||
            (typeof member?.email === 'string' && member.email.trim())
        ).trim();
        return {
            userId,
            role,
            displayName,
            email,
            isOwner: role === 'OWNER'
        };
    }

    function systemCanManageWorkspaceMembers() {
        const systemRole = typeof user?.systemRole === 'string'
            ? user.systemRole.trim().toUpperCase()
            : 'USER';
        return systemRole === 'SUPER_ADMIN' || systemRole === 'SYSTEM_ADMIN';
    }

    function ensureWorkspaceMembersUI() {
        const workspaceTab = document.getElementById('tab-workspace');
        if (!workspaceTab) return null;

        let section = document.getElementById('workspaceMembersSection');
        if (section) return section;

        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = 'Workspace Members';

        section = document.createElement('div');
        section.className = 'card';
        section.id = 'workspaceMembersSection';

        const controls = document.createElement('div');
        controls.className = 'card-row';
        controls.style.gap = '8px';
        controls.style.alignItems = 'center';
        controls.innerHTML = `
            <input id="workspaceMemberEmailInput" class="date-input" type="email" placeholder="member@example.com" style="max-width:240px;" />
            <select id="workspaceMemberRoleSelect" class="date-input" style="max-width:130px;">
                <option value="MEMBER">MEMBER</option>
                <option value="VIEWER">VIEWER</option>
                <option value="ADMIN">ADMIN</option>
            </select>
            <button id="workspaceMemberAddBtn" class="save-btn" type="button" style="padding:8px 12px;">Add</button>
            <button id="workspaceMemberRefreshBtn" class="step-btn" type="button">Refresh</button>
        `;

        const divider = document.createElement('div');
        divider.className = 'card-divider';

        const list = document.createElement('div');
        list.id = 'workspaceMembersList';
        list.style.display = 'grid';
        list.style.gap = '8px';
        list.style.paddingTop = '8px';

        section.appendChild(controls);
        section.appendChild(divider);
        section.appendChild(list);

        workspaceTab.appendChild(title);
        workspaceTab.appendChild(section);
        return section;
    }

    function ensureActionConfirmModal() {
        let modal = document.getElementById('workspaceActionConfirmModal');
        if (modal) {
            return modal;
        }

        modal = document.createElement('div');
        modal.id = 'workspaceActionConfirmModal';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.zIndex = '12000';
        modal.style.display = 'none';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.background = 'rgba(0,0,0,0.52)';

        modal.innerHTML = `
            <div style="width:min(420px,92vw);background:#111114;border:1px solid rgba(255,255,255,0.16);border-radius:14px;padding:16px 16px 14px;color:rgba(255,255,255,0.92);box-shadow:0 18px 42px rgba(0,0,0,0.42);">
                <div id="workspaceActionConfirmTitle" style="font-size:16px;letter-spacing:0.04em;font-weight:600;margin-bottom:8px;">Confirm</div>
                <div id="workspaceActionConfirmMessage" style="font-size:14px;line-height:1.45;color:rgba(255,255,255,0.82);margin-bottom:14px;"></div>
                <div style="display:flex;justify-content:flex-end;gap:8px;">
                    <button id="workspaceActionConfirmCancel" type="button" style="height:34px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.9);cursor:pointer;">Cancel</button>
                    <button id="workspaceActionConfirmOk" type="button" style="height:34px;padding:0 14px;border-radius:9px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.9);color:#000;cursor:pointer;font-weight:600;">Confirm</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    function confirmWorkspaceAction(title, message) {
        const modal = ensureActionConfirmModal();
        const titleEl = document.getElementById('workspaceActionConfirmTitle');
        const messageEl = document.getElementById('workspaceActionConfirmMessage');
        const okBtn = document.getElementById('workspaceActionConfirmOk');
        const cancelBtn = document.getElementById('workspaceActionConfirmCancel');

        if (!titleEl || !messageEl || !okBtn || !cancelBtn) {
            return Promise.resolve(false);
        }

        titleEl.textContent = title || 'Confirm Action';
        messageEl.textContent = message || 'Are you sure?';

        return new Promise((resolve) => {
            const cleanup = () => {
                modal.style.display = 'none';
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                modal.onclick = null;
            };
            okBtn.onclick = () => {
                cleanup();
                resolve(true);
            };
            cancelBtn.onclick = () => {
                cleanup();
                resolve(false);
            };
            modal.onclick = (event) => {
                if (event.target === modal) {
                    cleanup();
                    resolve(false);
                }
            };
            modal.style.display = 'flex';
            okBtn.focus();
        });
    }

    function normalizeRoleValue(value) {
        const normalized = String(value || '').trim().toUpperCase();
        if (normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'MEMBER' || normalized === 'VIEWER') {
            return normalized;
        }
        return 'MEMBER';
    }

    function renderWorkspaceMembers() {
        const section = ensureWorkspaceMembersUI();
        if (!section) return;
        const list = document.getElementById('workspaceMembersList');
        const addBtn = document.getElementById('workspaceMemberAddBtn');
        const refreshBtn = document.getElementById('workspaceMemberRefreshBtn');
        const roleSelect = document.getElementById('workspaceMemberRoleSelect');
        const emailInput = document.getElementById('workspaceMemberEmailInput');

        if (!list || !addBtn || !refreshBtn || !roleSelect || !emailInput) return;
        addBtn.disabled = !workspaceMemberState.canManage || workspaceMemberState.loading;
        refreshBtn.disabled = workspaceMemberState.loading;
        roleSelect.disabled = !workspaceMemberState.canManage || workspaceMemberState.loading;
        emailInput.disabled = !workspaceMemberState.canManage || workspaceMemberState.loading;

        list.innerHTML = '';
        if (workspaceMemberState.members.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = workspaceMemberState.loading ? 'Loading members...' : 'No workspace members';
            empty.style.opacity = '0.8';
            list.appendChild(empty);
            return;
        }

        workspaceMemberState.members.forEach((member) => {
            const row = document.createElement('div');
            row.className = 'card-row';
            row.style.gap = '8px';
            row.style.alignItems = 'center';

            const identityData = resolveWorkspaceMemberIdentity(member);
            const identity = document.createElement('div');
            identity.style.flex = '1';
            const nameLine = document.createElement('div');
            nameLine.textContent = identityData.displayName;
            nameLine.style.fontWeight = '600';
            nameLine.style.color = 'rgba(255,255,255,0.88)';
            const metaLine = document.createElement('div');
            metaLine.textContent = identityData.email || identityData.userId || 'No email';
            metaLine.style.fontSize = '12px';
            metaLine.style.opacity = '0.75';
            identity.appendChild(nameLine);
            identity.appendChild(metaLine);
            row.appendChild(identity);

            const roleEditor = document.createElement('select');
            roleEditor.className = 'date-input';
            roleEditor.style.maxWidth = '130px';
            const roleOptions = identityData.isOwner ? ['OWNER'] : WORKSPACE_MEMBER_ROLES;
            roleOptions.forEach((role) => {
                const option = document.createElement('option');
                option.value = role;
                option.textContent = role;
                roleEditor.appendChild(option);
            });
            roleEditor.value = identityData.role;
            roleEditor.disabled = identityData.isOwner || !workspaceMemberState.canManage || workspaceMemberState.loading;
            row.appendChild(roleEditor);

            if (identityData.isOwner) {
                roleEditor.style.maxWidth = '108px';
                roleEditor.disabled = true;
                list.appendChild(row);
                return;
            }

            const saveRoleBtn = document.createElement('button');
            saveRoleBtn.type = 'button';
            saveRoleBtn.className = 'step-btn';
            saveRoleBtn.textContent = 'Update';
            saveRoleBtn.disabled = identityData.isOwner || !workspaceMemberState.canManage || workspaceMemberState.loading;
            saveRoleBtn.addEventListener('click', async () => {
                if (!workspaceMemberState.workspaceId || !isUuid(identityData.userId)) return;
                if (normalizeRoleValue(roleEditor.value) === normalizeRoleValue(identityData.role)) {
                    showToast('No role changes to save');
                    return;
                }
                const confirmed = await confirmWorkspaceAction(
                    'Confirm Role Update',
                    `Update role for ${identityData.displayName} to ${roleEditor.value}?`
                );
                if (!confirmed) return;
                try {
                    await window.OrbitTaskApi.updateWorkspaceMemberRole(
                        workspaceMemberState.workspaceId,
                        identityData.userId,
                        { role: roleEditor.value }
                    );
                    showToast('Workspace member updated');
                    await refreshWorkspaceMembers();
                } catch (error) {
                    const message = error && typeof error === 'object' && typeof error.message === 'string'
                        ? error.message
                        : 'Cannot update workspace member';
                    showToast(message);
                }
            });
            row.appendChild(saveRoleBtn);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'step-btn';
            removeBtn.textContent = '\u2A02';
            removeBtn.setAttribute('aria-label', `Remove ${identityData.displayName}`);
            removeBtn.title = `Remove ${identityData.displayName}`;
            removeBtn.style.width = '32px';
            removeBtn.style.height = '32px';
            removeBtn.style.minWidth = '32px';
            removeBtn.style.padding = '0';
            removeBtn.style.borderRadius = '999px';
            removeBtn.disabled = identityData.isOwner || !workspaceMemberState.canManage || workspaceMemberState.loading;
            removeBtn.addEventListener('click', async () => {
                if (!workspaceMemberState.workspaceId || !isUuid(identityData.userId)) return;
                const confirmed = await confirmWorkspaceAction(
                    'Confirm Member Removal',
                    `Remove ${identityData.displayName} from this workspace?`
                );
                if (!confirmed) return;
                try {
                    await window.OrbitTaskApi.removeWorkspaceMember(
                        workspaceMemberState.workspaceId,
                        identityData.userId
                    );
                    showToast('Workspace member removed');
                    await refreshWorkspaceMembers();
                } catch (error) {
                    const message = error && typeof error === 'object' && typeof error.message === 'string'
                        ? error.message
                        : 'Cannot remove workspace member';
                    showToast(message);
                }
            });
            row.appendChild(removeBtn);

            list.appendChild(row);
        });
    }

    async function resolveWorkspaceForMembers() {
        if (!window.OrbitTaskApi || typeof window.OrbitTaskApi.ensureWorkspace !== 'function') {
            return '';
        }
        if (workspaceMemberState.workspaceId && isUuid(workspaceMemberState.workspaceId)) {
            return workspaceMemberState.workspaceId;
        }

        const workspace = await window.OrbitTaskApi.ensureWorkspace('My Workspace');
        const workspaceId = workspace && typeof workspace.id === 'string' ? workspace.id : '';
        workspaceMemberState.workspaceId = isUuid(workspaceId) ? workspaceId : '';
        return workspaceMemberState.workspaceId;
    }

    function computeWorkspaceManagePermission(members) {
        if (systemCanManageWorkspaceMembers()) {
            return true;
        }
        const currentUserId = typeof user?.id === 'string' ? user.id : '';
        if (!currentUserId || !Array.isArray(members)) {
            return false;
        }
        const currentMember = members.find((member) => member && member.userId === currentUserId);
        const role = typeof currentMember?.role === 'string' ? currentMember.role.toUpperCase() : '';
        return role === 'OWNER' || role === 'ADMIN';
    }

    async function refreshWorkspaceMembers() {
        ensureWorkspaceMembersUI();
        workspaceMemberState.loading = true;
        renderWorkspaceMembers();

        try {
            const workspaceId = await resolveWorkspaceForMembers();
            if (!workspaceId) {
                workspaceMemberState.members = [];
                workspaceMemberState.canManage = false;
                return;
            }

            const members = await window.OrbitTaskApi.listWorkspaceMembers(workspaceId);
            workspaceMemberState.members = Array.isArray(members) ? members : [];
            workspaceMemberState.canManage = computeWorkspaceManagePermission(workspaceMemberState.members);
        } catch (error) {
            workspaceMemberState.members = [];
            workspaceMemberState.canManage = false;
            console.warn('Unable to load workspace members:', error);
        } finally {
            workspaceMemberState.loading = false;
            renderWorkspaceMembers();
        }
    }

    async function addWorkspaceMemberFromSettings() {
        const emailInput = document.getElementById('workspaceMemberEmailInput');
        const roleSelect = document.getElementById('workspaceMemberRoleSelect');
        if (!emailInput || !roleSelect || !workspaceMemberState.canManage) return;

        const email = normalizeEmailInput(emailInput.value);
        if (!email) {
            showToast('Please enter a valid email');
            return;
        }

        const role = WORKSPACE_MEMBER_ROLES.includes(roleSelect.value) ? roleSelect.value : 'MEMBER';
        try {
            const workspaceId = await resolveWorkspaceForMembers();
            if (!workspaceId) {
                showToast('Workspace unavailable');
                return;
            }
            await window.OrbitTaskApi.addWorkspaceMemberByEmail(workspaceId, {
                email,
                role
            });
            emailInput.value = '';
            showToast('Workspace member added');
            await refreshWorkspaceMembers();
        } catch (error) {
            const errorCode = error && typeof error === 'object' &&
                error.body && typeof error.body === 'object' &&
                typeof error.body.code === 'string'
                ? error.body.code
                : '';
            if (errorCode === 'USER_NOT_REGISTERED') {
                showToast('Email not registered');
                return;
            }
            const message = error && typeof error === 'object' && typeof error.message === 'string'
                ? error.message
                : 'Cannot add workspace member';
            showToast(message);
        }
    }

    const starField = document.getElementById('starField');
    const stars = [];
    const NUM_STARS = 160;

    for (let i = 0; i < NUM_STARS; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = Math.random() * 2.2 + 0.4;
        const depth = Math.random();
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.left = `${Math.random() * 100}%`;
        star.style.opacity = 0.2 + depth * 0.6;
        star.style.animation = `twinkle ${3 + Math.random() * 4}s ${Math.random() * 5}s ease-in-out infinite`;
        star._factor = 0.015 + depth * 0.04;
        starField.appendChild(star);
        stars.push(star);
    }

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let curX = mouseX;
    let curY = mouseY;
    document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });

    function animateStars() {
        curX += (mouseX - curX) * 0.04;
        curY += (mouseY - curY) * 0.04;
        const dx = curX - window.innerWidth / 2;
        const dy = curY - window.innerHeight / 2;
        for (const s of stars) {
            s.style.transform = `translate(${dx * s._factor}px, ${dy * s._factor}px)`;
        }
        requestAnimationFrame(animateStars);
    }
    animateStars();

    function activateTab(tabKey) {
        if (!tabKey) return false;
        const tabBtn = document.querySelector(`.tab[data-tab="${tabKey}"]`);
        const panel = document.getElementById(`tab-${tabKey}`);
        if (!tabBtn || !panel) return false;
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        tabBtn.classList.add('active');
        panel.classList.add('active');
        return true;
    }

    function getTabFromHash() {
        const hash = window.location.hash || '';
        if (!hash.startsWith('#tab-')) return '';
        return hash.slice(5);
    }

    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const tabKey = tab.dataset.tab;
            activateTab(tabKey);
            history.replaceState(null, '', `#tab-${tabKey}`);
        });
    });

    const initialTab = getTabFromHash();
    if (initialTab) {
        activateTab(initialTab);
    }

    window.addEventListener('hashchange', () => {
        const tabKey = getTabFromHash();
        if (tabKey) activateTab(tabKey);
    });

    function showToast(msg, duration = 2200) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }

    function safeParse(raw) {
        if (!raw || typeof raw !== 'string') return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function isISODate(value) {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    function sanitizeImageUrl(url) {
        if (typeof url !== 'string') return '';
        const trimmed = url.trim();
        if (!trimmed) return '';
        if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+$/.test(trimmed)) return trimmed;
        if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
        return '';
    }

    function sanitizeTimezone(value, fallback) {
        const baseFallback = typeof fallback === 'string' && fallback
            ? fallback
            : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
        if (typeof value !== 'string' || !value.trim()) return baseFallback;
        const mapped = LEGACY_TIMEZONE_MAP[value.trim()] || value.trim();
        try {
            Intl.DateTimeFormat('en-US', { timeZone: mapped }).format(new Date());
            return mapped;
        } catch (_) {
            return baseFallback;
        }
    }

    function toISODateOnly(date) {
        return date.toISOString().split('T')[0];
    }

    function getDefaultTimelineRange() {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const mondayOffset = (dayOfWeek + 6) % 7;
        const start = new Date(today);
        start.setDate(today.getDate() - mondayOffset);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return {
            startDate: toISODateOnly(start),
            endDate: toISODateOnly(end)
        };
    }

    function getDefaultSettings() {
        const range = getDefaultTimelineRange();
        return {
            timeline: {
                startDate: range.startDate,
                endDate: range.endDate,
                hourFormat: '24',
                showWeekends: true,
                weekStart: 'mon',
                defaultDuration: 2,
                snapGrid: true,
                overlapWarn: true
            },
            appearance: {
                bgDim: 55,
                showStars: true,
                starDensity: 'medium',
                sidebarWidth: 240,
                glassBlur: 'normal',
                reducedMotion: false,
                accentColor: '#ffffff',
                bgDataUrl: ''
            },
            notifications: {
                taskReminder: true,
                reminderLeadTime: 15,
                deadlineWarn: true,
                soundFx: false,
                dailySummary: true,
                weeklyReport: false
            },
            account: {
                language: 'en',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh',
                autoSave: true,
                avatarDataUrl: ''
            }
        };
    }

    function sanitizeSettings(raw) {
        const defaults = getDefaultSettings();
        const timeline = raw && typeof raw === 'object' && raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : {};
        const appearance = raw && typeof raw === 'object' && raw.appearance && typeof raw.appearance === 'object' ? raw.appearance : {};
        const notifications = raw && typeof raw === 'object' && raw.notifications && typeof raw.notifications === 'object' ? raw.notifications : {};
        const account = raw && typeof raw === 'object' && raw.account && typeof raw.account === 'object' ? raw.account : {};
        const durationNum = Number(timeline.defaultDuration);
        const bgDimNum = Number(appearance.bgDim);
        const sidebarNum = Number(appearance.sidebarWidth);
        const reminderNum = Number(notifications.reminderLeadTime);
        return {
            timeline: {
                startDate: isISODate(timeline.startDate) ? timeline.startDate : defaults.timeline.startDate,
                endDate: isISODate(timeline.endDate) ? timeline.endDate : defaults.timeline.endDate,
                hourFormat: timeline.hourFormat === '12' ? '12' : defaults.timeline.hourFormat,
                showWeekends: typeof timeline.showWeekends === 'boolean' ? timeline.showWeekends : defaults.timeline.showWeekends,
                weekStart: timeline.weekStart === 'sun' ? 'sun' : defaults.timeline.weekStart,
                defaultDuration: Number.isFinite(durationNum) ? Math.max(0.5, Math.min(12, durationNum)) : defaults.timeline.defaultDuration,
                snapGrid: typeof timeline.snapGrid === 'boolean' ? timeline.snapGrid : defaults.timeline.snapGrid,
                overlapWarn: typeof timeline.overlapWarn === 'boolean' ? timeline.overlapWarn : defaults.timeline.overlapWarn
            },
            appearance: {
                bgDim: Number.isFinite(bgDimNum) ? Math.max(0, Math.min(90, bgDimNum)) : defaults.appearance.bgDim,
                showStars: typeof appearance.showStars === 'boolean' ? appearance.showStars : defaults.appearance.showStars,
                starDensity: ['low', 'medium', 'high'].includes(appearance.starDensity) ? appearance.starDensity : defaults.appearance.starDensity,
                sidebarWidth: Number.isFinite(sidebarNum) ? Math.max(200, Math.min(320, sidebarNum)) : defaults.appearance.sidebarWidth,
                glassBlur: ['off', 'normal', 'strong'].includes(appearance.glassBlur) ? appearance.glassBlur : defaults.appearance.glassBlur,
                reducedMotion: typeof appearance.reducedMotion === 'boolean' ? appearance.reducedMotion : defaults.appearance.reducedMotion,
                accentColor: typeof appearance.accentColor === 'string' ? appearance.accentColor : defaults.appearance.accentColor,
                bgDataUrl: sanitizeImageUrl(appearance.bgDataUrl)
            },
            notifications: {
                taskReminder: typeof notifications.taskReminder === 'boolean' ? notifications.taskReminder : defaults.notifications.taskReminder,
                reminderLeadTime: Number.isFinite(reminderNum) ? reminderNum : defaults.notifications.reminderLeadTime,
                deadlineWarn: typeof notifications.deadlineWarn === 'boolean' ? notifications.deadlineWarn : defaults.notifications.deadlineWarn,
                soundFx: typeof notifications.soundFx === 'boolean' ? notifications.soundFx : defaults.notifications.soundFx,
                dailySummary: typeof notifications.dailySummary === 'boolean' ? notifications.dailySummary : defaults.notifications.dailySummary,
                weeklyReport: typeof notifications.weeklyReport === 'boolean' ? notifications.weeklyReport : defaults.notifications.weeklyReport
            },
            account: {
                language: typeof account.language === 'string' && account.language.trim() ? account.language : defaults.account.language,
                timezone: sanitizeTimezone(account.timezone, defaults.account.timezone),
                autoSave: typeof account.autoSave === 'boolean' ? account.autoSave : defaults.account.autoSave,
                avatarDataUrl: sanitizeImageUrl(account.avatarDataUrl)
            }
        };
    }

    const parsedSettings = safeParse(localStorage.getItem(SETTINGS_KEY)) || {};
    const storedProfile = typeof auth.getStoredUser === 'function' ? auth.getStoredUser() : null;
    const liveProfile = typeof auth.getCurrentUser === 'function' ? await auth.getCurrentUser() : null;
    let currentAuthProfile = liveProfile || storedProfile || user;

    let workingSettings = sanitizeSettings(parsedSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(workingSettings));

    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const rangePreview = document.getElementById('rangePreview');
    const rangeBadge = document.getElementById('rangeBadge');
    const bgDim = document.getElementById('bgDim');
    const bgDimVal = document.getElementById('bgDimVal');
    const sidebarWidthSlider = document.getElementById('sidebarWidth');
    const sidebarWidthVal = document.getElementById('sidebarWidthVal');
    const bgLayer = document.getElementById('bgLayer');
    const twoFactorStatusText = document.getElementById('twoFactorStatusText');
    const twoFactorMessage = document.getElementById('twoFactorMessage');
    const twoFactorSetupBtn = document.getElementById('twoFactorSetupBtn');
    const twoFactorSetupPanel = document.getElementById('twoFactorSetupPanel');
    const twoFactorQrImage = document.getElementById('twoFactorQrImage');
    const twoFactorSecretText = document.getElementById('twoFactorSecretText');
    const twoFactorConfirmOtpInput = document.getElementById('twoFactorConfirmOtpInput');
    const twoFactorConfirmBtn = document.getElementById('twoFactorConfirmBtn');
    const twoFactorBackupCodesWrap = document.getElementById('twoFactorBackupCodesWrap');
    const twoFactorBackupCodesText = document.getElementById('twoFactorBackupCodesText');
    const twoFactorDisableOtpInput = document.getElementById('twoFactorDisableOtpInput');
    const twoFactorDisableBackupInput = document.getElementById('twoFactorDisableBackupInput');
    const twoFactorDisableBtn = document.getElementById('twoFactorDisableBtn');
    const profileSummaryName = document.getElementById('profileSummaryName');
    const profileSummaryEmail = document.getElementById('profileSummaryEmail');
    const editProfileBtn = document.getElementById('editProfileBtn');
    const profileEditModal = document.getElementById('profileEditModal');
    const profileFirstNameInput = document.getElementById('profileFirstNameInput');
    const profileLastNameInput = document.getElementById('profileLastNameInput');
    const profileDobInput = document.getElementById('profileDobInput');
    const profileAddressInput = document.getElementById('profileAddressInput');
    const profileEditMessage = document.getElementById('profileEditMessage');
    const saveProfileEditBtn = document.getElementById('saveProfileEditBtn');
    const cancelProfileEditBtn = document.getElementById('cancelProfileEditBtn');
    const passwordOtpInput = document.getElementById('passwordOtpInput');
    const passwordBackupCodeInput = document.getElementById('passwordBackupCodeInput');
    const currentPasswordInput = document.getElementById('currentPasswordInput');
    const newPasswordInput = document.getElementById('newPasswordInput');
    const confirmNewPasswordInput = document.getElementById('confirmNewPasswordInput');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const passwordChangeMessage = document.getElementById('passwordChangeMessage');

    let pendingTwoFactorSetup = null;

    function isTwoFactorEnabled(profile) {
        return !!(profile && typeof profile === 'object' && profile.twoFactorEnabled === true);
    }

    function setTwoFactorMessage(message, isError = false) {
        if (!twoFactorMessage) return;
        twoFactorMessage.textContent = String(message || '').trim();
        twoFactorMessage.style.color = isError ? 'rgba(255,120,130,0.95)' : 'rgba(180,255,200,0.95)';
    }

    function setPasswordMessage(message, isError = false) {
        if (!passwordChangeMessage) return;
        passwordChangeMessage.textContent = String(message || '').trim();
        passwordChangeMessage.style.color = isError ? 'rgba(255,120,130,0.95)' : 'rgba(180,255,200,0.95)';
    }

    function togglePasswordTwoFactorInputs() {
        const enabled = isTwoFactorEnabled(currentAuthProfile);
        if (passwordOtpInput) {
            passwordOtpInput.classList.toggle('hidden', !enabled);
            if (!enabled) passwordOtpInput.value = '';
        }
        if (passwordBackupCodeInput) {
            passwordBackupCodeInput.classList.toggle('hidden', !enabled);
            if (!enabled) passwordBackupCodeInput.value = '';
        }
    }

    function resetTwoFactorSetupPanel() {
        pendingTwoFactorSetup = null;
        if (twoFactorSetupPanel) twoFactorSetupPanel.classList.add('hidden');
        if (twoFactorQrImage) {
            twoFactorQrImage.removeAttribute('src');
            twoFactorQrImage.classList.add('hidden');
        }
        if (twoFactorSecretText) twoFactorSecretText.textContent = '';
        if (twoFactorConfirmOtpInput) twoFactorConfirmOtpInput.value = '';
        if (twoFactorBackupCodesWrap) twoFactorBackupCodesWrap.classList.add('hidden');
        if (twoFactorBackupCodesText) twoFactorBackupCodesText.textContent = '';
    }

    function renderTwoFactorStatus() {
        const enabled = isTwoFactorEnabled(currentAuthProfile);
        if (twoFactorStatusText) {
            twoFactorStatusText.textContent = enabled
                ? 'Status: Enabled'
                : 'Status: Not enabled';
        }
        if (twoFactorSetupBtn) {
            twoFactorSetupBtn.textContent = enabled ? 'Rotate Setup' : 'Start Setup';
        }
        togglePasswordTwoFactorInputs();
    }

    async function refreshCurrentAuthProfile() {
        if (typeof auth.getCurrentUser !== 'function') {
            return currentAuthProfile;
        }
        const fresh = await auth.getCurrentUser();
        if (fresh) {
            currentAuthProfile = fresh;
        }
        renderTwoFactorStatus();
        renderProfileSummary();
        return currentAuthProfile;
    }

    function getCurrentProfileView() {
        return toProfile(currentAuthProfile) || toProfile(user);
    }

    function renderProfileSummary() {
        const profile = getCurrentProfileView();
        if (!profile) return;
        if (profileSummaryName) {
            profileSummaryName.textContent = profile.displayName || profile.email.split('@')[0];
        }
        if (profileSummaryEmail) {
            profileSummaryEmail.textContent = profile.email;
        }
    }

    function setProfileEditMessage(message, isError = false) {
        if (!profileEditMessage) return;
        profileEditMessage.textContent = String(message || '').trim();
        profileEditMessage.style.color = isError ? 'rgba(255,120,130,0.95)' : 'rgba(180,255,200,0.95)';
    }

    function populateProfileEditModal() {
        const profile = getCurrentProfileView();
        if (!profile) return;
        if (profileFirstNameInput) profileFirstNameInput.value = profile.firstName || '';
        if (profileLastNameInput) profileLastNameInput.value = profile.lastName || '';
        if (profileDobInput) profileDobInput.value = profile.dob || '';
        if (profileAddressInput) profileAddressInput.value = profile.address || '';
    }

    function openProfileEditModal() {
        if (!profileEditModal) return;
        populateProfileEditModal();
        setProfileEditMessage('', false);
        profileEditModal.classList.remove('hidden');
        if (profileFirstNameInput) {
            profileFirstNameInput.focus();
        }
    }

    function closeProfileEditModal() {
        if (!profileEditModal) return;
        profileEditModal.classList.add('hidden');
    }

    async function saveProfileFromModal() {
        if (!auth || typeof auth.updateProfile !== 'function') {
            setProfileEditMessage('Profile service is unavailable.', true);
            return;
        }

        const firstName = profileFirstNameInput ? profileFirstNameInput.value.trim() : '';
        const lastName = profileLastNameInput ? profileLastNameInput.value.trim() : '';
        const dob = profileDobInput ? profileDobInput.value : '';
        const address = profileAddressInput ? profileAddressInput.value.trim() : '';

        if (!firstName) {
            setProfileEditMessage('First name is required.', true);
            if (profileFirstNameInput) profileFirstNameInput.focus();
            return;
        }

        if (saveProfileEditBtn) saveProfileEditBtn.disabled = true;
        if (cancelProfileEditBtn) cancelProfileEditBtn.disabled = true;
        setProfileEditMessage('Saving profile...');

        try {
            await auth.updateProfile({
                firstName,
                lastName: lastName || null,
                dob: dob || null,
                address: address || null
            });
            await refreshCurrentAuthProfile();
            renderProfileSummary();
            closeProfileEditModal();
            showToast('Profile updated');
        } catch (error) {
            const message = error && typeof error === 'object' && 'message' in error
                ? String(error.message || '')
                : '';
            setProfileEditMessage(message || 'Unable to update profile.', true);
        } finally {
            if (saveProfileEditBtn) saveProfileEditBtn.disabled = false;
            if (cancelProfileEditBtn) cancelProfileEditBtn.disabled = false;
        }
    }

    const remSteps = [5, 10, 15, 30, 60];
    let remIdx = 2;
    let durVal = 2;

    function setSegActive(ctrlId, val) {
        if (!val) return;
        const ctrl = document.getElementById(ctrlId);
        if (!ctrl) return;
        ctrl.querySelectorAll('.seg').forEach((seg) => seg.classList.toggle('active', seg.dataset.val === val));
    }

    function getSegValue(ctrlId) {
        return document.querySelector(`#${ctrlId} .seg.active`)?.dataset.val || '';
    }

    function formatDate(d) {
        return d.toISOString().split('T')[0];
    }

    function updateRangePreview() {
        const s = new Date(startDateEl.value);
        const e = new Date(endDateEl.value);
        rangePreview.style.color = 'rgba(255,255,255,0.28)';
        if (!isNaN(s) && !isNaN(e) && e >= s) {
            const diff = Math.round((e - s) / 86400000) + 1;
            const opts = { month: 'short', day: 'numeric' };
            rangePreview.textContent = `${s.toLocaleDateString('en-US', opts)} -> ${e.toLocaleDateString('en-US', opts)}`;
            rangeBadge.textContent = `${diff}d`;
            rangeBadge.style.color = diff > 14 ? 'rgba(255,180,80,0.8)' : 'rgba(255,255,255,0.6)';
        } else if (e < s) {
            rangePreview.textContent = 'End date must be after start';
            rangePreview.style.color = 'rgba(255,80,100,0.8)';
            rangeBadge.textContent = '!';
        } else {
            rangePreview.textContent = '— days selected';
            rangeBadge.textContent = '0d';
        }
    }

    document.querySelectorAll('.seg-control').forEach((ctrl) => {
        ctrl.querySelectorAll('.seg').forEach((btn) => {
            btn.addEventListener('click', () => {
                ctrl.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });

    startDateEl.addEventListener('change', updateRangePreview);
    endDateEl.addEventListener('change', updateRangePreview);

    document.getElementById('durMinus').addEventListener('click', () => {
        if (durVal > 1) {
            durVal -= 0.5;
            document.getElementById('durVal').textContent = `${durVal}h`;
        }
    });
    document.getElementById('durPlus').addEventListener('click', () => {
        if (durVal < 12) {
            durVal += 0.5;
            document.getElementById('durVal').textContent = `${durVal}h`;
        }
    });

    document.getElementById('remMinus').addEventListener('click', () => {
        if (remIdx > 0) {
            remIdx--;
            document.getElementById('remVal').textContent = `${remSteps[remIdx]}m`;
        }
    });
    document.getElementById('remPlus').addEventListener('click', () => {
        if (remIdx < remSteps.length - 1) {
            remIdx++;
            document.getElementById('remVal').textContent = `${remSteps[remIdx]}m`;
        }
    });

    function updateBgDim() {
        const dimPct = parseInt(bgDim.value, 10) / 100;
        const bgUrl = sanitizeImageUrl(workingSettings.appearance.bgDataUrl);
        if (bgUrl) {
            bgLayer.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dimPct}),rgba(0,0,0,${dimPct})),url(${bgUrl})`;
            bgLayer.style.backgroundSize = 'cover';
            bgLayer.style.backgroundPosition = 'center';
        } else {
            bgLayer.style.backgroundImage = '';
        }
    }

    bgDim.addEventListener('input', () => {
        bgDimVal.textContent = `${bgDim.value}%`;
        updateBgDim();
    });

    sidebarWidthSlider.addEventListener('input', () => {
        const v = sidebarWidthSlider.value;
        sidebarWidthVal.textContent = `${v}px`;
        document.querySelector('.sidebar').style.width = `${v}px`;
    });

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Read failed'));
            reader.readAsDataURL(file);
        });
    }

    document.getElementById('bgUpload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file');
            return;
        }
        const dataUrl = await fileToDataUrl(file);
        workingSettings.appearance.bgDataUrl = dataUrl;
        document.getElementById('bgThumb').style.backgroundImage = `url(${dataUrl})`;
        document.getElementById('bgFilename').textContent = file.name;
        document.getElementById('bgPreviewRow').style.display = 'flex';
        updateBgDim();
        showToast('Wallpaper applied');
    });

    document.getElementById('removeBg').addEventListener('click', () => {
        workingSettings.appearance.bgDataUrl = '';
        document.getElementById('bgPreviewRow').style.display = 'none';
        document.getElementById('bgFilename').textContent = '—';
        document.getElementById('bgUpload').value = '';
        updateBgDim();
        showToast('Background removed');
    });

    document.getElementById('showStars').addEventListener('change', (e) => {
        starField.style.opacity = e.target.checked ? '1' : '0';
    });

    document.getElementById('reducedMotion').addEventListener('change', (e) => {
        if (e.target.checked) {
            stars.forEach((s) => { s.style.animation = 'none'; });
        } else {
            stars.forEach((s) => {
                s.style.animation = `twinkle ${3 + Math.random() * 4}s ${Math.random() * 5}s ease-in-out infinite`;
            });
        }
    });

    document.querySelectorAll('.swatch').forEach((sw) => {
        sw.addEventListener('click', () => {
            document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
            sw.classList.add('active');
            document.documentElement.style.setProperty('--accent', sw.dataset.color);
            showToast('Accent color updated');
        });
    });

    document.getElementById('avatarUpload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file');
            return;
        }
        const dataUrl = await fileToDataUrl(file);
        workingSettings.account.avatarDataUrl = dataUrl;
        const avatarDisplay = document.getElementById('avatarDisplay');
        avatarDisplay.textContent = '';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'avatar';
        avatarDisplay.appendChild(img);
        showToast('Avatar updated');
    });

    function gatherSettings() {
        return sanitizeSettings({
            timeline: {
                startDate: startDateEl.value,
                endDate: endDateEl.value,
                hourFormat: getSegValue('hourFormat'),
                showWeekends: document.getElementById('showWeekends').checked,
                weekStart: getSegValue('weekStart'),
                defaultDuration: durVal,
                snapGrid: document.getElementById('snapGrid').checked,
                overlapWarn: document.getElementById('overlapWarn').checked
            },
            appearance: {
                bgDim: parseInt(bgDim.value, 10),
                showStars: document.getElementById('showStars').checked,
                starDensity: getSegValue('starDensity'),
                sidebarWidth: parseInt(sidebarWidthSlider.value, 10),
                glassBlur: getSegValue('glassBlur'),
                reducedMotion: document.getElementById('reducedMotion').checked,
                accentColor: document.querySelector('.swatch.active')?.dataset.color,
                bgDataUrl: workingSettings.appearance.bgDataUrl || ''
            },
            notifications: {
                taskReminder: document.getElementById('taskReminder').checked,
                reminderLeadTime: remSteps[remIdx],
                deadlineWarn: document.getElementById('deadlineWarn').checked,
                soundFx: document.getElementById('soundFx').checked,
                dailySummary: document.getElementById('dailySummary').checked,
                weeklyReport: document.getElementById('weeklyReport').checked
            },
            account: {
                language: document.getElementById('langSelect').value,
                timezone: document.getElementById('tzSelect').value,
                autoSave: document.getElementById('autoSave').checked,
                avatarDataUrl: workingSettings.account.avatarDataUrl || ''
            }
        });
    }

    function saveSettings() {
        workingSettings = gatherSettings();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(workingSettings));
    }

    function applySettingsToUI(settings) {
        workingSettings = settings;

        if (settings.timeline.startDate) startDateEl.value = settings.timeline.startDate;
        if (settings.timeline.endDate) endDateEl.value = settings.timeline.endDate;
        document.getElementById('showWeekends').checked = settings.timeline.showWeekends;
        document.getElementById('snapGrid').checked = settings.timeline.snapGrid;
        document.getElementById('overlapWarn').checked = settings.timeline.overlapWarn;
        durVal = settings.timeline.defaultDuration;
        document.getElementById('durVal').textContent = `${durVal}h`;
        setSegActive('hourFormat', settings.timeline.hourFormat);
        setSegActive('weekStart', settings.timeline.weekStart);

        bgDim.value = settings.appearance.bgDim;
        bgDimVal.textContent = `${settings.appearance.bgDim}%`;
        document.getElementById('showStars').checked = settings.appearance.showStars;
        starField.style.opacity = settings.appearance.showStars ? '1' : '0';
        sidebarWidthSlider.value = settings.appearance.sidebarWidth;
        sidebarWidthVal.textContent = `${settings.appearance.sidebarWidth}px`;
        document.querySelector('.sidebar').style.width = `${settings.appearance.sidebarWidth}px`;
        setSegActive('starDensity', settings.appearance.starDensity);
        setSegActive('glassBlur', settings.appearance.glassBlur);
        document.getElementById('reducedMotion').checked = settings.appearance.reducedMotion;
        document.querySelectorAll('.swatch').forEach((sw) => sw.classList.toggle('active', sw.dataset.color === settings.appearance.accentColor));
        document.documentElement.style.setProperty('--accent', settings.appearance.accentColor);

        document.getElementById('taskReminder').checked = settings.notifications.taskReminder;
        document.getElementById('deadlineWarn').checked = settings.notifications.deadlineWarn;
        document.getElementById('soundFx').checked = settings.notifications.soundFx;
        document.getElementById('dailySummary').checked = settings.notifications.dailySummary;
        document.getElementById('weeklyReport').checked = settings.notifications.weeklyReport;
        remIdx = remSteps.indexOf(settings.notifications.reminderLeadTime);
        if (remIdx < 0) remIdx = 2;
        document.getElementById('remVal').textContent = `${remSteps[remIdx]}m`;

        document.getElementById('langSelect').value = settings.account.language;
        document.getElementById('tzSelect').value = settings.account.timezone;
        document.getElementById('autoSave').checked = settings.account.autoSave;

        if (settings.account.avatarDataUrl) {
            const avatarDisplay = document.getElementById('avatarDisplay');
            avatarDisplay.textContent = '';
            const img = document.createElement('img');
            img.src = settings.account.avatarDataUrl;
            img.alt = 'avatar';
            avatarDisplay.appendChild(img);
        }

        if (settings.appearance.bgDataUrl) {
            document.getElementById('bgThumb').style.backgroundImage = `url(${settings.appearance.bgDataUrl})`;
            document.getElementById('bgFilename').textContent = 'custom-background.png';
            document.getElementById('bgPreviewRow').style.display = 'flex';
        } else {
            document.getElementById('bgPreviewRow').style.display = 'none';
            document.getElementById('bgFilename').textContent = '—';
        }

        updateBgDim();
        updateRangePreview();
        renderProfileSummary();
    }

    const defaultRange = getDefaultTimelineRange();
    if (!workingSettings.timeline.startDate) workingSettings.timeline.startDate = defaultRange.startDate;
    if (!workingSettings.timeline.endDate) workingSettings.timeline.endDate = defaultRange.endDate;

    applySettingsToUI(workingSettings);

    ensureWorkspaceMembersUI();
    const workspaceMemberAddBtn = document.getElementById('workspaceMemberAddBtn');
    const workspaceMemberRefreshBtn = document.getElementById('workspaceMemberRefreshBtn');
    if (workspaceMemberAddBtn) {
        workspaceMemberAddBtn.addEventListener('click', () => {
            void addWorkspaceMemberFromSettings();
        });
    }
    if (workspaceMemberRefreshBtn) {
        workspaceMemberRefreshBtn.addEventListener('click', () => {
            void refreshWorkspaceMembers();
        });
    }
    void refreshWorkspaceMembers();

    renderProfileSummary();

    renderTwoFactorStatus();
    renderProfileSummary();
    resetTwoFactorSetupPanel();
    setTwoFactorMessage('', false);
    setPasswordMessage('', false);

    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => {
            openProfileEditModal();
        });
    }
    if (cancelProfileEditBtn) {
        cancelProfileEditBtn.addEventListener('click', () => {
            closeProfileEditModal();
        });
    }
    if (saveProfileEditBtn) {
        saveProfileEditBtn.addEventListener('click', () => {
            void saveProfileFromModal();
        });
    }
    if (profileEditModal) {
        profileEditModal.addEventListener('click', (event) => {
            if (event.target === profileEditModal) {
                closeProfileEditModal();
            }
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && profileEditModal && !profileEditModal.classList.contains('hidden')) {
            closeProfileEditModal();
        }
    });

    if (twoFactorConfirmOtpInput) {
        twoFactorConfirmOtpInput.addEventListener('input', () => {
            twoFactorConfirmOtpInput.value = twoFactorConfirmOtpInput.value.replace(/[^\d]/g, '').slice(0, 6);
        });
    }

    if (twoFactorDisableOtpInput) {
        twoFactorDisableOtpInput.addEventListener('input', () => {
            twoFactorDisableOtpInput.value = twoFactorDisableOtpInput.value.replace(/[^\d]/g, '').slice(0, 6);
        });
    }

    if (passwordOtpInput) {
        passwordOtpInput.addEventListener('input', () => {
            passwordOtpInput.value = passwordOtpInput.value.replace(/[^\d]/g, '').slice(0, 6);
        });
    }

    if (twoFactorSetupBtn) {
        twoFactorSetupBtn.addEventListener('click', async () => {
            if (typeof auth.setupTwoFactor !== 'function') {
                setTwoFactorMessage('2FA setup is unavailable.', true);
                return;
            }

            twoFactorSetupBtn.disabled = true;
            setTwoFactorMessage('Starting 2FA setup...');

            const setupResult = await auth.setupTwoFactor();
            twoFactorSetupBtn.disabled = false;

            if (!setupResult.ok) {
                setTwoFactorMessage(setupResult.error || 'Unable to start 2FA setup.', true);
                return;
            }

            pendingTwoFactorSetup = setupResult.data;
            if (twoFactorSetupPanel) twoFactorSetupPanel.classList.remove('hidden');
            if (twoFactorQrImage) {
                if (typeof setupResult.data.qrCodeDataUrl === 'string' && setupResult.data.qrCodeDataUrl.trim()) {
                    twoFactorQrImage.src = setupResult.data.qrCodeDataUrl;
                    twoFactorQrImage.classList.remove('hidden');
                } else {
                    twoFactorQrImage.removeAttribute('src');
                    twoFactorQrImage.classList.add('hidden');
                }
            }
            if (twoFactorSecretText) {
                twoFactorSecretText.textContent = setupResult.data.secret || '';
            }
            if (twoFactorBackupCodesWrap) twoFactorBackupCodesWrap.classList.add('hidden');
            if (twoFactorBackupCodesText) twoFactorBackupCodesText.textContent = '';
            if (twoFactorConfirmOtpInput) twoFactorConfirmOtpInput.value = '';
            setTwoFactorMessage('Scan the QR code, then enter OTP to confirm 2FA.');
        });
    }

    if (twoFactorConfirmBtn) {
        twoFactorConfirmBtn.addEventListener('click', async () => {
            if (typeof auth.confirmTwoFactor !== 'function') {
                setTwoFactorMessage('2FA confirm is unavailable.', true);
                return;
            }
            if (!pendingTwoFactorSetup) {
                setTwoFactorMessage('Please start setup first.', true);
                return;
            }

            const otp = twoFactorConfirmOtpInput ? twoFactorConfirmOtpInput.value.trim() : '';
            if (!/^\d{6}$/.test(otp)) {
                setTwoFactorMessage('OTP must be exactly 6 digits.', true);
                return;
            }

            twoFactorConfirmBtn.disabled = true;
            const confirmResult = await auth.confirmTwoFactor(otp);
            twoFactorConfirmBtn.disabled = false;

            if (!confirmResult.ok) {
                setTwoFactorMessage(confirmResult.error || 'Unable to confirm 2FA.', true);
                return;
            }

            if (twoFactorBackupCodesWrap) twoFactorBackupCodesWrap.classList.remove('hidden');
            if (twoFactorBackupCodesText) {
                const codes = Array.isArray(confirmResult.backupCodes) ? confirmResult.backupCodes : [];
                twoFactorBackupCodesText.textContent = codes.length > 0 ? codes.join('\n') : 'No backup codes returned.';
            }

            await refreshCurrentAuthProfile();
            setTwoFactorMessage('2FA enabled successfully. Save your backup codes now.');
            showToast('2FA enabled');
        });
    }

    if (twoFactorDisableBtn) {
        twoFactorDisableBtn.addEventListener('click', async () => {
            if (typeof auth.disableTwoFactor !== 'function') {
                setTwoFactorMessage('2FA disable is unavailable.', true);
                return;
            }

            const otp = twoFactorDisableOtpInput ? twoFactorDisableOtpInput.value.trim() : '';
            const backupCode = twoFactorDisableBackupInput ? twoFactorDisableBackupInput.value.trim() : '';
            if (!otp && !backupCode) {
                setTwoFactorMessage('Provide OTP or backup code to disable 2FA.', true);
                return;
            }

            twoFactorDisableBtn.disabled = true;
            const disableResult = await auth.disableTwoFactor({
                otp: otp || undefined,
                backupCode: backupCode || undefined
            });
            twoFactorDisableBtn.disabled = false;

            if (!disableResult.ok) {
                setTwoFactorMessage(disableResult.error || 'Unable to disable 2FA.', true);
                return;
            }

            if (twoFactorDisableOtpInput) twoFactorDisableOtpInput.value = '';
            if (twoFactorDisableBackupInput) twoFactorDisableBackupInput.value = '';
            resetTwoFactorSetupPanel();
            await refreshCurrentAuthProfile();
            setTwoFactorMessage('2FA disabled.');
            showToast('2FA disabled');
        });
    }

    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', async () => {
            if (!auth || typeof auth.changePassword !== 'function') {
                setPasswordMessage('Password change is unavailable.', true);
                return;
            }

            const currentPassword = currentPasswordInput ? currentPasswordInput.value : '';
            const nextPassword = newPasswordInput ? newPasswordInput.value : '';
            const confirmPassword = confirmNewPasswordInput ? confirmNewPasswordInput.value : '';
            const otp = passwordOtpInput ? passwordOtpInput.value.trim() : '';
            const backupCode = passwordBackupCodeInput ? passwordBackupCodeInput.value.trim() : '';
            const requiresTwoFactor = isTwoFactorEnabled(currentAuthProfile);

            if (!currentPassword || !nextPassword) {
                setPasswordMessage('Current password and new password are required.', true);
                return;
            }
            if (nextPassword !== confirmPassword) {
                setPasswordMessage('New password confirmation does not match.', true);
                return;
            }
            if (typeof auth.validatePassword === 'function') {
                const validation = auth.validatePassword(nextPassword);
                if (!validation || validation.valid !== true) {
                    setPasswordMessage('New password must include uppercase, lowercase, number and min 8 chars.', true);
                    return;
                }
            }
            if (requiresTwoFactor && !otp && !backupCode) {
                setPasswordMessage('2FA is enabled. Provide OTP or backup code.', true);
                return;
            }

            setPasswordMessage('Changing password...');
            changePasswordBtn.disabled = true;
            const result = await auth.changePassword({
                currentPassword,
                newPassword: nextPassword,
                otp: otp || undefined,
                backupCode: backupCode || undefined
            });
            changePasswordBtn.disabled = false;

            if (!result.ok) {
                setPasswordMessage(result.error || 'Unable to change password.', true);
                return;
            }

            if (currentPasswordInput) currentPasswordInput.value = '';
            if (newPasswordInput) newPasswordInput.value = '';
            if (confirmNewPasswordInput) confirmNewPasswordInput.value = '';
            if (passwordOtpInput) passwordOtpInput.value = '';
            if (passwordBackupCodeInput) passwordBackupCodeInput.value = '';
            setPasswordMessage('Password changed. Please sign in again.');
            showToast('Password changed');

            await auth.signOut({ redirectTo: '/signin/' });
            window.location.replace(route('/signin/'));
        });
    }

    document.getElementById('saveBtn').addEventListener('click', async () => {
        saveSettings();
        const btn = document.getElementById('saveBtn');
        btn.classList.add('saved');
        btn.innerHTML = '<span class="save-icon">✓</span> Saved!';

        setTimeout(() => {
            btn.classList.remove('saved');
            btn.innerHTML = '<span class="save-icon">✦</span> Save Changes';
        }, 1800);
        showToast('Settings saved successfully');
    });

    document.getElementById('exportBtn').addEventListener('click', async () => {
        try {
            const remoteProjects = await loadRemoteProjectsSnapshot();
            const data = {
                settings: gatherSettings(),
                projects: remoteProjects.length > 0 ? remoteProjects : []
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'orbit-data.json';
            a.click();
            URL.revokeObjectURL(url);
            showToast('Data exported');
        } catch (_) {
            showToast('Export failed');
        }
    });

    document.getElementById('clearBtn').addEventListener('click', async () => {
        const confirmed = await confirmWorkspaceAction(
            'Confirm Clear Tasks',
            'Clear all tasks from every workspace? This cannot be undone.'
        );
        if (!confirmed) return;
        try {
            await clearRemoteTasks();
            localStorage.removeItem(PROJECTS_KEY);
            showToast('All tasks cleared');
        } catch (_) {
            showToast('Failed to clear tasks');
        }
    });

    document.getElementById('resetBtn').addEventListener('click', async () => {
        const confirmed = await confirmWorkspaceAction(
            'Confirm Reset Settings',
            'Reset all settings to defaults?'
        );
        if (!confirmed) return;
        workingSettings = getDefaultSettings();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(workingSettings));
        applySettingsToUI(workingSettings);
        showToast('Settings reset to defaults');
    });

    const accountLogoutBtn = document.getElementById('accountLogoutBtn');
    if (accountLogoutBtn) {
        accountLogoutBtn.addEventListener('click', async () => {
            const confirmed = await confirmWorkspaceAction(
                'Confirm Sign Out',
                'Sign out now?'
            );
            if (!confirmed) return;
            await auth.signOut({ redirectTo: '/landing/' });
            window.location.replace(route('/landing/'));
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrapSettingPage();
    }, { once: true });
} else {
    void bootstrapSettingPage();
}

/**
 * Orbit Task Board
 */
import {
    formatDisplayDate,
    formatDisplayDateRange,
    formatDisplayDateTimeRange,
    formatDueLabel,
} from '../src/modules/tasks/date-display.js';

let draggingTask = null;
let resizingTask = null;
let currentTaskData = null;
let currentContextMenuProjectId = null;
let currentContextTaskData = null;
let activeModal = null;
let lastFocusedElement = null;
let longPressTimer = null;

let mouseX = 0;
let mouseY = 0;
let isDragging = false;
let isResizing = false;
let dragMoved = false;
let resizeMoved = false;
let touchMoved = false;
let longPressOpened = false;

const TASK_STATUSES = ['Not Started', 'In Progress', 'Done', 'Dropped'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const DAY_HOURS = 24;
const DEFAULT_HOUR_WIDTH = 62;
const VIEW_MODE_STORAGE_KEY = 'orbitTaskViewMode';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'orbitActiveWorkspaceIdV1';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'orbitSidebarCollapsedV1';
const PROJECTS_CACHE_STORAGE_KEY = 'orbitProjectsCacheV1';
const PENDING_SYNC_STORAGE_KEY = 'orbitPendingSyncV1';
const PROJECT_ACCESS_INDEX_STORAGE_KEY = 'orbitProjectAccessIndexV1';
const WORKSPACE_DISPLAY_SETTINGS_STORAGE_KEY = 'orbitWorkspaceDisplaySettingsV1';
const HOT_ROUTE_NAV_STORAGE_KEY = 'orbitHotRouteNavV1';
const DASHBOARD_SYNC_RESOURCE_KEY = 'dashboard.remote.projects';
const DASHBOARD_LAST_SYNC_AT_KEY = 'orbitDashboardLastSyncAtV1';
const FILTER_DEBOUNCE_MS = 150;
const SYNC_DEBOUNCE_MS = 700;
const SYNC_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const CONNECTION_PROBE_VISIBLE_MS = 10 * 1000;
const CONNECTION_PROBE_HIDDEN_MS = 60 * 1000;
const REMOTE_REVALIDATE_MAX_AGE_MS = 10 * 1000;
const REMOTE_WORKSPACE_LOAD_CONCURRENCY = 3;
const REALTIME_INVALIDATE_DEBOUNCE_MS = 500;
const REALTIME_TASK_INVALIDATE_FALLBACK_MS = 700;
const REALTIME_TASK_INVALIDATE_RECENT_DELTA_MS = 1500;
const TASK_SUBMIT_COOLDOWN_MS = 800;
const TASK_CREATE_SPAM_WINDOW_MS = 5000;
const TASK_AUTH_FAILURE_EVENT = 'orbit:task-auth-failure';
const TASK_AUTH_SUCCESS_EVENT = 'orbit:task-auth-success';
const AUTH_FAILURE_WINDOW_MS = 30 * 1000;
const AUTH_FAILURE_THRESHOLD = 2;
const SESSION_ERROR_CODES = new Set([
    'AUTH_UNAUTHORIZED',
    'SESSION_REVOKED',
    'REFRESH_TOKEN_MISSING',
    'REFRESH_INVALID',
    'REFRESH_EXPIRED',
    'REFRESH_REUSED',
    'TOKEN_INVALID',
    'TOKEN_EXPIRED'
]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_META_PREFIX = '__ORBIT_PROJECT_META_V1__:';
const TASK_META_PREFIX = '__ORBIT_TASK_META_V1__:';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_TO_BACKEND_STATUS = {
    'Not Started': 'TODO',
    'In Progress': 'IN_PROGRESS',
    Done: 'DONE',
    Dropped: 'BLOCKED'
};
const BACKEND_TO_LOCAL_STATUS = {
    TODO: 'Not Started',
    IN_PROGRESS: 'In Progress',
    DONE: 'Done',
    BLOCKED: 'Dropped'
};
const LOCAL_TO_BACKEND_PRIORITY = {
    Low: 'LOW',
    Medium: 'MEDIUM',
    High: 'HIGH'
};
const BACKEND_TO_LOCAL_PRIORITY = {
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
    URGENT: 'High'
};
const LEGACY_TIMEZONE_MAP = {
    'UTC+7 (Ho Chi Minh)': 'Asia/Ho_Chi_Minh',
    'UTC+0 (London)': 'Europe/London',
    'UTC-5 (New York)': 'America/New_York',
    'UTC+9 (Tokyo)': 'Asia/Tokyo',
    'UTC+8 (Singapore)': 'Asia/Singapore'
};
const ASSIGNEE_MUTED_PALETTE = [
    '#9ca3af',
    '#a8a29e',
    '#94a3b8',
    '#9ca3af',
    '#b4b4b8',
    '#a1a1aa',
    '#94a3b8',
    '#9aa3b2'
];

const sessionSync =
    window.OrbitSessionSync && typeof window.OrbitSessionSync === 'object'
        ? window.OrbitSessionSync
        : null;

const realtimeSync =
    window.OrbitRealtimeSync && typeof window.OrbitRealtimeSync === 'object'
        ? window.OrbitRealtimeSync
        : null;

const state = {
    projects: [],
    projectAccessIndex: {},
    hourWidth: DEFAULT_HOUR_WIDTH,
    settings: null,
    viewMode: 'timeline',
    didInitialScroll: false,
    timelineLayout: {
        weekDates: [],
        layoutByTaskId: new Map()
    },
    ui: {
        sidebarCollapsed: false,
        mobileSidebarOpen: false
    },
    remoteSync: {
        workspaceId: '',
        timer: null,
        retryTimer: null,
        syncing: false,
        pending: false,
        hasPendingSnapshot: false,
        hydrating: false,
        lastErrorAt: 0,
        lastErrorMessage: ''
    },
    connection: {
        status: 'offline',
        timer: null,
        inFlight: false
    },
    realtimeInvalidate: {
        timer: null,
        pending: false,
        inFlight: false,
        taskFallbackTimer: null,
        lastTaskDeltaAt: 0
    },
    authFailures: {
        count: 0,
        lastAt: 0,
        locked: false
    },
    filters: {
        text: '',
        status: 'All',
        member: 'All',
        debounceTimer: null
    },
    taskSubmit: {
        busyUntil: 0,
        lastCreateSignature: '',
        lastCreateAt: 0
    },
    workspaceDisplaySettings: {}
};

let lastErrorToastMessage = '';
let lastErrorToastAt = 0;
let workspaceSettingsDialog = { mode: 'edit', workspaceId: '' };
const activeMutationLocks = new Set();

function normalizeErrorCode(value, fallback = '') {
    const source = typeof value === 'string' ? value : '';
    const normalized = source.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_');
    if (normalized) {
        return normalized;
    }
    const fallbackSource = typeof fallback === 'string' ? fallback : '';
    return fallbackSource.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_');
}

function buildErrorToastMessage(message, code = '') {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) return '';
    const normalizedCode = normalizeErrorCode(code);
    return normalizedCode ? `[${normalizedCode}] ${normalizedMessage}` : normalizedMessage;
}

function readErrorCodeFromError(error) {
    if (!error || typeof error !== 'object') return '';
    const directCode = normalizeErrorCode(error.code || '');
    if (directCode) return directCode;
    if (error.body && typeof error.body === 'object') {
        const bodyCode = normalizeErrorCode(error.body.code || '');
        if (bodyCode) return bodyCode;
    }
    return '';
}

function readErrorStatusFromError(error) {
    if (!error || typeof error !== 'object') return 0;
    const status = Number(error.status || 0);
    return Number.isFinite(status) ? status : 0;
}

function isSessionAuthFailure(input) {
    const code = normalizeErrorCode(
        (input && typeof input === 'object' ? input.code : '') || readErrorCodeFromError(input)
    );
    return SESSION_ERROR_CODES.has(code);
}

function resetAuthFailureState() {
    state.authFailures.count = 0;
    state.authFailures.lastAt = 0;
}

function forceSessionReauth() {
    if (state.authFailures.locked) return;
    state.authFailures.locked = true;

    clearConnectionProbeTimer();
    if (realtimeSync && typeof realtimeSync.disconnect === 'function') {
        realtimeSync.disconnect();
    }

    showErrorToast('Session expired. Please sign in again.', 'Authentication Required', {
        code: 'SESSION_EXPIRED'
    });

    setTimeout(() => {
        if (window.OrbitAuth && typeof window.OrbitAuth.signOut === 'function') {
            window.OrbitAuth.signOut({ redirectTo: '/signin/' });
            return;
        }
        window.location.href = routePath('/signin/');
    }, 220);
}

function registerSessionAuthFailure(detail = {}) {
    if (state.authFailures.locked) return;

    const now = Date.now();
    if (now - state.authFailures.lastAt > AUTH_FAILURE_WINDOW_MS) {
        state.authFailures.count = 0;
    }

    state.authFailures.count += 1;
    state.authFailures.lastAt = now;

    if (state.authFailures.count >= AUTH_FAILURE_THRESHOLD) {
        forceSessionReauth();
    }
}

function handleTaskAuthFailureEvent(event) {
    const detail = event && typeof event === 'object' && event.detail && typeof event.detail === 'object'
        ? event.detail
        : {};
    if (!isSessionAuthFailure(detail)) return;
    registerSessionAuthFailure(detail);
}

function handleTaskAuthSuccessEvent() {
    if (state.authFailures.locked) return;
    resetAuthFailureState();
}

function attachTaskAuthWatchers() {
    if (typeof window.addEventListener !== 'function') return;
    window.addEventListener(TASK_AUTH_FAILURE_EVENT, handleTaskAuthFailureEvent);
    window.addEventListener(TASK_AUTH_SUCCESS_EVENT, handleTaskAuthSuccessEvent);
}

function getTaskDebugContext(activeProject, extras = {}) {
    const hasMemberSelect = Boolean(document.getElementById('taskMembersSelect'));
    const base = {
        projectId: activeProject && typeof activeProject.id === 'string' ? activeProject.id : '',
        workspaceId: getProjectWorkspaceId(activeProject),
        viewMode: state.viewMode === 'board' ? 'board' : 'timeline',
        filterStatus: sanitizeText(state.filters.status || 'All', 40) || 'All',
        filterMember: sanitizeText(state.filters.member || 'All', 60) || 'All',
        filterText: sanitizeText(state.filters.text || '', 60),
        hasMemberSelect
    };
    return {
        ...base,
        ...(extras && typeof extras === 'object' ? extras : {})
    };
}

function createTaskFlowError(code, message, context = {}) {
    const error = new Error(String(message || 'Task operation failed.'));
    error.code = normalizeErrorCode(code, 'TASK_SAVE_RUNTIME');
    error.context = context && typeof context === 'object' ? context : {};
    return error;
}

function getTaskFlowErrorMeta(error, fallbackCode, fallbackMessage) {
    const code = readErrorCodeFromError(error) || normalizeErrorCode(fallbackCode, 'TASK_SAVE_RUNTIME');
    const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : String(fallbackMessage || 'Unexpected task error.');
    const context = error && typeof error === 'object' && error.context && typeof error.context === 'object'
        ? error.context
        : {};
    return { code, message, context };
}

function assertElementById(id, code = 'TASK_SAVE_DOM_MISSING') {
    const element = document.getElementById(id);
    if (!element) {
        throw createTaskFlowError(
            code,
            `Required UI field is missing (${id}). Please refresh and try again.`,
            { elementId: id }
        );
    }
    return element;
}

function safeFocusById(id) {
    const element = document.getElementById(id);
    if (element && typeof element.focus === 'function') {
        element.focus();
    }
}

function acquireMutationLock(lockKey) {
    const key = typeof lockKey === 'string' ? lockKey.trim() : '';
    if (!key) return false;
    if (activeMutationLocks.has(key)) return false;
    activeMutationLocks.add(key);
    return true;
}

function releaseMutationLock(lockKey) {
    const key = typeof lockKey === 'string' ? lockKey.trim() : '';
    if (!key) return;
    activeMutationLocks.delete(key);
}

function setWorkspaceSettingsBusy(isBusy) {
    const controls = [
        'workspaceNameInput',
        'workspaceStartDateInput',
        'workspaceEndDateInput',
        'workspaceHourFormatSelect',
        'workspaceShowWeekendsInput',
        'workspaceWeekStartSelect',
        'workspaceDefaultDurationInput',
        'workspaceSettingsDeleteBtn',
        'workspaceSettingsCancelBtn',
        'workspaceSettingsCloseBtn'
    ];
    controls.forEach((id) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.toggleAttribute('disabled', Boolean(isBusy));
    });

    const saveBtn = document.getElementById('workspaceSettingsSaveBtn');
    if (saveBtn) {
        saveBtn.toggleAttribute('disabled', Boolean(isBusy));
        saveBtn.dataset.busy = isBusy ? '1' : '0';
        saveBtn.textContent = isBusy
            ? (workspaceSettingsDialog.mode === 'create' ? 'Creating...' : 'Saving...')
            : (workspaceSettingsDialog.mode === 'create' ? 'Create' : 'Save');
    }
}

async function mapWithConcurrency(items, limit, mapper) {
    const source = Array.isArray(items) ? items : [];
    if (source.length === 0) {
        return [];
    }

    const safeLimit = Math.max(1, Number(limit) || 1);
    const results = new Array(source.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.min(safeLimit, source.length) }).map(async () => {
        while (true) {
            const currentIndex = cursor;
            cursor += 1;
            if (currentIndex >= source.length) {
                return;
            }
            results[currentIndex] = await mapper(source[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
}

function getErrorToastContainer() {
    let container = document.getElementById('errorToastContainer');
    if (container) {
        return container;
    }

    container = document.createElement('div');
    container.id = 'errorToastContainer';
    container.className = 'error-toast-stack';
    document.body.appendChild(container);
    return container;
}

function showErrorToast(message, title = 'Error', duration = 4200, details = null) {
    let resolvedDuration = duration;
    let resolvedDetails = details;
    if (duration && typeof duration === 'object') {
        resolvedDetails = duration;
        resolvedDuration = 4200;
    }

    const normalizedCode = normalizeErrorCode(
        resolvedDetails && typeof resolvedDetails === 'object' ? resolvedDetails.code : ''
    );
    const normalizedMessage = buildErrorToastMessage(message, normalizedCode);
    if (!normalizedMessage) return;

    const now = Date.now();
    const normalizedTitle = String(title || 'Error').trim() || 'Error';
    const dedupeKey = `${normalizedTitle}|${String(message || '').trim()}`;
    if (dedupeKey === lastErrorToastMessage && now - lastErrorToastAt < 1400) {
        return;
    }
    lastErrorToastMessage = dedupeKey;
    lastErrorToastAt = now;

    const container = getErrorToastContainer();
    const toast = document.createElement('article');
    toast.className = 'error-toast';

    const titleEl = document.createElement('div');
    titleEl.className = 'error-toast-title';
    titleEl.textContent = normalizedTitle;
    toast.appendChild(titleEl);

    const messageEl = document.createElement('div');
    messageEl.className = 'error-toast-message';
    messageEl.textContent = normalizedMessage;
    toast.appendChild(messageEl);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    const ttl = Number.isFinite(Number(resolvedDuration)) ? Math.max(1800, Number(resolvedDuration)) : 4200;
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 220);
    }, ttl);
}

function routePath(path) {
    return window.OrbitAuth && typeof window.OrbitAuth.resolvePath === 'function'
        ? window.OrbitAuth.resolvePath(path)
        : path;
}

function writeHotRouteNavigation(fromPath, toPath) {
    try {
        const fromUrl = new URL(routePath(fromPath), window.location.origin);
        const toUrl = new URL(toPath, window.location.origin);
        sessionStorage.setItem(
            HOT_ROUTE_NAV_STORAGE_KEY,
            JSON.stringify({
                from: fromUrl.pathname,
                to: toUrl.pathname,
                at: Date.now()
            })
        );
    } catch (_) {
        // ignore sessionStorage errors
    }
}

function navigateTo(url) {
    writeHotRouteNavigation('/home/', url);
    document.body.classList.add('fade-out');
    setTimeout(() => {
        window.location.href = url;
    }, 280);
}

function safeParseJSON(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function readProjectAccessIndex() {
    try {
        const raw = localStorage.getItem(PROJECT_ACCESS_INDEX_STORAGE_KEY);
        const parsed = safeParseJSON(raw);
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        const next = {};
        Object.entries(parsed).forEach(([projectId, timestamp]) => {
            if (!isUuid(projectId)) return;
            const value = Number(timestamp);
            if (Number.isFinite(value) && value > 0) {
                next[projectId] = Math.floor(value);
            }
        });
        return next;
    } catch (_) {
        return {};
    }
}

function writeProjectAccessIndex() {
    try {
        localStorage.setItem(PROJECT_ACCESS_INDEX_STORAGE_KEY, JSON.stringify(state.projectAccessIndex));
    } catch (_) {
        // ignore localStorage write errors
    }
}

function markProjectAccessed(projectId, at = Date.now()) {
    const timestamp = Number(at);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const safeProjectId = typeof projectId === 'string' ? projectId : '';
    if (!safeProjectId) return;

    const nextTimestamp = Math.floor(timestamp);
    const project = state.projects.find((item) => item.id === projectId);
    if (project) {
        project.lastAccessedAt = nextTimestamp;
    }

    if (!isUuid(safeProjectId)) {
        return;
    }
    state.projectAccessIndex[safeProjectId] = nextTimestamp;
    writeProjectAccessIndex();
}

function getProjectLastAccessed(project) {
    if (!project || typeof project !== 'object') return 0;
    const inlineTimestamp = Number(project.lastAccessedAt);
    if (Number.isFinite(inlineTimestamp) && inlineTimestamp > 0) {
        return inlineTimestamp;
    }
    if (typeof project.id === 'string' && isUuid(project.id)) {
        const fromIndex = Number(state.projectAccessIndex[project.id]);
        if (Number.isFinite(fromIndex) && fromIndex > 0) {
            return fromIndex;
        }
    }
    return 0;
}

function sortProjectsByRecentAccess(projects = []) {
    return [...projects].sort((a, b) => {
        const aAccessed = getProjectLastAccessed(a);
        const bAccessed = getProjectLastAccessed(b);
        if (aAccessed !== bAccessed) {
            return bAccessed - aAccessed;
        }
        const aName = sanitizeText(a && a.name, 80) || 'Project';
        const bName = sanitizeText(b && b.name, 80) || 'Project';
        return aName.localeCompare(bName, 'vi-VN', { sensitivity: 'base' });
    });
}

function getProjectWorkspaceId(project) {
    if (!project || typeof project !== 'object') return '';
    return isUuid(project.workspaceId) ? project.workspaceId : '';
}

function getProjectRequestOptions(project) {
    const workspaceId = getProjectWorkspaceId(project);
    return workspaceId ? { workspaceId } : {};
}

function hydrateProjectAccessMetadata() {
    const projectIdSet = new Set();
    state.projects.forEach((project) => {
        if (isUuid(project && project.id)) {
            projectIdSet.add(project.id);
        }
        const accessedAt = getProjectLastAccessed(project);
        if (accessedAt > 0) {
            project.lastAccessedAt = accessedAt;
        } else {
            delete project.lastAccessedAt;
        }
    });

    let shouldPersistIndex = false;
    Object.keys(state.projectAccessIndex).forEach((projectId) => {
        if (!projectIdSet.has(projectId)) {
            delete state.projectAccessIndex[projectId];
            shouldPersistIndex = true;
        }
    });
    if (shouldPersistIndex) {
        writeProjectAccessIndex();
    }
}

function resolveDefaultWorkspaceId() {
    const activeProject = getActiveProject();
    const activeProjectWorkspaceId = getProjectWorkspaceId(activeProject);
    if (activeProjectWorkspaceId) {
        return activeProjectWorkspaceId;
    }

    const candidates = [
        state.remoteSync.workspaceId,
        window.__ORBIT_ACTIVE_WORKSPACE_ID,
        localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || ''
    ];
    return candidates.find((value) => isUuid(value)) || '';
}

function assignMissingWorkspaceIds(fallbackWorkspaceId = '') {
    const effectiveWorkspaceId = isUuid(fallbackWorkspaceId)
        ? fallbackWorkspaceId
        : resolveDefaultWorkspaceId();
    if (!effectiveWorkspaceId) return;

    state.projects.forEach((project) => {
        if (!getProjectWorkspaceId(project)) {
            project.workspaceId = effectiveWorkspaceId;
        }
    });
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sanitizeText(value, maxLen = 120) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

function sanitizeProjectAvatarInitial(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const firstChar = Array.from(trimmed)[0] || '';
    return firstChar ? firstChar.toLocaleUpperCase('vi-VN') : '';
}

function getProjectAvatarFallback(projectName) {
    const normalizedName = sanitizeText(projectName, 80);
    if (!normalizedName) return 'P';
    const firstChar = Array.from(normalizedName)[0] || '';
    return firstChar ? firstChar.toLocaleUpperCase('vi-VN') : 'P';
}

function resolveProjectAvatarInitial(project) {
    if (!project || typeof project !== 'object') return 'P';
    const explicitInitial = sanitizeProjectAvatarInitial(project.avatarInitial);
    if (explicitInitial) return explicitInitial;
    return getProjectAvatarFallback(project.name);
}

function sanitizeNote(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, 1000);
}

function isISODate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeValue(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toDateTimeLocal(dateISO, timeValue) {
    if (!isISODate(dateISO) || !isTimeValue(timeValue)) return '';
    return `${dateISO}T${timeValue}`;
}

function parseDateTimeLocal(value) {
    if (typeof value !== 'string' || !value.includes('T')) return null;
    const [datePart, timePartRaw] = value.split('T');
    const timePart = timePartRaw ? timePartRaw.slice(0, 5) : '';
    if (!isISODate(datePart) || !isTimeValue(timePart)) return null;
    return { date: datePart, time: timePart };
}

function timeToMinutes(value) {
    if (!isTimeValue(value)) return null;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(totalMinutes) {
    const clamped = clamp(Math.round(totalMinutes), 0, DAY_HOURS * 60);
    const hours = Math.floor(clamped / 60) % DAY_HOURS;
    const mins = clamped % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function leftToTime(left) {
    const hours = clamp(left / state.hourWidth, 0, DAY_HOURS);
    return minutesToTime(hours * 60);
}

function timeToLeft(timeValue) {
    const minutes = timeToMinutes(timeValue);
    if (minutes === null) return 0;
    return (minutes / 60) * state.hourWidth;
}

function widthToMinutes(width) {
    return clamp((width / state.hourWidth) * 60, 15, DAY_HOURS * 60);
}

function getQuarterRoundedNowTime() {
    const now = new Date();
    const mins = now.getMinutes();
    const rounded = Math.ceil(mins / 15) * 15;
    if (rounded >= 60) {
        now.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
        now.setMinutes(rounded, 0, 0);
    }
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function sanitizeImageUrl(value) {
    if (typeof value !== 'string') return '';
    const url = value.trim();
    if (!url) return '';
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+$/.test(url)) return url;
    if (/^https?:\/\/\S+$/i.test(url)) return url;
    return '';
}

function sanitizeTimezone(value) {
    const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    if (typeof value !== 'string' || !value.trim()) return defaultTz;
    const mapped = LEGACY_TIMEZONE_MAP[value] || value;
    try {
        Intl.DateTimeFormat('en-US', { timeZone: mapped }).format(new Date());
        return mapped;
    } catch (_) {
        return defaultTz;
    }
}

function getDefaultBoardSettings() {
    return {
        timeline: {
            startDate: '',
            endDate: '',
            hourFormat: '24',
            showWeekends: true,
            weekStart: 'mon',
            defaultDuration: 2
        },
        account: {
            timezone: sanitizeTimezone('')
        }
    };
}

function sanitizeBoardSettings(raw) {
    const defaults = getDefaultBoardSettings();
    const timeline = raw && typeof raw === 'object' && raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : {};
    const account = raw && typeof raw === 'object' && raw.account && typeof raw.account === 'object' ? raw.account : {};
    const defaultDuration = Number(timeline.defaultDuration);
    return {
        timeline: {
            startDate: isISODate(timeline.startDate) ? timeline.startDate : '',
            endDate: isISODate(timeline.endDate) ? timeline.endDate : '',
            hourFormat: timeline.hourFormat === '12' ? '12' : defaults.timeline.hourFormat,
            showWeekends: typeof timeline.showWeekends === 'boolean' ? timeline.showWeekends : defaults.timeline.showWeekends,
            weekStart: timeline.weekStart === 'sun' ? 'sun' : defaults.timeline.weekStart,
            defaultDuration: Number.isFinite(defaultDuration) ? clamp(defaultDuration, 0.5, 12) : defaults.timeline.defaultDuration
        },
        account: {
            timezone: sanitizeTimezone(account.timezone)
        }
    };
}

function loadBoardSettings() {
    return sanitizeBoardSettings(safeParseJSON(localStorage.getItem('orbitSettings')));
}

function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function fromISODate(value) {
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d);
}

function shiftISODate(dateISO, days) {
    const d = fromISODate(dateISO);
    d.setDate(d.getDate() + days);
    return toISODate(d);
}

function computeEndDateTime(startDate, startTime, durationHours) {
    const startMinutes = timeToMinutes(startTime);
    if (!startDate || startMinutes === null) {
        return { endDate: startDate, endTime: startTime };
    }
    const totalMinutes = startMinutes + Math.round(durationHours * 60);
    if (totalMinutes < DAY_HOURS * 60) {
        return {
            endDate: startDate,
            endTime: minutesToTime(totalMinutes)
        };
    }
    return {
        endDate: shiftISODate(startDate, 1),
        endTime: minutesToTime(totalMinutes - DAY_HOURS * 60)
    };
}

function getISOInTimezone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(date);
}

function getTodayISO() {
    const tz = state.settings?.account?.timezone || 'UTC';
    return getISOInTimezone(new Date(), tz);
}

function getDefaultProject() {
    const authUser = window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
        ? window.OrbitAuth.getStoredUser()
        : null;
    const displayName = sanitizeText(
        (typeof authUser?.displayName === 'string' && authUser.displayName.trim()) ||
        (typeof authUser?.fullName === 'string' && authUser.fullName.trim()) ||
        (typeof authUser?.username === 'string' && authUser.username.trim()) ||
        (typeof authUser?.email === 'string' && authUser.email.includes('@') ? authUser.email.split('@')[0] : ''),
        40
    ) || 'You';
    return {
        id: `proj-${Date.now()}`,
        name: 'Project Nebula',
        avatarInitial: '',
        active: true,
        background: '',
        startDate: '',
        endDate: '',
        hourFormat: '24',
        showWeekends: true,
        weekStart: 'mon',
        defaultDurationHours: 2,
        members: [
            {
                userId: typeof authUser?.id === 'string' ? authUser.id : '',
                role: 'OWNER',
                name: displayName,
                color: '#6e56cf',
                user: {
                    displayName,
                    fullName: typeof authUser?.fullName === 'string' ? authUser.fullName : '',
                    email: typeof authUser?.email === 'string' ? authUser.email : '',
                    avatarUrl: typeof authUser?.avatarUrl === 'string' ? authUser.avatarUrl : ''
                }
            }
        ],
        tasks: []
    };
}

function sanitizeMember(member, index) {
    const raw = member && typeof member === 'object' ? member : {};
    const color = typeof raw.color === 'string' && /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(raw.color)
        ? raw.color
        : '#6e56cf';
    const userId = typeof raw.userId === 'string' ? raw.userId.trim() : '';
    const role = typeof raw.role === 'string' ? raw.role.trim().toUpperCase() : '';
    const userRecord = raw.user && typeof raw.user === 'object' ? raw.user : {};
    const sourceName = typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : (
            (typeof userRecord.displayName === 'string' && userRecord.displayName.trim()) ||
            (typeof userRecord.fullName === 'string' && userRecord.fullName.trim()) ||
            (typeof userRecord.email === 'string' && userRecord.email.includes('@') ? userRecord.email.split('@')[0] : '') ||
            ''
        );
    const name = sanitizeText(sourceName, 40) || 'User';
    return {
        name,
        color,
        userId: isUuid(userId) ? userId : '',
        role,
        user: {
            displayName: typeof userRecord.displayName === 'string' ? userRecord.displayName : '',
            fullName: typeof userRecord.fullName === 'string' ? userRecord.fullName : '',
            email: typeof userRecord.email === 'string' ? userRecord.email : '',
            avatarUrl: typeof userRecord.avatarUrl === 'string' ? userRecord.avatarUrl : ''
        }
    };
}

function normalizeMemberLabel(value) {
    const raw = sanitizeText(value, 120);
    if (!raw) return '';
    if (raw.includes('@')) {
        return sanitizeText(raw.split('@')[0], 40);
    }
    if (isUuid(raw)) {
        return 'User';
    }
    return sanitizeText(raw, 40);
}

function resolveMemberDisplay(member) {
    const user = member && typeof member.user === 'object' ? member.user : {};
    const displayName = sanitizeText(
        (typeof user.displayName === 'string' && user.displayName.trim()) ||
        (typeof user.fullName === 'string' && user.fullName.trim()) ||
        (typeof user.email === 'string' && user.email.includes('@') ? user.email.split('@')[0] : ''),
        40
    );
    if (displayName) {
        return displayName;
    }

    if (typeof member?.email === 'string' && member.email.includes('@')) {
        return sanitizeText(member.email.split('@')[0], 40) || 'User';
    }

    return 'User';
}

function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) return '';
    return email;
}

function getPermissionContext(project) {
    const authUser = window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
        ? window.OrbitAuth.getStoredUser()
        : null;
    return {
        systemRole: authUser && typeof authUser.systemRole === 'string' ? authUser.systemRole : 'USER',
        workspaceRole: project && typeof project.workspaceRole === 'string' ? project.workspaceRole : null,
        projectRole: project && typeof project.projectRole === 'string' ? project.projectRole : null
    };
}

function hasExplicitPermissionRoles(context) {
    const workspaceRole = typeof context.workspaceRole === 'string'
        ? context.workspaceRole.trim().toUpperCase()
        : '';
    const projectRole = typeof context.projectRole === 'string'
        ? context.projectRole.trim().toUpperCase()
        : '';
    return Boolean(workspaceRole || projectRole);
}

function canEditProjectTasks(project) {
    if (!window.OrbitPermissions || typeof window.OrbitPermissions.canEditTask !== 'function') {
        return true;
    }
    const context = getPermissionContext(project);
    if (!hasExplicitPermissionRoles(context)) {
        return true;
    }
    return window.OrbitPermissions.canEditTask(context);
}

function canManageProjectSettings(project) {
    if (!window.OrbitPermissions || typeof window.OrbitPermissions.canManageProjectSettings !== 'function') {
        return true;
    }
    const context = getPermissionContext(project);
    if (!hasExplicitPermissionRoles(context)) {
        return true;
    }
    return window.OrbitPermissions.canManageProjectSettings(context);
}

function canManageWorkspaceMembers(project) {
    if (!window.OrbitPermissions || typeof window.OrbitPermissions.canManageWorkspaceMembers !== 'function') {
        return true;
    }
    const context = getPermissionContext(project);
    if (!hasExplicitPermissionRoles(context)) {
        return true;
    }
    return window.OrbitPermissions.canManageWorkspaceMembers(context);
}

function canDeleteWorkspace(project) {
    if (!project || typeof project !== 'object') {
        return false;
    }

    const context = getPermissionContext(project);
    const workspaceRole = typeof context.workspaceRole === 'string'
        ? context.workspaceRole.trim().toUpperCase()
        : '';
    if (workspaceRole === 'OWNER') {
        return true;
    }

    const authUser = window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
        ? window.OrbitAuth.getStoredUser()
        : null;
    const currentUserId = isUuid(authUser && authUser.id) ? authUser.id : '';
    const ownerUserId = isUuid(project.ownerUserId) ? project.ownerUserId : '';
    return Boolean(currentUserId && ownerUserId && currentUserId === ownerUserId);
}

function getCurrentUserId() {
    const authUser = window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
        ? window.OrbitAuth.getStoredUser()
        : null;
    return isUuid(authUser && authUser.id) ? authUser.id : '';
}

function isMemberRestrictedEditor(project) {
    const context = getPermissionContext(project);
    const workspaceRole = typeof context.workspaceRole === 'string'
        ? context.workspaceRole.trim().toUpperCase()
        : '';
    const projectRole = typeof context.projectRole === 'string'
        ? context.projectRole.trim().toUpperCase()
        : '';

    if (workspaceRole === 'OWNER' || workspaceRole === 'ADMIN') {
        return false;
    }
    return projectRole === 'MEMBER' || (!projectRole && workspaceRole === 'MEMBER');
}

function isTaskOwnedByCurrentUser(taskData) {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return false;
    const memberUserId = taskData && isUuid(taskData.memberUserId) ? taskData.memberUserId : '';
    return Boolean(memberUserId) && memberUserId === currentUserId;
}

function canMutateTask(taskData, project) {
    if (!project || !canEditProjectTasks(project)) return false;
    if (!isMemberRestrictedEditor(project)) return true;
    return isTaskOwnedByCurrentUser(taskData);
}

function deterministicColorFromUserId(userId) {
    if (!isUuid(userId)) return '#9ca3af';
    let hash = 0;
    for (let index = 0; index < userId.length; index += 1) {
        hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
    }
    return ASSIGNEE_MUTED_PALETTE[hash % ASSIGNEE_MUTED_PALETTE.length];
}

function resolveTaskAssigneeColor(taskData, member) {
    if (taskData && isUuid(taskData.memberUserId)) {
        return deterministicColorFromUserId(taskData.memberUserId);
    }
    if (member && typeof member.color === 'string' && member.color.trim()) {
        return member.color.trim();
    }
    return '#9ca3af';
}

function sanitizeTask(task, index) {
    const raw = task && typeof task === 'object' ? task : {};
    const maxWidth = state.hourWidth * DAY_HOURS;
    const leftRaw = Number(raw.left);
    const widthRaw = Number(raw.width);
    const leftFallback = Number.isFinite(leftRaw) ? clamp(leftRaw, 0, maxWidth) : 48;
    const widthSafe = Number.isFinite(widthRaw) ? widthRaw : state.hourWidth * 2;
    const widthFallback = clamp(widthSafe, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - leftFallback));

    const startDate = isISODate(raw.startDate) ? raw.startDate : (isISODate(raw.date) ? raw.date : '');
    let endDate = isISODate(raw.endDate) ? raw.endDate : startDate;
    if (startDate && endDate && endDate < startDate) endDate = startDate;

    const startTime = isTimeValue(raw.startTime) ? raw.startTime : leftToTime(leftFallback);
    const endTimeRaw = isTimeValue(raw.endTime) ? raw.endTime : (isTimeValue(raw.dueTime) ? raw.dueTime : leftToTime(leftFallback + widthFallback));
    const startMinutes = timeToMinutes(startTime);
    const endMinutesRaw = timeToMinutes(endTimeRaw);

    let left = leftFallback;
    let width = widthFallback;
    let endTime = endTimeRaw;

    if (startMinutes !== null) {
        left = clamp(timeToLeft(startTime), 0, maxWidth);
    }

    const isCrossDay = Boolean(startDate && endDate && endDate > startDate);
    if (startMinutes !== null && endMinutesRaw !== null) {
        if (isCrossDay) {
            width = clamp(maxWidth - left, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - left));
        } else {
            const endMinutes = endMinutesRaw > startMinutes ? endMinutesRaw : startMinutes + 15;
            endTime = minutesToTime(endMinutes);
            width = clamp(((endMinutes - startMinutes) / 60) * state.hourWidth, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - left));
        }
    } else {
        width = clamp(width, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - left));
        endTime = leftToTime(left + width);
    }

    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `task-${Date.now()}-${index}`,
        name: sanitizeText(raw.name, 120) || 'Untitled Task',
        date: startDate,
        startDate,
        startTime,
        endDate: endDate || startDate,
        endTime,
        status: TASK_STATUSES.includes(raw.status) ? raw.status : 'Not Started',
        memberName: sanitizeText(raw.memberName, 40),
        memberUserId: isUuid(raw.memberUserId) ? raw.memberUserId : '',
        note: sanitizeNote(raw.note),
        image: sanitizeImageUrl(raw.image),
        left,
        width,
        priority: TASK_PRIORITIES.includes(raw.priority) ? raw.priority : 'Medium',
        dueTime: endTime,
        track: Number.isFinite(Number(raw.track)) ? Math.max(0, Number(raw.track)) : 0
    };
}

function sanitizeProject(project, index) {
    const raw = project && typeof project === 'object' ? project : {};
    const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const membersRaw = Array.isArray(raw.members) ? raw.members : [];
    const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
    const workspaceId = isUuid(raw.workspaceId) ? raw.workspaceId : '';
    const inlineLastAccessedAt = Number(raw.lastAccessedAt);
    const normalizedLastAccessedAt = Number.isFinite(inlineLastAccessedAt) && inlineLastAccessedAt > 0
        ? Math.floor(inlineLastAccessedAt)
        : 0;
    const projectId = typeof raw.id === 'string' && raw.id ? raw.id : `proj-${Date.now()}-${index}`;
    const projectLastAccessedAt = normalizedLastAccessedAt > 0
        ? normalizedLastAccessedAt
        : (isUuid(projectId) ? Number(state.projectAccessIndex[projectId]) || 0 : 0);
    return {
        id: projectId,
        name: sanitizeText(raw.name, 80) || `Project ${index + 1}`,
        avatarInitial: sanitizeProjectAvatarInitial(raw.avatarInitial),
        active: Boolean(raw.active),
        background: sanitizeImageUrl(raw.background),
        starred: Boolean(raw.starred),
        workspaceId,
        lastAccessedAt: projectLastAccessedAt > 0 ? projectLastAccessedAt : undefined,
        ownerUserId: isUuid(raw.ownerUserId) ? raw.ownerUserId : '',
        visibility: String(raw.visibility || 'PRIVATE').toUpperCase() === 'WORKSPACE' ? 'WORKSPACE' : 'PRIVATE',
        defaultView: String(raw.defaultView || 'BOARD').toUpperCase() === 'CALENDAR' ? 'CALENDAR' : 'BOARD',
        startDate: normalizeWorkspaceDate(rawSettings.startDate || raw.startDate),
        endDate: normalizeWorkspaceDate(rawSettings.endDate || raw.endDate),
        hourFormat: normalizeWorkspaceHourFormat(
            rawSettings.hourFormat !== undefined ? rawSettings.hourFormat : raw.hourFormat,
            '24'
        ),
        showWeekends: normalizeWorkspaceShowWeekends(
            rawSettings.showWeekends !== undefined ? rawSettings.showWeekends : raw.showWeekends,
            true
        ),
        weekStart: normalizeWorkspaceWeekStart(
            rawSettings.weekStart !== undefined ? rawSettings.weekStart : raw.weekStart,
            'mon'
        ),
        defaultDurationHours: normalizeWorkspaceDefaultDuration(
            rawSettings.defaultDurationHours !== undefined
                ? rawSettings.defaultDurationHours
                : raw.defaultDurationHours,
            2
        ),
        workspaceRole: typeof raw.workspaceRole === 'string' ? raw.workspaceRole.toUpperCase() : '',
        projectRole: typeof raw.projectRole === 'string' ? raw.projectRole.toUpperCase() : '',
        members: membersRaw.map(sanitizeMember),
        tasks: tasksRaw.map(sanitizeTask).filter((task) => task.date)
    };
}

function isUuid(value) {
    return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

function hasTaskApiClient() {
    return Boolean(
        window.OrbitTaskApi &&
        typeof window.OrbitTaskApi.getToken === 'function' &&
        typeof window.OrbitTaskApi.ensureWorkspace === 'function'
    );
}

function toIsoDateTime(dateISO, timeValue) {
    if (!isISODate(dateISO) || !isTimeValue(timeValue)) return null;
    const parsed = new Date(`${dateISO}T${timeValue}:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function fromIsoDateTime(value) {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
        date: toISODate(parsed),
        time: `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
    };
}

function sanitizePersistentImage(value, maxLen) {
    const normalized = sanitizeImageUrl(value);
    if (!normalized) return '';
    if (normalized.startsWith('data:')) return '';
    return normalized.slice(0, maxLen);
}

function buildProjectDescription(project) {
    const members = Array.isArray(project.members)
        ? project.members.slice(0, 30).map((member, index) => sanitizeMember(member, index))
        : [];
    const meta = {
        version: 1,
        background: sanitizePersistentImage(project.background, 1200),
        starred: Boolean(project.starred),
        avatarInitial: sanitizeProjectAvatarInitial(project.avatarInitial),
        members
    };
    return `${PROJECT_META_PREFIX}${JSON.stringify(meta)}`;
}

function parseProjectDescription(description) {
    if (typeof description !== 'string' || !description.startsWith(PROJECT_META_PREFIX)) {
        return null;
    }
    const parsed = safeParseJSON(description.slice(PROJECT_META_PREFIX.length));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
}

function buildTaskDescription(task) {
    const meta = {
        version: 1,
        startDate: isISODate(task.startDate) ? task.startDate : '',
        startTime: isTimeValue(task.startTime) ? task.startTime : '',
        endDate: isISODate(task.endDate) ? task.endDate : '',
        endTime: isTimeValue(task.endTime) ? task.endTime : '',
        note: sanitizeNote(task.note),
        image: sanitizePersistentImage(task.image, 1200),
        memberName: sanitizeText(task.memberName, 40),
        memberUserId: isUuid(task.memberUserId) ? task.memberUserId : '',
        track: Number.isFinite(Number(task.track)) ? Math.max(0, Number(task.track)) : 0
    };
    return `${TASK_META_PREFIX}${JSON.stringify(meta)}`;
}

function parseTaskDescription(description) {
    if (typeof description !== 'string' || !description.startsWith(TASK_META_PREFIX)) {
        return null;
    }
    const parsed = safeParseJSON(description.slice(TASK_META_PREFIX.length));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
}

function mapLocalStatusToBackend(value) {
    return LOCAL_TO_BACKEND_STATUS[value] || 'TODO';
}

function mapBackendStatusToLocal(value) {
    return BACKEND_TO_LOCAL_STATUS[value] || 'Not Started';
}

function mapLocalPriorityToBackend(value) {
    return LOCAL_TO_BACKEND_PRIORITY[value] || 'MEDIUM';
}

function mapBackendPriorityToLocal(value) {
    return BACKEND_TO_LOCAL_PRIORITY[value] || 'Medium';
}

function normalizeProjectsCollection(projects) {
    if (!Array.isArray(projects) || projects.length === 0) {
        return [];
    }

    const collapsedByWorkspace = new Map();
    const activeWorkspaceId =
        projects
            .map((project) => (project && project.active ? (getProjectWorkspaceId(project) || project.id) : ''))
            .find((value) => isUuid(value)) || '';

    projects.forEach((project, index) => {
        const normalized = sanitizeProject(project, index);
        const workspaceId = getProjectWorkspaceId(normalized) || (isUuid(normalized.id) ? normalized.id : '');
        if (!workspaceId) {
            return;
        }
        normalized.workspaceId = workspaceId;
        normalized.id = workspaceId;

        if (!collapsedByWorkspace.has(workspaceId)) {
            collapsedByWorkspace.set(workspaceId, normalized);
            return;
        }

        const current = collapsedByWorkspace.get(workspaceId);
        const mergedTasks = [...(Array.isArray(current.tasks) ? current.tasks : [])];
        const existingTaskIds = new Set(mergedTasks.map((task) => task.id));
        (Array.isArray(normalized.tasks) ? normalized.tasks : []).forEach((task) => {
            if (existingTaskIds.has(task.id)) return;
            mergedTasks.push(task);
            existingTaskIds.add(task.id);
        });

        const mergedMembers = [...(Array.isArray(current.members) ? current.members : [])];
        const existingMemberIds = new Set(
            mergedMembers
                .map((member) => (isUuid(member && member.userId) ? member.userId : ''))
                .filter((id) => id)
        );
        (Array.isArray(normalized.members) ? normalized.members : []).forEach((member) => {
            const memberId = isUuid(member && member.userId) ? member.userId : '';
            if (memberId && existingMemberIds.has(memberId)) return;
            mergedMembers.push(member);
            if (memberId) existingMemberIds.add(memberId);
        });

        const candidateLastAccess = Number(normalized.lastAccessedAt || 0);
        const currentLastAccess = Number(current.lastAccessedAt || 0);
        collapsedByWorkspace.set(workspaceId, {
            ...current,
            name: sanitizeText(current.name, 80) || sanitizeText(normalized.name, 80) || `Workspace ${index + 1}`,
            ownerUserId: isUuid(current.ownerUserId) ? current.ownerUserId : normalized.ownerUserId,
            workspaceRole: sanitizeText(current.workspaceRole, 20) || sanitizeText(normalized.workspaceRole, 20) || '',
            startDate: normalizeWorkspaceDate(
                current.startDate ||
                normalized.startDate ||
                (
                    state.workspaceDisplaySettings &&
                    state.workspaceDisplaySettings[workspaceId] &&
                    state.workspaceDisplaySettings[workspaceId].startDate
                ) ||
                ''
            ),
            endDate: normalizeWorkspaceDate(
                current.endDate ||
                normalized.endDate ||
                (
                    state.workspaceDisplaySettings &&
                    state.workspaceDisplaySettings[workspaceId] &&
                    state.workspaceDisplaySettings[workspaceId].endDate
                ) ||
                ''
            ),
            hourFormat: normalizeWorkspaceHourFormat(
                current.hourFormat ||
                normalized.hourFormat ||
                (
                    state.workspaceDisplaySettings &&
                    state.workspaceDisplaySettings[workspaceId] &&
                    state.workspaceDisplaySettings[workspaceId].hourFormat
                ) ||
                '24',
                '24'
            ),
            showWeekends: normalizeWorkspaceShowWeekends(
                typeof current.showWeekends === 'boolean'
                    ? current.showWeekends
                    : (
                        typeof normalized.showWeekends === 'boolean'
                            ? normalized.showWeekends
                            : (
                                state.workspaceDisplaySettings &&
                                state.workspaceDisplaySettings[workspaceId] &&
                                state.workspaceDisplaySettings[workspaceId].showWeekends
                            )
                    ),
                true
            ),
            weekStart: normalizeWorkspaceWeekStart(
                current.weekStart ||
                normalized.weekStart ||
                (
                    state.workspaceDisplaySettings &&
                    state.workspaceDisplaySettings[workspaceId] &&
                    state.workspaceDisplaySettings[workspaceId].weekStart
                ) ||
                'mon',
                'mon'
            ),
            defaultDurationHours: normalizeWorkspaceDefaultDuration(
                current.defaultDurationHours ||
                normalized.defaultDurationHours ||
                (
                    state.workspaceDisplaySettings &&
                    state.workspaceDisplaySettings[workspaceId] &&
                    state.workspaceDisplaySettings[workspaceId].defaultDuration
                ) ||
                2,
                2
            ),
            members: mergedMembers,
            tasks: mergedTasks,
            lastAccessedAt: Math.max(currentLastAccess, candidateLastAccess),
        });
    });

    const normalizedProjects = [...collapsedByWorkspace.values()];
    if (normalizedProjects.length === 0) {
        return [];
    }
    const fallbackActiveId = activeWorkspaceId || normalizedProjects[0].id;
    normalizedProjects.forEach((project) => {
        project.active = project.id === fallbackActiveId;
    });
    return normalizedProjects;
}

function mapRemoteTaskToLocal(task, index) {
    const parsedMeta = parseTaskDescription(task && task.description);
    const startAtParts = fromIsoDateTime(task && task.startAt);
    const dueAtParts = fromIsoDateTime(task && task.dueAt);

    let startDate = parsedMeta && isISODate(parsedMeta.startDate) ? parsedMeta.startDate : '';
    let startTime = parsedMeta && isTimeValue(parsedMeta.startTime) ? parsedMeta.startTime : '';
    let endDate = parsedMeta && isISODate(parsedMeta.endDate) ? parsedMeta.endDate : '';
    let endTime = parsedMeta && isTimeValue(parsedMeta.endTime) ? parsedMeta.endTime : '';

    if ((!startDate || !startTime) && startAtParts) {
        startDate = startAtParts.date;
        startTime = startAtParts.time;
    }

    if ((!endDate || !endTime) && dueAtParts) {
        endDate = dueAtParts.date;
        endTime = dueAtParts.time;
    }

    if ((!startDate || !startTime) && endDate && endTime) {
        const fallbackStart = new Date(`${endDate}T${endTime}:00`);
        fallbackStart.setHours(fallbackStart.getHours() - 1);
        if (!Number.isNaN(fallbackStart.getTime())) {
            startDate = toISODate(fallbackStart);
            startTime = `${String(fallbackStart.getHours()).padStart(2, '0')}:${String(fallbackStart.getMinutes()).padStart(2, '0')}`;
        }
    }

    if (!startDate || !startTime) {
        const today = getTodayISO();
        startDate = startDate || today;
        startTime = startTime || '09:00';
    }

    if (!endDate || !endTime) {
        const fallbackEnd = new Date(`${startDate}T${startTime}:00`);
        fallbackEnd.setHours(fallbackEnd.getHours() + 1);
        endDate = toISODate(fallbackEnd);
        endTime = `${String(fallbackEnd.getHours()).padStart(2, '0')}:${String(fallbackEnd.getMinutes()).padStart(2, '0')}`;
    }

    const remoteAssigneeId = isUuid(task && task.assigneeUserId)
        ? task.assigneeUserId
        : '';
    const memberUserIdFromMeta = isUuid(parsedMeta && parsedMeta.memberUserId)
        ? parsedMeta.memberUserId
        : '';
    const memberUserId = remoteAssigneeId || memberUserIdFromMeta;
    const memberNameFallback =
        sanitizeText(parsedMeta && parsedMeta.memberName, 40) ||
        normalizeMemberLabel(memberUserId);

    return sanitizeTask({
        id: typeof task.id === 'string' ? task.id : `task-${Date.now()}-${index}`,
        name: sanitizeText(task && task.title, 120) || 'Untitled Task',
        date: startDate,
        startDate,
        startTime,
        endDate,
        endTime,
        status: mapBackendStatusToLocal(task && task.status),
        priority: mapBackendPriorityToLocal(task && task.priority),
        note: sanitizeNote(parsedMeta && parsedMeta.note),
        image: sanitizeImageUrl(parsedMeta && parsedMeta.image),
        memberName: memberNameFallback,
        memberUserId,
        dueTime: endTime,
        track: Number.isFinite(Number(parsedMeta && parsedMeta.track)) ? Math.max(0, Number(parsedMeta.track)) : 0
    }, index);
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

function resolveColumnIdForStatus(columns, backendStatus) {
    const normalizedColumns = Array.isArray(columns) ? columns : [];
    if (normalizedColumns.length === 0) return '';

    let hint = 'done';
    if (backendStatus === 'TODO') hint = 'todo';
    if (backendStatus === 'IN_PROGRESS') hint = 'in progress';

    const matched = normalizedColumns.find((column) => {
        const name = typeof column.name === 'string' ? column.name.toLowerCase() : '';
        return name.includes(hint);
    });
    const selected = matched || normalizedColumns[0];
    return selected && typeof selected.id === 'string' ? selected.id : '';
}

function buildRemoteTaskPayload(task, columns) {
    const status = mapLocalStatusToBackend(task.status);
    const columnId = resolveColumnIdForStatus(columns, status);
    const startAt = toIsoDateTime(task.startDate, task.startTime);
    const payload = {
        title: sanitizeText(task.name, 120) || 'Untitled Task',
        description: buildTaskDescription(task),
        priority: mapLocalPriorityToBackend(task.priority),
        status,
        allDay: false
    };
    if (isUuid(columnId)) {
        payload.columnId = columnId;
    }
    if (startAt) {
        payload.startAt = startAt;
    }
    const dueAt = toIsoDateTime(task.endDate, task.endTime);
    if (dueAt) {
        payload.dueAt = dueAt;
    }
    const startMinutes = timeToMinutes(task.startTime);
    const endMinutes = timeToMinutes(task.endTime);
    if (startMinutes !== null && endMinutes !== null) {
        const estimatedMinutes = Math.max(15, endMinutes - startMinutes);
        payload.estimatedMinutes = estimatedMinutes;
    }
    if (isUuid(task.memberUserId)) {
        payload.assigneeUserId = task.memberUserId;
    } else if (!task.memberName) {
        payload.assigneeUserId = null;
    }
    return payload;
}

function buildTaskCreateIdempotencyKey(task, workspaceId) {
    const workspacePart = isUuid(workspaceId) ? workspaceId : '';
    const localTaskId = sanitizeText(task && task.id, 64);
    const titlePart = sanitizeText(task && task.name, 40) || 'untitled';
    const startDatePart = isISODate(task && task.startDate) ? task.startDate : '';
    const startTimePart = isTimeValue(task && task.startTime) ? task.startTime : '';
    const assigneePart = isUuid(task && task.memberUserId) ? task.memberUserId : '';
    const fallback = `${titlePart}:${startDatePart}:${startTimePart}:${assigneePart}`;
    const stablePart = localTaskId || fallback;
    return `task-create:${workspacePart}:${stablePart}`.slice(0, 128);
}

function buildTaskCreateSpamSignature(task, workspaceId) {
    const workspacePart = isUuid(workspaceId) ? workspaceId : '';
    const titlePart = sanitizeText(task && task.name, 120).toLowerCase();
    const startDatePart = isISODate(task && task.startDate) ? task.startDate : '';
    const startTimePart = isTimeValue(task && task.startTime) ? task.startTime : '';
    const endDatePart = isISODate(task && task.endDate) ? task.endDate : '';
    const endTimePart = isTimeValue(task && task.endTime) ? task.endTime : '';
    const statusPart = TASK_STATUSES.includes(task && task.status) ? String(task.status) : '';
    const priorityPart = TASK_PRIORITIES.includes(task && task.priority) ? String(task.priority) : '';
    const assigneePart = isUuid(task && task.memberUserId)
        ? task.memberUserId
        : sanitizeText(task && task.memberName, 40).toLowerCase();
    return [
        workspacePart,
        titlePart,
        startDatePart,
        startTimePart,
        endDatePart,
        endTimePart,
        statusPart,
        priorityPart,
        assigneePart
    ].join('|');
}

function rememberTaskCreateSpamSignature(signature) {
    state.taskSubmit.lastCreateSignature = signature;
    state.taskSubmit.lastCreateAt = Date.now();
}

function isTaskCreateSpam(signature) {
    if (!signature) return false;
    const lastSignature = String(state.taskSubmit.lastCreateSignature || '');
    const lastCreateAt = Number(state.taskSubmit.lastCreateAt || 0);
    if (!lastSignature || !lastCreateAt) return false;
    const elapsed = Date.now() - lastCreateAt;
    return signature === lastSignature && elapsed >= 0 && elapsed < TASK_CREATE_SPAM_WINDOW_MS;
}

function normalizeIsoTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString();
}

function shouldUpdateRemoteProject(remoteProject, payload) {
    const remoteName = sanitizeText(remoteProject && remoteProject.name, 80) || 'Untitled Project';
    const remoteDescription = typeof (remoteProject && remoteProject.description) === 'string'
        ? remoteProject.description
        : '';
    const nextDescription = typeof payload.description === 'string' ? payload.description : '';
    return remoteName !== payload.name || remoteDescription !== nextDescription;
}

function shouldUpdateRemoteTask(remoteTask, payload) {
    const remoteTitle = sanitizeText(remoteTask && remoteTask.title, 120) || 'Untitled Task';
    const remoteDescription = typeof (remoteTask && remoteTask.description) === 'string'
        ? remoteTask.description
        : '';
    const remotePriority = typeof (remoteTask && remoteTask.priority) === 'string'
        ? remoteTask.priority
        : '';
    const remoteStatus = typeof (remoteTask && remoteTask.status) === 'string'
        ? remoteTask.status
        : '';
    const remoteStartAt = normalizeIsoTimestamp(remoteTask && remoteTask.startAt);
    const payloadStartAt = normalizeIsoTimestamp(payload.startAt);
    const remoteDueAt = normalizeIsoTimestamp(remoteTask && remoteTask.dueAt);
    const payloadDueAt = normalizeIsoTimestamp(payload.dueAt);
    const remoteAllDay = Boolean(remoteTask && remoteTask.allDay);
    const payloadAllDay = Boolean(payload.allDay);
    const remoteEstimatedMinutes = Number(
        remoteTask && remoteTask.estimatedMinutes !== undefined
            ? remoteTask.estimatedMinutes
            : NaN
    );
    const payloadEstimatedMinutes = Number(
        payload && payload.estimatedMinutes !== undefined
            ? payload.estimatedMinutes
            : NaN
    );
    const remoteAssigneeUserId = isUuid(remoteTask && remoteTask.assigneeUserId)
        ? remoteTask.assigneeUserId
        : '';
    const payloadAssigneeUserId = isUuid(payload && payload.assigneeUserId)
        ? payload.assigneeUserId
        : '';

    if (remoteTitle !== payload.title) return true;
    if (remoteDescription !== (payload.description || '')) return true;
    if (remotePriority !== String(payload.priority || '')) return true;
    if (remoteStatus !== String(payload.status || '')) return true;
    if (remoteStartAt !== payloadStartAt) return true;
    if (remoteDueAt !== payloadDueAt) return true;
    if (remoteAllDay !== payloadAllDay) return true;
    if (
        Number.isFinite(remoteEstimatedMinutes) &&
        Number.isFinite(payloadEstimatedMinutes) &&
        remoteEstimatedMinutes !== payloadEstimatedMinutes
    ) {
        return true;
    }
    if (remoteAssigneeUserId !== payloadAssigneeUserId) return true;

    if (typeof payload.columnId === 'string' && payload.columnId) {
        const remoteColumnId = typeof (remoteTask && remoteTask.columnId) === 'string'
            ? remoteTask.columnId
            : '';
        if (remoteColumnId !== payload.columnId) return true;
    }

    return false;
}

function resolveRemoteSyncErrorMessage(error) {
    if (error && typeof error === 'object') {
        const status = Number(error.status || 0);
        const code = normalizeErrorCode(readErrorCodeFromError(error));
        const message = typeof error.message === 'string' ? error.message.trim() : '';
        const normalizedMessage = message.toUpperCase();
        if (SESSION_ERROR_CODES.has(code)) {
            return 'Session expired. Please sign in again to save data to database.';
        }
        if (
            code === 'AUTH_UPSTREAM_UNAVAILABLE' ||
            normalizedMessage.includes('AUTHENTICATION UPSTREAM UNAVAILABLE')
        ) {
            return 'Sync is temporarily delayed. Changes will retry automatically.';
        }
        if (status === 403) {
            return 'You do not have permission to sync some workspace changes.';
        }
        if (message) {
            return message;
        }
    }
    return 'Unable to sync changes to database. Please check backend connection and try again.';
}

function notifyRemoteSyncError(error) {
    const message = resolveRemoteSyncErrorMessage(error);
    const code = normalizeErrorCode(readErrorCodeFromError(error));
    const status = Number(error && typeof error === 'object' ? error.status || 0 : 0);
    const rawMessage =
        error && typeof error === 'object' && typeof error.message === 'string'
            ? error.message.toUpperCase()
            : '';
    const isUpstreamTemporaryError =
        code === 'AUTH_UPSTREAM_UNAVAILABLE' ||
        rawMessage.includes('AUTHENTICATION UPSTREAM UNAVAILABLE') ||
        status === 503;
    const now = Date.now();
    const shouldThrottle =
        state.remoteSync.lastErrorMessage === message &&
        now - state.remoteSync.lastErrorAt < 8000;

    if (shouldThrottle) return;

    state.remoteSync.lastErrorAt = now;
    state.remoteSync.lastErrorMessage = message;
    if (isUpstreamTemporaryError) {
        showSyncToast(message, false);
        return;
    }
    showErrorToast(message, 'Sync Failed');
}

function clearRemoteSyncErrorState() {
    state.remoteSync.lastErrorAt = 0;
    state.remoteSync.lastErrorMessage = '';
}

function buildProjectsSnapshot(sourceProjects = state.projects) {
    const projects = Array.isArray(sourceProjects) ? sourceProjects : [];
    const sanitizedProjects = projects.map((project, index) => sanitizeProject(project, index));
    return {
        version: 2,
        savedAt: Date.now(),
        projects: normalizeProjectsCollection(sanitizedProjects)
    };
}

function writeProjectsSnapshot(storageKey, sourceProjects = state.projects) {
    const snapshot = buildProjectsSnapshot(sourceProjects);
    try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
        return snapshot;
    } catch (error) {
        console.warn(`Unable to store project snapshot (${storageKey}):`, error);
        return null;
    }
}

function readProjectsSnapshot(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (typeof raw !== 'string') return null;
        const parsed = safeParseJSON(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const projectsRaw = Array.isArray(parsed.projects) ? parsed.projects : [];
        return {
            projects: normalizeProjectsCollection(projectsRaw.map((project, index) => sanitizeProject(project, index))),
            savedAt: Number(parsed.savedAt) || 0
        };
    } catch (error) {
        console.warn(`Unable to read project snapshot (${storageKey}):`, error);
        return null;
    }
}

function clearProjectsSnapshot(storageKey) {
    try {
        localStorage.removeItem(storageKey);
    } catch (error) {
        console.warn(`Unable to clear project snapshot (${storageKey}):`, error);
    }
}

function hasRemoteLoadedInSession() {
    if (sessionSync && typeof sessionSync.isFresh === 'function') {
        return sessionSync.isFresh(DASHBOARD_SYNC_RESOURCE_KEY, REMOTE_REVALIDATE_MAX_AGE_MS);
    }
    return false;
}

function markRemoteLoadedInSession() {
    if (sessionSync && typeof sessionSync.markFresh === 'function') {
        sessionSync.markFresh(DASHBOARD_SYNC_RESOURCE_KEY);
    }
}

function clearDashboardRemoteFreshness() {
    if (sessionSync && typeof sessionSync.invalidate === 'function') {
        sessionSync.invalidate(DASHBOARD_SYNC_RESOURCE_KEY);
    }
}

function writeLastSyncedAt(timestampMs) {
    const safeTimestamp = Number(timestampMs);
    if (!Number.isFinite(safeTimestamp) || safeTimestamp <= 0) return;
    try {
        sessionStorage.setItem(DASHBOARD_LAST_SYNC_AT_KEY, String(Math.floor(safeTimestamp)));
    } catch (_) {
        // no-op for storage-restricted environments
    }
}

function readLastSyncedAt() {
    try {
        const raw = sessionStorage.getItem(DASHBOARD_LAST_SYNC_AT_KEY);
        const ts = Number(raw);
        return Number.isFinite(ts) && ts > 0 ? ts : 0;
    } catch (_) {
        return 0;
    }
}

function resolveApiBase() {
    const fallback = '/api/v1';
    const candidate = window.OrbitTaskApi && typeof window.OrbitTaskApi.apiBase === 'string'
        ? window.OrbitTaskApi.apiBase.trim()
        : fallback;
    return candidate.replace(/\/+$/, '') || fallback;
}

function updateProfileConnectionDot() {
    const dot = document.getElementById('profileConnectionDot');
    if (!dot) return;
    const connected = state.connection.status === 'connected';
    dot.classList.toggle('connected', connected);
    dot.classList.toggle('disconnected', !connected);
}

function setConnectionStatus(status) {
    const next = status === 'connected' ? 'connected' : 'offline';
    if (state.connection.status === next) return;
    state.connection.status = next;
    updateProfileConnectionDot();
}

function clearConnectionProbeTimer() {
    if (state.connection.timer) {
        clearTimeout(state.connection.timer);
        state.connection.timer = null;
    }
}

function scheduleConnectionProbe(immediate = false) {
    clearConnectionProbeTimer();
    const delay = immediate
        ? 0
        : (document.visibilityState === 'visible'
            ? CONNECTION_PROBE_VISIBLE_MS
            : CONNECTION_PROBE_HIDDEN_MS);
    state.connection.timer = setTimeout(() => {
        state.connection.timer = null;
        void probeServerConnection();
    }, delay);
}

async function probeServerConnection() {
    if (state.connection.inFlight) return;
    state.connection.inFlight = true;
    try {
        const endpoint = `${resolveApiBase()}/health/ready`;
        const response = await fetch(endpoint, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
        });
        setConnectionStatus(response.ok ? 'connected' : 'offline');
    } catch (_) {
        setConnectionStatus('offline');
    } finally {
        state.connection.inFlight = false;
        scheduleConnectionProbe(false);
    }
}

function scheduleFilteredLayout() {
    if (state.filters.debounceTimer) {
        clearTimeout(state.filters.debounceTimer);
    }
    state.filters.debounceTimer = setTimeout(() => {
        state.filters.debounceTimer = null;
        layoutAllTasks();
    }, FILTER_DEBOUNCE_MS);
}

function showSyncToast(message, isError = false) {
    const text = sanitizeText(String(message || ''), 180);
    if (!text) return;

    let toast = document.getElementById('syncToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'syncToast';
        toast.className = 'sync-toast';
        document.body.appendChild(toast);
    }

    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');

    if (toast._hideTimer) {
        clearTimeout(toast._hideTimer);
    }
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2400);
}

function clearPendingSyncRetryTimer() {
    if (state.remoteSync.retryTimer) {
        clearTimeout(state.remoteSync.retryTimer);
        state.remoteSync.retryTimer = null;
    }
}

function schedulePendingSyncRetry() {
    if (!state.remoteSync.hasPendingSnapshot) return;
    if (state.remoteSync.retryTimer) return;

    state.remoteSync.retryTimer = setTimeout(() => {
        state.remoteSync.retryTimer = null;
        if (!state.remoteSync.hasPendingSnapshot) return;
        queueRemoteSync(true);
        schedulePendingSyncRetry();
    }, SYNC_RETRY_INTERVAL_MS);
}

function persistLocalProjectsSnapshot(sourceProjects = state.projects) {
    writeProjectsSnapshot(PROJECTS_CACHE_STORAGE_KEY, sourceProjects);
}

function stagePendingSyncSnapshot(sourceProjects = state.projects) {
    const snapshot = writeProjectsSnapshot(PENDING_SYNC_STORAGE_KEY, sourceProjects);
    state.remoteSync.hasPendingSnapshot = true;
    if (!snapshot) {
        console.warn('Pending sync snapshot was not persisted. Keeping retry loop with in-memory state.');
    }
    schedulePendingSyncRetry();
}

function clearPendingSyncSnapshot() {
    state.remoteSync.hasPendingSnapshot = false;
    clearPendingSyncRetryTimer();
    clearProjectsSnapshot(PENDING_SYNC_STORAGE_KEY);
}

function saveState(options = {}) {
    if (state.remoteSync.hydrating) return;
    persistLocalProjectsSnapshot();

    if (state.remoteSync.hasPendingSnapshot) {
        stagePendingSyncSnapshot();
    }

    if (options.skipRemoteSync) return;
    queueRemoteSync(options.immediate === true);
}

function loadStateFromLocalCache() {
    const pendingSnapshot = readProjectsSnapshot(PENDING_SYNC_STORAGE_KEY);
    if (pendingSnapshot) {
        state.remoteSync.hasPendingSnapshot = true;
        state.projects = pendingSnapshot.projects;
        assignMissingWorkspaceIds();
        hydrateProjectAccessMetadata();
        schedulePendingSyncRetry();
        return { hadSavedData: true, hasPendingSync: true };
    }

    clearPendingSyncSnapshot();
    const localSnapshot = readProjectsSnapshot(PROJECTS_CACHE_STORAGE_KEY);
    if (localSnapshot) {
        state.projects = localSnapshot.projects;
        assignMissingWorkspaceIds();
        hydrateProjectAccessMetadata();
        return { hadSavedData: true, hasPendingSync: false };
    }

    state.projects = [];
    return { hadSavedData: false, hasPendingSync: false };
}

function applyActiveWorkspace(workspaceId) {
    if (!isUuid(workspaceId)) return '';
    state.remoteSync.workspaceId = workspaceId;
    window.__ORBIT_ACTIVE_WORKSPACE_ID = workspaceId;
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
    const selector = document.getElementById('orbitWorkspaceSelector');
    if (selector && selector.tagName === 'SELECT' && selector.value !== workspaceId) {
        selector.value = workspaceId;
    }
    if (realtimeSync && typeof realtimeSync.setWorkspaceId === 'function') {
        realtimeSync.setWorkspaceId(workspaceId);
    }
    return workspaceId;
}

async function resolveAccessibleWorkspaces(taskApi) {
    const hintedWorkspace = [
        state.remoteSync.workspaceId,
        window.__ORBIT_ACTIVE_WORKSPACE_ID,
        localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || ''
    ].find((value) => isUuid(value));

    const workspacesResponse = await taskApi.listWorkspaces(1, 100);
    let workspaces = Array.isArray(workspacesResponse && workspacesResponse.data)
        ? workspacesResponse.data
        : [];
    if (workspaces.length === 0) {
        const createdWorkspace = await taskApi.ensureWorkspace('My Workspace');
        workspaces = createdWorkspace && isUuid(createdWorkspace.id) ? [createdWorkspace] : [];
    }

    const normalizedWorkspaces = workspaces.filter((workspace) => isUuid(workspace && workspace.id));
    if (normalizedWorkspaces.length === 0) {
        return [];
    }

    const selectedWorkspace = normalizedWorkspaces.find((workspace) => workspace.id === hintedWorkspace)
        || normalizedWorkspaces[0];
    if (!selectedWorkspace || !isUuid(selectedWorkspace.id)) {
        return normalizedWorkspaces;
    }
    applyActiveWorkspace(selectedWorkspace.id);
    return normalizedWorkspaces;
}

function resolveProjectWorkspaceId(project, availableWorkspaceIds = []) {
    const projectWorkspaceId = getProjectWorkspaceId(project);
    if (projectWorkspaceId && availableWorkspaceIds.includes(projectWorkspaceId)) {
        return projectWorkspaceId;
    }
    const fallbackWorkspaceId = resolveDefaultWorkspaceId();
    if (fallbackWorkspaceId && availableWorkspaceIds.includes(fallbackWorkspaceId)) {
        return fallbackWorkspaceId;
    }
    return availableWorkspaceIds[0] || '';
}

async function loadStateFromRemote(options = {}) {
    if (!hasTaskApiClient()) return null;
    if (!window.OrbitTaskApi.getToken()) return null;

    try {
        const workspaces = await resolveAccessibleWorkspaces(window.OrbitTaskApi);
        const workspaceIds = workspaces.map((workspace) => workspace.id).filter((id) => isUuid(id));
        if (workspaceIds.length === 0) return null;

        const preferredWorkspaceId =
            state.remoteSync.workspaceId && isUuid(state.remoteSync.workspaceId)
                ? state.remoteSync.workspaceId
                : (workspaceIds[0] || '');
        const nextWorkspaceDisplaySettings = {};

        const mappedProjects = await mapWithConcurrency(
            workspaces,
            REMOTE_WORKSPACE_LOAD_CONCURRENCY,
            async (workspace, workspaceIndex) => {
                const workspaceId = workspace && typeof workspace.id === 'string' ? workspace.id : '';
                if (!isUuid(workspaceId)) {
                    return null;
                }

                try {
                    const workspaceSettings = normalizeWorkspaceSettingsRecord(
                        workspace && typeof workspace.settings === 'object' ? workspace.settings : {}
                    );
                    nextWorkspaceDisplaySettings[workspaceId] = workspaceSettings;
                    const [board, calendar, membersResponse] = await Promise.all([
                        window.OrbitTaskApi.getWorkspaceBoard(workspaceId, { workspaceId }),
                        window.OrbitTaskApi.getWorkspaceCalendar(
                            workspaceId,
                            undefined,
                            undefined,
                            { workspaceId }
                        ),
                        window.OrbitTaskApi
                            .listWorkspaceMembers(workspaceId, { workspaceId })
                            .catch(() => []),
                    ]);

                    const calendarTasks = calendar && Array.isArray(calendar.tasks) ? calendar.tasks : [];
                    const tasksSource = calendarTasks.length > 0 ? calendarTasks : flattenBoardTasks(board);
                    const tasks = tasksSource.map((task, taskIndex) => mapRemoteTaskToLocal(task, taskIndex));

                    const remoteMembers = Array.isArray(membersResponse)
                        ? membersResponse.map((member, memberIndex) => sanitizeMember({
                            userId: typeof (member && member.userId) === 'string' ? member.userId : '',
                            role: typeof (member && member.role) === 'string' ? member.role : '',
                            name: resolveMemberDisplay(member),
                            user: member && typeof member.user === 'object' ? member.user : {},
                            color: deterministicColorFromUserId(
                                typeof (member && member.userId) === 'string' ? member.userId : `${memberIndex}`
                            ),
                        }, memberIndex))
                        : [];

                    return sanitizeProject({
                        id: workspaceId,
                        name: sanitizeText(workspace && workspace.name, 80) || `Workspace ${workspaceIndex + 1}`,
                        avatarInitial: '',
                        active: workspaceId === preferredWorkspaceId,
                        background: '',
                        starred: false,
                        ownerUserId: typeof (workspace && workspace.ownerUserId) === 'string' ? workspace.ownerUserId : '',
                        workspaceId,
                        visibility: 'WORKSPACE',
                        settings: workspaceSettings,
                        startDate: workspaceSettings.startDate,
                        endDate: workspaceSettings.endDate,
                        hourFormat: workspaceSettings.hourFormat,
                        showWeekends: workspaceSettings.showWeekends,
                        weekStart: workspaceSettings.weekStart,
                        defaultDurationHours: workspaceSettings.defaultDuration,
                        defaultView:
                            (calendar && calendar.project && String(calendar.project.defaultView || '').toUpperCase() === 'CALENDAR')
                                || (board && board.project && String(board.project.defaultView || '').toUpperCase() === 'CALENDAR')
                                ? 'CALENDAR'
                                : 'BOARD',
                        workspaceRole:
                            (calendar && calendar.project && calendar.project.workspaceRole) ||
                            (board && board.project && board.project.workspaceRole) ||
                            (workspace && workspace.role) ||
                            '',
                        projectRole: '',
                        members: remoteMembers,
                        tasks
                    }, workspaceIndex);
                } catch (workspaceError) {
                    console.warn('Unable to load workspace state:', workspaceId, workspaceError);
                    return null;
                }
            }
        );

        const normalizedProjects = normalizeProjectsCollection(
            mappedProjects.filter((project) => Boolean(project))
        );
        if (normalizedProjects.length === 0) {
            throw new Error('No workspace state available from remote');
        }
        state.workspaceDisplaySettings = nextWorkspaceDisplaySettings;

        if (!normalizedProjects.some((project) => project.active)) {
            const fallbackProject =
                normalizedProjects.find((project) => getProjectWorkspaceId(project) === preferredWorkspaceId)
                || normalizedProjects[0];
            normalizedProjects.forEach((project) => {
                project.active = project.id === fallbackProject.id;
            });
        }

        return normalizedProjects;
    } catch (error) {
        console.warn('Unable to load remote project state:', error);
        const silent = options && options.silent === true;
        if (!silent) {
            showErrorToast('Unable to load workspaces from server. Please refresh or try again.', 'Load Failed');
        }
        return null;
    }
}

function applyRemoteProjectsSnapshot(remoteProjects, options = {}) {
    const preserveActiveProjectId = typeof options.preserveActiveProjectId === 'string'
        ? options.preserveActiveProjectId
        : '';
    const previousActiveProjectId =
        preserveActiveProjectId || (state.projects.find((project) => project.active) || {}).id || '';

    state.remoteSync.hydrating = true;
    state.projects = normalizeProjectsCollection(remoteProjects);
    assignMissingWorkspaceIds();
    hydrateProjectAccessMetadata();
    restoreActiveProjectById(previousActiveProjectId);

    const activeProject = getActiveProject();
    const activeWorkspaceId = getProjectWorkspaceId(activeProject);
    if (activeWorkspaceId) {
        applyActiveWorkspace(activeWorkspaceId);
    }

    state.remoteSync.hydrating = false;
    clearPendingSyncSnapshot();
    persistLocalProjectsSnapshot();
    markRemoteLoadedInSession();
    writeLastSyncedAt(Date.now());
}

async function refreshRemoteProjects(options = {}) {
    const remoteProjects = await loadStateFromRemote(options);
    if (!Array.isArray(remoteProjects)) {
        return false;
    }
    applyRemoteProjectsSnapshot(remoteProjects, options);
    return true;
}

function queueRealtimeInvalidateRefresh() {
    if (state.authFailures.locked) {
        return;
    }

    state.realtimeInvalidate.pending = true;
    if (state.realtimeInvalidate.timer) {
        clearTimeout(state.realtimeInvalidate.timer);
    }

    state.realtimeInvalidate.timer = setTimeout(async () => {
        state.realtimeInvalidate.timer = null;

        if (state.realtimeInvalidate.inFlight) {
            return;
        }

        state.realtimeInvalidate.pending = false;
        state.realtimeInvalidate.inFlight = true;
        try {
            await refreshRemoteProjects({
                silent: true,
                preserveActiveProjectId: (getActiveProject() || {}).id || ''
            });
        } finally {
            state.realtimeInvalidate.inFlight = false;
            if (state.realtimeInvalidate.pending) {
                queueRealtimeInvalidateRefresh();
            }
        }
    }, REALTIME_INVALIDATE_DEBOUNCE_MS);
}

function clearRealtimeTaskFallbackTimer() {
    if (state.realtimeInvalidate.taskFallbackTimer) {
        clearTimeout(state.realtimeInvalidate.taskFallbackTimer);
        state.realtimeInvalidate.taskFallbackTimer = null;
    }
}

function queueTaskInvalidateFallbackRefresh() {
    if (state.authFailures.locked) {
        return;
    }
    if (state.realtimeInvalidate.taskFallbackTimer) {
        return;
    }
    state.realtimeInvalidate.taskFallbackTimer = setTimeout(() => {
        state.realtimeInvalidate.taskFallbackTimer = null;
        if (state.authFailures.locked) {
            return;
        }
        const elapsedSinceTaskDelta = Date.now() - Number(state.realtimeInvalidate.lastTaskDeltaAt || 0);
        if (elapsedSinceTaskDelta <= REALTIME_TASK_INVALIDATE_RECENT_DELTA_MS) {
            return;
        }
        queueRealtimeInvalidateRefresh();
    }, REALTIME_TASK_INVALIDATE_FALLBACK_MS);
}

function normalizeTaskDeltaPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const workspaceId = isUuid(payload.workspaceId) ? payload.workspaceId : '';
    const taskId = typeof payload.taskId === 'string' ? payload.taskId.trim() : '';
    const operationRaw = typeof payload.operation === 'string' ? payload.operation.trim().toLowerCase() : '';
    const operation = ['create', 'update', 'move', 'delete'].includes(operationRaw)
        ? operationRaw
        : '';
    const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
    const taskPatch =
        payload.taskPatch && typeof payload.taskPatch === 'object' && !Array.isArray(payload.taskPatch)
            ? payload.taskPatch
            : null;

    if (!workspaceId || !taskId || !operation) {
        return null;
    }

    return {
        workspaceId,
        taskId,
        operation,
        projectId,
        taskPatch
    };
}

function applyWorkspaceTaskDelta(payload) {
    const delta = normalizeTaskDeltaPayload(payload);
    if (!delta) {
        return false;
    }

    const project = state.projects.find((entry) => {
        const workspaceId = getProjectWorkspaceId(entry) || (isUuid(entry && entry.id) ? entry.id : '');
        return workspaceId === delta.workspaceId;
    });
    if (!project || !Array.isArray(project.tasks)) {
        return false;
    }

    const existingIndex = project.tasks.findIndex((task) => task && task.id === delta.taskId);
    let changed = false;

    if (delta.operation === 'delete') {
        if (existingIndex >= 0) {
            project.tasks.splice(existingIndex, 1);
            changed = true;
        }
    } else {
        const hasPatchObject =
            delta.taskPatch && typeof delta.taskPatch === 'object' && !Array.isArray(delta.taskPatch);
        if (!hasPatchObject) {
            return false;
        }

        const patch = { ...delta.taskPatch };
        const hasPatchData = [
            'title',
            'status',
            'priority',
            'description',
            'startAt',
            'dueAt',
            'assigneeUserId'
        ].some((key) => key in patch);
        if (!hasPatchData) {
            return false;
        }

        if (!patch.id) {
            patch.id = delta.taskId;
        }
        if (!patch.projectId && delta.projectId) {
            patch.projectId = delta.projectId;
        }

        const normalizedTask = mapRemoteTaskToLocal(patch, existingIndex >= 0 ? existingIndex : project.tasks.length);
        const nextTaskId = normalizedTask && typeof normalizedTask.id === 'string' ? normalizedTask.id : delta.taskId;
        const taskIndex = existingIndex >= 0
            ? existingIndex
            : project.tasks.findIndex((task) => task && task.id === nextTaskId);

        if (taskIndex >= 0) {
            project.tasks.splice(taskIndex, 1, normalizedTask);
        } else {
            project.tasks.push(normalizedTask);
        }
        changed = true;
    }

    if (!changed) {
        return false;
    }

    persistLocalProjectsSnapshot();
    const activeProject = getActiveProject();
    const activeWorkspaceId = getProjectWorkspaceId(activeProject);
    if ((activeProject && activeProject.id === project.id) || activeWorkspaceId === delta.workspaceId) {
        updateUIAfterProjectSwitch();
    }
    return true;
}

function connectRealtimeSync() {
    if (!realtimeSync || typeof realtimeSync.connect !== 'function') {
        return;
    }
    realtimeSync.connect({
        workspaceId: state.remoteSync.workspaceId,
        onInvalidate: (payload) => {
            const resource = payload && typeof payload === 'object' && typeof payload.resource === 'string'
                ? payload.resource.trim().toLowerCase()
                : '';
            if (resource === 'tasks') {
                queueRealtimeInvalidateRefresh();
                queueTaskInvalidateFallbackRefresh();
                return;
            }
            queueRealtimeInvalidateRefresh();
        },
        onTaskDelta: (payload) => {
            const applied = applyWorkspaceTaskDelta(payload);
            if (applied) {
                state.realtimeInvalidate.lastTaskDeltaAt = Date.now();
                clearRealtimeTaskFallbackTimer();
                return;
            }
            queueRealtimeInvalidateRefresh();
        },
        onAuthFailure: (detail) => {
            if (isSessionAuthFailure(detail)) {
                registerSessionAuthFailure(detail);
            }
        }
    });
}

function normalizeWorkspaceDefaultDuration(value, fallback = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return clamp(Number(fallback) || 2, 0.5, 12);
    }
    return clamp(numeric, 0.5, 12);
}

function normalizeWorkspaceHourFormat(value, fallback = '24') {
    return String(value || '') === '12' ? '12' : (fallback === '12' ? '12' : '24');
}

function normalizeWorkspaceWeekStart(value, fallback = 'mon') {
    return String(value || '') === 'sun' ? 'sun' : (fallback === 'sun' ? 'sun' : 'mon');
}

function normalizeWorkspaceShowWeekends(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (value === '0' || value === 0 || value === 'false') return false;
    if (value === '1' || value === 1 || value === 'true') return true;
    return Boolean(fallback);
}

function normalizeWorkspaceDate(value) {
    return isISODate(value) ? String(value) : '';
}

function normalizeWorkspaceSettingsRecord(source = {}, fallback = {}) {
    const record = source && typeof source === 'object' ? source : {};
    const fallbackRecord = fallback && typeof fallback === 'object' ? fallback : {};
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(record, key);
    return {
        startDate: normalizeWorkspaceDate(
            hasOwn('startDate') ? record.startDate : (fallbackRecord.startDate || '')
        ),
        endDate: normalizeWorkspaceDate(
            hasOwn('endDate') ? record.endDate : (fallbackRecord.endDate || '')
        ),
        hourFormat: normalizeWorkspaceHourFormat(
            record.hourFormat !== undefined ? record.hourFormat : fallbackRecord.hourFormat,
            '24'
        ),
        showWeekends: normalizeWorkspaceShowWeekends(
            record.showWeekends !== undefined ? record.showWeekends : fallbackRecord.showWeekends,
            true
        ),
        weekStart: normalizeWorkspaceWeekStart(
            record.weekStart !== undefined ? record.weekStart : fallbackRecord.weekStart,
            'mon'
        ),
        defaultDuration: normalizeWorkspaceDefaultDuration(
            record.defaultDurationHours !== undefined
                ? record.defaultDurationHours
                : (
                    record.defaultDuration !== undefined
                        ? record.defaultDuration
                        : (
                            fallbackRecord.defaultDurationHours !== undefined
                                ? fallbackRecord.defaultDurationHours
                                : fallbackRecord.defaultDuration
                        )
                ),
            2
        ),
    };
}

function readWorkspaceDisplaySettings() {
    return {};
}

function persistWorkspaceDisplaySettings() {
    return undefined;
}

function getProjectTimelineStartDate(project) {
    const workspaceId = getProjectWorkspaceId(project);
    const fromWorkspace =
        workspaceId &&
        state.workspaceDisplaySettings &&
        state.workspaceDisplaySettings[workspaceId] &&
        typeof state.workspaceDisplaySettings[workspaceId] === 'object'
            ? state.workspaceDisplaySettings[workspaceId].startDate
            : '';
    const fromProject = project && isISODate(project.startDate)
        ? project.startDate
        : '';
    const fallback = isISODate(state.settings?.timeline?.startDate) ? state.settings.timeline.startDate : '';
    return normalizeWorkspaceDate(fromWorkspace || fromProject || fallback);
}

function getProjectTimelineEndDate(project) {
    const workspaceId = getProjectWorkspaceId(project);
    const fromWorkspace =
        workspaceId &&
        state.workspaceDisplaySettings &&
        state.workspaceDisplaySettings[workspaceId] &&
        typeof state.workspaceDisplaySettings[workspaceId] === 'object'
            ? state.workspaceDisplaySettings[workspaceId].endDate
            : '';
    const fromProject = project && isISODate(project.endDate)
        ? project.endDate
        : '';
    const fallback = isISODate(state.settings?.timeline?.endDate) ? state.settings.timeline.endDate : '';
    return normalizeWorkspaceDate(fromWorkspace || fromProject || fallback);
}

function getProjectHourFormat(project) {
    const workspaceId = getProjectWorkspaceId(project);
    const fromWorkspace =
        workspaceId &&
        state.workspaceDisplaySettings &&
        state.workspaceDisplaySettings[workspaceId] &&
        typeof state.workspaceDisplaySettings[workspaceId] === 'object'
            ? state.workspaceDisplaySettings[workspaceId].hourFormat
            : '';
    const fromProject = project && typeof project.hourFormat === 'string'
        ? project.hourFormat
        : '';
    const fallback = state.settings?.timeline?.hourFormat === '12' ? '12' : '24';
    return normalizeWorkspaceHourFormat(fromWorkspace || fromProject, fallback);
}

function getProjectShowWeekends(project) {
    const workspaceId = getProjectWorkspaceId(project);
    const fromWorkspace =
        workspaceId &&
        state.workspaceDisplaySettings &&
        state.workspaceDisplaySettings[workspaceId] &&
        typeof state.workspaceDisplaySettings[workspaceId] === 'object'
            ? state.workspaceDisplaySettings[workspaceId].showWeekends
            : null;
    const fromProject = project && typeof project.showWeekends === 'boolean'
        ? project.showWeekends
        : null;
    const fallback = typeof state.settings?.timeline?.showWeekends === 'boolean'
        ? state.settings.timeline.showWeekends
        : true;
    return normalizeWorkspaceShowWeekends(
        fromWorkspace !== null && fromWorkspace !== undefined ? fromWorkspace : fromProject,
        fallback
    );
}

function getProjectWeekStart(project) {
    const workspaceId = getProjectWorkspaceId(project);
    const fromWorkspace =
        workspaceId &&
        state.workspaceDisplaySettings &&
        state.workspaceDisplaySettings[workspaceId] &&
        typeof state.workspaceDisplaySettings[workspaceId] === 'object'
            ? state.workspaceDisplaySettings[workspaceId].weekStart
            : '';
    const fromProject = project && typeof project.weekStart === 'string'
        ? project.weekStart
        : '';
    const fallback = state.settings?.timeline?.weekStart === 'sun' ? 'sun' : 'mon';
    return normalizeWorkspaceWeekStart(fromWorkspace || fromProject, fallback);
}

function getProjectDefaultDurationHours(project) {
    const workspaceId = getProjectWorkspaceId(project);
    const fromWorkspace =
        workspaceId &&
        state.workspaceDisplaySettings &&
        state.workspaceDisplaySettings[workspaceId] &&
        typeof state.workspaceDisplaySettings[workspaceId] === 'object'
            ? state.workspaceDisplaySettings[workspaceId].defaultDuration
            : null;
    const fromProject = project && Number.isFinite(Number(project.defaultDurationHours))
        ? Number(project.defaultDurationHours)
        : null;
    const fallback = state.settings?.timeline?.defaultDuration || 2;
    return normalizeWorkspaceDefaultDuration(
        fromWorkspace !== null && fromWorkspace !== undefined ? fromWorkspace : fromProject,
        fallback
    );
}

function setProjectWorkspaceDisplaySettings(project, patch = {}) {
    if (!project || typeof project !== 'object') return;
    const normalizedStartDate = normalizeWorkspaceDate(
        patch.startDate !== undefined ? patch.startDate : getProjectTimelineStartDate(project)
    );
    const normalizedEndDate = normalizeWorkspaceDate(
        patch.endDate !== undefined ? patch.endDate : getProjectTimelineEndDate(project)
    );
    const normalizedHourFormat = normalizeWorkspaceHourFormat(
        patch.hourFormat !== undefined ? patch.hourFormat : getProjectHourFormat(project),
        state.settings?.timeline?.hourFormat === '12' ? '12' : '24'
    );
    const normalizedShowWeekends = normalizeWorkspaceShowWeekends(
        patch.showWeekends !== undefined ? patch.showWeekends : getProjectShowWeekends(project),
        typeof state.settings?.timeline?.showWeekends === 'boolean' ? state.settings.timeline.showWeekends : true
    );
    const normalizedWeekStart = normalizeWorkspaceWeekStart(
        patch.weekStart !== undefined ? patch.weekStart : getProjectWeekStart(project),
        state.settings?.timeline?.weekStart === 'sun' ? 'sun' : 'mon'
    );
    const normalizedDefaultDuration = normalizeWorkspaceDefaultDuration(
        patch.defaultDuration !== undefined ? patch.defaultDuration : getProjectDefaultDurationHours(project),
        state.settings?.timeline?.defaultDuration || 2
    );
    project.startDate = normalizedStartDate;
    project.endDate = normalizedEndDate;
    project.hourFormat = normalizedHourFormat;
    project.showWeekends = normalizedShowWeekends;
    project.weekStart = normalizedWeekStart;
    project.defaultDurationHours = normalizedDefaultDuration;
    const workspaceId = getProjectWorkspaceId(project);
    if (workspaceId) {
        const currentRow = state.workspaceDisplaySettings[workspaceId] || {};
        state.workspaceDisplaySettings[workspaceId] = {
            ...currentRow,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
            hourFormat: normalizedHourFormat,
            showWeekends: normalizedShowWeekends,
            weekStart: normalizedWeekStart,
            defaultDuration: normalizedDefaultDuration,
        };
        persistWorkspaceDisplaySettings();
    }
}

async function syncProjectTasks(project) {
    const workspaceId = getProjectWorkspaceId(project) || (isUuid(project && project.id) ? project.id : '');
    if (!workspaceId) {
        return;
    }

    const board = await window.OrbitTaskApi.getWorkspaceBoard(workspaceId, { workspaceId });
    const columns = board && Array.isArray(board.columns) ? board.columns : [];
    const remoteTasks = flattenBoardTasks(board);
    const remoteById = new Map(remoteTasks.map((task) => [task.id, task]));
    const localTaskIds = new Set();

    for (const task of project.tasks) {
        const payload = buildRemoteTaskPayload(task, columns);
        const knownRemoteTask = isUuid(task.id) ? remoteById.get(task.id) : null;

        if (knownRemoteTask) {
            if (shouldUpdateRemoteTask(knownRemoteTask, payload)) {
                await window.OrbitTaskApi.updateTask(task.id, payload, { workspaceId });
            }
            localTaskIds.add(task.id);
            continue;
        }

        const created = await window.OrbitTaskApi.createWorkspaceTask(
            workspaceId,
            payload,
            {
                workspaceId,
                idempotencyKey: buildTaskCreateIdempotencyKey(task, workspaceId)
            }
        );
        if (created && typeof created.id === 'string') {
            task.id = created.id;
            localTaskIds.add(created.id);
        }
    }

    for (const remoteTask of remoteTasks) {
        if (!localTaskIds.has(remoteTask.id)) {
            await window.OrbitTaskApi.deleteTask(remoteTask.id, { workspaceId });
        }
    }
}

async function syncStateToRemote() {
    if (!hasTaskApiClient()) return;
    if (!window.OrbitTaskApi.getToken()) return;

    const workspaces = await resolveAccessibleWorkspaces(window.OrbitTaskApi);
    const workspaceIds = workspaces.map((workspace) => workspace.id).filter((id) => isUuid(id));
    if (workspaceIds.length === 0) return;
    const remoteWorkspaceById = new Map(
        workspaces
            .filter((workspace) => workspace && isUuid(workspace.id))
            .map((workspace) => [workspace.id, workspace])
    );
    const localWorkspaceById = new Map();
    state.projects.forEach((project) => {
        const workspaceId = getProjectWorkspaceId(project) || (isUuid(project && project.id) ? project.id : '');
        if (!workspaceId || !remoteWorkspaceById.has(workspaceId)) {
            return;
        }
        project.workspaceId = workspaceId;
        project.id = workspaceId;
        localWorkspaceById.set(workspaceId, project);
    });

    for (const workspaceId of workspaceIds) {
        const localWorkspace = localWorkspaceById.get(workspaceId);
        if (!localWorkspace) continue;

        const remoteWorkspace = remoteWorkspaceById.get(workspaceId);
        const desiredName = sanitizeText(localWorkspace.name, 80) || 'Untitled Workspace';
        const remoteName = sanitizeText(remoteWorkspace && remoteWorkspace.name, 80);
        if (
            desiredName &&
            remoteName &&
            desiredName !== remoteName &&
            typeof window.OrbitTaskApi.updateWorkspace === 'function'
        ) {
            await window.OrbitTaskApi.updateWorkspace(
                workspaceId,
                { name: desiredName },
                { workspaceId }
            );
        }

        await syncProjectTasks(localWorkspace);
    }

    persistLocalProjectsSnapshot();
}

async function flushRemoteSyncQueue() {
    if (state.remoteSync.syncing) {
        state.remoteSync.pending = true;
        return;
    }

    state.remoteSync.syncing = true;
    state.remoteSync.pending = false;
    try {
        await syncStateToRemote();
        clearPendingSyncSnapshot();
        clearRemoteSyncErrorState();
    } catch (error) {
        console.warn('Unable to sync project state to server:', error);
        stagePendingSyncSnapshot();
        notifyRemoteSyncError(error);
    } finally {
        state.remoteSync.syncing = false;
    }

    if (state.remoteSync.pending) {
        state.remoteSync.pending = false;
        await flushRemoteSyncQueue();
    }
}

function queueRemoteSync(immediate = false) {
    if (!hasTaskApiClient()) {
        if (state.remoteSync.hasPendingSnapshot) {
            schedulePendingSyncRetry();
        }
        return;
    }
    if (!window.OrbitTaskApi.getToken()) {
        if (state.remoteSync.hasPendingSnapshot) {
            schedulePendingSyncRetry();
        }
        return;
    }

    if (state.remoteSync.timer) {
        clearTimeout(state.remoteSync.timer);
        state.remoteSync.timer = null;
    }

    const delay = immediate ? 0 : SYNC_DEBOUNCE_MS;
    state.remoteSync.timer = setTimeout(() => {
        state.remoteSync.timer = null;
        void flushRemoteSyncQueue();
    }, delay);
}

async function loadState() {
    const localCacheState = loadStateFromLocalCache();
    const applyWorkspaceForActiveProject = () => {
        const activeProject = getActiveProject();
        const workspaceId = getProjectWorkspaceId(activeProject);
        if (workspaceId) {
            applyActiveWorkspace(workspaceId);
        }
    };
    if (localCacheState.hasPendingSync) {
        applyWorkspaceForActiveProject();
        queueRemoteSync(true);
        return;
    }

    const shouldUseLocalOnly =
        localCacheState.hadSavedData && hasRemoteLoadedInSession();
    if (shouldUseLocalOnly) {
        applyWorkspaceForActiveProject();
        return;
    }

    const remoteProjects = await loadStateFromRemote();
    if (Array.isArray(remoteProjects)) {
        applyRemoteProjectsSnapshot(remoteProjects);
        return;
    }

    if (!localCacheState.hadSavedData) {
        state.projects = [];
        clearDashboardRemoteFreshness();
        return;
    }
    applyWorkspaceForActiveProject();
}

function buildProjectListSignature(projects = []) {
    if (!Array.isArray(projects)) return '';
    return projects
        .map((project) => `${project.id}|${project.name}|${project.starred ? 1 : 0}`)
        .join('::');
}

function restoreActiveProjectById(projectId) {
    if (!projectId) return;
    const target = state.projects.find((project) => project.id === projectId);
    if (!target) return;
    state.projects.forEach((project) => {
        project.active = project.id === projectId;
    });
    const workspaceId = getProjectWorkspaceId(target);
    if (workspaceId) {
        applyActiveWorkspace(workspaceId);
    }
}

function loadBoardViewMode() {
    const raw = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw === 'board' ? 'board' : 'timeline';
}

function setBoardViewMode(mode, options = {}) {
    const persist = options.persist !== false;
    const skipLayout = options.skipLayout === true;
    const nextMode = mode === 'board' ? 'board' : 'timeline';
    state.viewMode = nextMode;

    const timelineWrapper = document.querySelector('.timeline-wrapper');
    const kanbanWrapper = document.getElementById('kanbanWrapper');
    const timelineViewBtn = document.getElementById('timelineViewBtn');
    const boardViewBtn = document.getElementById('boardViewBtn');

    if (timelineWrapper) {
        timelineWrapper.hidden = nextMode !== 'timeline';
        timelineWrapper.style.display = nextMode === 'timeline' ? 'flex' : 'none';
    }
    if (kanbanWrapper) {
        kanbanWrapper.hidden = nextMode !== 'board';
        kanbanWrapper.style.display = nextMode === 'board' ? 'flex' : 'none';
    }

    const activeWrapper = nextMode === 'board' ? kanbanWrapper : timelineWrapper;
    if (activeWrapper) {
        activeWrapper.classList.remove('view-animate');
        void activeWrapper.offsetWidth;
        activeWrapper.classList.add('view-animate');
    }

    if (timelineViewBtn) {
        timelineViewBtn.classList.toggle('active', nextMode === 'timeline');
        timelineViewBtn.setAttribute('aria-pressed', nextMode === 'timeline' ? 'true' : 'false');
    }
    if (boardViewBtn) {
        boardViewBtn.classList.toggle('active', nextMode === 'board');
        boardViewBtn.setAttribute('aria-pressed', nextMode === 'board' ? 'true' : 'false');
    }

    if (persist) localStorage.setItem(VIEW_MODE_STORAGE_KEY, nextMode);
    if (!skipLayout) layoutAllTasks();
}

function getActiveBoardWrapper() {
    if (state.viewMode === 'board') return document.getElementById('kanbanWrapper');
    return document.querySelector('.timeline-wrapper');
}

async function bootstrapProjectPage() {
    const auth = window.OrbitAuth;
    if (!auth) {
        window.location.href = routePath('/signin/');
        return;
    }
    const user = await auth.requireAuth('/signin/');
    if (!user) return;
    state.authFailures.locked = false;
    resetAuthFailureState();
    attachTaskAuthWatchers();
    const storedWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || '';
    if (isUuid(storedWorkspaceId)) {
        state.remoteSync.workspaceId = storedWorkspaceId;
        window.__ORBIT_ACTIVE_WORKSPACE_ID = storedWorkspaceId;
    }
    state.projectAccessIndex = readProjectAccessIndex();
    state.settings = loadBoardSettings();
    state.workspaceDisplaySettings = readWorkspaceDisplaySettings();
    state.viewMode = loadBoardViewMode();
    await loadState();
    const initialProject = getActiveProject();
    if (initialProject) {
        markProjectAccessed(initialProject.id);
    }
    initStarField();
    initPageTransitions();
    const sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    applySidebarCollapsedState(sidebarCollapsed, false);
    setMobileSidebarOpen(false);
    setupEventListeners();
    scheduleConnectionProbe(true);
    setBoardViewMode(state.viewMode, { persist: false, skipLayout: true });
    renderProjects();
    updateUIAfterProjectSwitch();
    connectRealtimeSync();

    const params = new URLSearchParams(window.location.search || '');
    const shouldOpenWorkspaceSettings = ['1', 'true', 'yes'].includes(
        String(params.get('openWorkspaceSettings') || '').trim().toLowerCase()
    );
    if (shouldOpenWorkspaceSettings) {
        params.delete('openWorkspaceSettings');
        const cleaned = params.toString();
        const nextUrl = cleaned
            ? `${window.location.pathname}?${cleaned}${window.location.hash}`
            : `${window.location.pathname}${window.location.hash}`;
        window.history.replaceState({}, '', nextUrl);
        await openWorkspaceSettingsModal();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrapProjectPage();
    }, { once: true });
} else {
    void bootstrapProjectPage();
}

function initStarField() {
    const starField = document.getElementById('starField');
    if (!starField) return;

    const stars = [];
    const NUM_STARS = 180;
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

    let localMouseX = window.innerWidth / 2;
    let localMouseY = window.innerHeight / 2;
    let curX = localMouseX;
    let curY = localMouseY;
    let scrollY = window.scrollY;

    document.addEventListener('mousemove', (e) => {
        localMouseX = e.clientX;
        localMouseY = e.clientY;
    }, { passive: true });

    document.addEventListener('scroll', () => {
        scrollY = window.scrollY;
    }, { passive: true });

    function animateStars() {
        curX += (localMouseX - curX) * 0.04;
        curY += (localMouseY - curY) * 0.04;
        const dx = curX - window.innerWidth / 2;
        const dy = curY - window.innerHeight / 2;

        for (const star of stars) {
            const offsetX = dx * star._factor;
            const offsetY = dy * star._factor - scrollY * star._factor * 0.5;
            star.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        }
        requestAnimationFrame(animateStars);
    }
    animateStars();
}

function isWeekendDate(dateISO) {
    const day = fromISODate(dateISO).getDay();
    return day === 0 || day === 6;
}

function formatHourTick(hour, hourFormat = '24') {
    if (hourFormat === '12') {
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const adjusted = hour % 12 === 0 ? 12 : hour % 12;
        return `${adjusted}:00 ${suffix}`;
    }
    return `${String(hour).padStart(2, '0')}:00`;
}

function getCurrentWeekStartDate(weekStart = 'mon') {
    const todayISO = getTodayISO();
    const today = fromISODate(todayISO);
    const dayOfWeek = today.getDay();
    const startOffset = weekStart === 'sun'
        ? dayOfWeek
        : (dayOfWeek + 6) % 7;

    const weekStartDate = fromISODate(todayISO);
    weekStartDate.setDate(weekStartDate.getDate() - startOffset);
    return weekStartDate;
}

function buildDateSpan(startDate, numberOfDays) {
    const safeDays = Math.max(1, Number(numberOfDays) || 1);
    const dates = [];
    for (let i = 0; i < safeDays; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(toISODate(d));
    }
    return dates;
}

function buildTimelineDatesForProject(project) {
    const weekStart = getProjectWeekStart(project);
    const showWeekends = getProjectShowWeekends(project);
    const configuredStartDate = getProjectTimelineStartDate(project);
    const configuredEndDate = getProjectTimelineEndDate(project);
    const dates = [];
    if (configuredStartDate && configuredEndDate) {
        const from = fromISODate(configuredStartDate);
        const to = fromISODate(configuredEndDate);
        if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
            const MAX_RANGE_DAYS = 62;
            const cursor = new Date(from);
            while (cursor <= to && dates.length < MAX_RANGE_DAYS) {
                dates.push(toISODate(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }
        }
    }

    if (dates.length === 0) {
        dates.push(...buildDateSpan(getCurrentWeekStartDate(weekStart), 7));
    }

    const visibleDates = showWeekends
        ? dates
        : dates.filter((dateISO) => !isWeekendDate(dateISO));

    const finalDates = visibleDates.length > 0
        ? visibleDates
        : buildDateSpan(getCurrentWeekStartDate(weekStart), 7);
    state.timelineLayout.weekDates = finalDates;
    return finalDates;
}

function getWeekdayLabel(dateISO) {
    const day = fromISODate(dateISO).getDay();
    const map = ['CN', 'THU 2', 'THU 3', 'THU 4', 'THU 5', 'THU 6', 'THU 7'];
    return map[day] || 'THU';
}

function applyTimelineRangeLayout(dayCount) {
    const safeDayCount = Math.max(1, Number(dayCount) || 1);
    const root = document.documentElement;
    root.style.setProperty('--timeline-day-count', String(safeDayCount));
    root.style.setProperty('--timeline-day-min-width', safeDayCount <= 7 ? '140px' : '110px');
    return safeDayCount > 7 ? 'RANGE' : 'WEEK';
}

function computeSlotStartTimeFromLaneClick(lane, event) {
    const rect = lane.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
        return getQuarterRoundedNowTime();
    }

    const clickY = clamp(event.clientY - rect.top, 0, rect.height);
    const minutesInDay = DAY_HOURS * 60;
    const rawMinutes = (clickY / rect.height) * minutesInDay;
    const snapMinutes = 15;
    const roundedMinutes = Math.round(rawMinutes / snapMinutes) * snapMinutes;
    const boundedMinutes = clamp(roundedMinutes, 0, minutesInDay - snapMinutes);
    return minutesToTime(boundedMinutes);
}

function buildTaskPrefillFromLaneClick(lane, event) {
    const startDate = isISODate(lane && lane.dataset && lane.dataset.date)
        ? lane.dataset.date
        : getTodayISO();
    const startTime = computeSlotStartTimeFromLaneClick(lane, event);
    const defaultDurationHours = getProjectDefaultDurationHours(getActiveProject());
    const { endDate, endTime } = computeEndDateTime(startDate, startTime, defaultDurationHours);
    return {
        startDate,
        startTime,
        endDate,
        endTime
    };
}

function initTimeline(taskDates = []) {
    const daysGrid = document.getElementById('daysGrid');
    const hoursScale = document.getElementById('hoursScale');
    const timelineRuler = document.querySelector('.timeline-ruler');
    const todayISO = getTodayISO();
    const activeProject = getActiveProject();

    if (!daysGrid || !hoursScale) return;

    daysGrid.innerHTML = '';
    hoursScale.innerHTML = '';
    if (timelineRuler) timelineRuler.innerHTML = '';

    document.documentElement.style.setProperty('--hour-height', `${state.hourWidth}px`);

    const allDates = buildTimelineDatesForProject(activeProject);
    const cornerLabel = applyTimelineRangeLayout(allDates.length);

    if (timelineRuler) {
        const corner = document.createElement('div');
        corner.className = 'timeline-corner';
        corner.textContent = cornerLabel;
        timelineRuler.appendChild(corner);

        const headerGrid = document.createElement('div');
        headerGrid.className = 'week-header-grid';

        allDates.forEach((dateISO) => {
            const dateObj = fromISODate(dateISO);
            const isToday = dateISO === todayISO;
            const headerCell = document.createElement('div');
            headerCell.className = isToday ? 'week-day-header today-header' : 'week-day-header';

            const dayName = document.createElement('div');
            dayName.className = 'day-name';
            dayName.textContent = getWeekdayLabel(dateISO);

            const dayNum = document.createElement('div');
            dayNum.className = 'day-num';
            dayNum.textContent = String(dateObj.getDate()).padStart(2, '0');

            headerCell.appendChild(dayName);
            headerCell.appendChild(dayNum);
            headerGrid.appendChild(headerCell);
        });

        timelineRuler.appendChild(headerGrid);
    }

    const weekBody = document.createElement('div');
    weekBody.className = 'week-body';

    const timeAxis = document.createElement('div');
    timeAxis.className = 'time-axis';
    const hourFormat = getProjectHourFormat(activeProject);
    for (let i = 0; i < DAY_HOURS; i++) {
        const h = document.createElement('div');
        h.className = 'hour-label';
        h.textContent = formatHourTick(i, hourFormat);
        timeAxis.appendChild(h);
    }

    const weekColumns = document.createElement('div');
    weekColumns.className = 'week-columns';
    allDates.forEach((dateISO) => {
        const isToday = dateISO === todayISO;
        const col = document.createElement('div');
        col.className = isToday ? 'week-day-column today-column' : 'week-day-column';

        const lane = document.createElement('div');
        lane.className = 'task-lane';
        lane.dataset.date = dateISO;
        lane.addEventListener('click', (event) => {
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.target.closest('.task-card')) return;

            const activeProject = getActiveProject();
            if (!activeProject) {
                showErrorToast('Please select a project before creating a task.', 'Task Error', { code: 'TASK_SAVE_RUNTIME' });
                return;
            }
            if (!canEditProjectTasks(activeProject)) {
                showErrorToast('You do not have permission to create tasks in this project.', 'Permission Denied', { code: 'TASK_SAVE_PERMISSION_DENIED' });
                return;
            }

            const prefill = buildTaskPrefillFromLaneClick(lane, event);
            openTaskModal(null, true, prefill);
        });

        col.appendChild(lane);
        weekColumns.appendChild(col);
    });

    weekBody.appendChild(timeAxis);
    weekBody.appendChild(weekColumns);
    daysGrid.appendChild(weekBody);

    if (allDates.length === 0) {
        return;
    }

    // Header time-range label was removed; timeline remains unchanged.
}

function initPageTransitions() {
    document.body.classList.remove('fade-out');
    document.querySelectorAll('.breadcrumb').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            document.body.classList.add('fade-out');
            setTimeout(() => { document.body.classList.remove('fade-out'); }, 300);
        });
    });
}

function applySidebarCollapsedState(collapsed, persist = true) {
    const appRoot = document.querySelector('.app');
    if (!appRoot) return;
    state.ui.sidebarCollapsed = Boolean(collapsed);
    appRoot.classList.toggle('sidebar-collapsed', state.ui.sidebarCollapsed);
    syncSidebarProfile();
    if (persist) {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, state.ui.sidebarCollapsed ? '1' : '0');
    }
}

function setMobileSidebarOpen(open) {
    const appRoot = document.querySelector('.app');
    if (!appRoot) return;
    state.ui.mobileSidebarOpen = Boolean(open);
    appRoot.classList.toggle('sidebar-open', state.ui.mobileSidebarOpen);
}

async function switchWorkspaceContext(workspaceId, preferredProjectId = '') {
    if (!isUuid(workspaceId)) {
        return;
    }
    applyActiveWorkspace(workspaceId);

    const preferredProject = isUuid(preferredProjectId)
        ? state.projects.find((project) => project.id === preferredProjectId && getProjectWorkspaceId(project) === workspaceId)
        : null;
    const firstWorkspaceProject = state.projects.find((project) => getProjectWorkspaceId(project) === workspaceId) || null;
    if (preferredProject) {
        switchProject(preferredProject.id);
        return;
    }
    if (firstWorkspaceProject) {
        switchProject(firstWorkspaceProject.id);
        return;
    }

    await loadState();
    const refreshedPreferredProject = isUuid(preferredProjectId)
        ? state.projects.find((project) => project.id === preferredProjectId && getProjectWorkspaceId(project) === workspaceId)
        : null;
    const refreshedWorkspaceProject = state.projects.find((project) => getProjectWorkspaceId(project) === workspaceId) || null;
    if (refreshedPreferredProject) {
        switchProject(refreshedPreferredProject.id);
        return;
    }
    if (refreshedWorkspaceProject) {
        switchProject(refreshedWorkspaceProject.id);
        return;
    }

        showErrorToast('No accessible workspace board found.', 'Workspace Unavailable', { code: 'TASK_VIEW_RUNTIME' });
    renderProjects();
    updateUIAfterProjectSwitch();
}

async function openWorkspaceSettingsModal(options = {}) {
    const requestedMode = options && options.mode === 'create' ? 'create' : 'edit';
    const requestedWorkspaceId = options && isUuid(options.workspaceId) ? options.workspaceId : '';
    const activeProject = getActiveProject();
    const targetProject = requestedMode === 'edit'
        ? (
            (requestedWorkspaceId
                ? state.projects.find((project) => getProjectWorkspaceId(project) === requestedWorkspaceId || project.id === requestedWorkspaceId)
                : null) ||
            activeProject
        )
        : null;
    if (requestedMode === 'edit' && !targetProject) {
        showErrorToast('Select a workspace first.', 'Workspace Error', { code: 'WORKSPACE_SETTINGS_RUNTIME' });
        return;
    }

    const titleNode = document.getElementById('workspaceSettingsModalTitle');
    const nameInput = document.getElementById('workspaceNameInput');
    const startDateInput = document.getElementById('workspaceStartDateInput');
    const endDateInput = document.getElementById('workspaceEndDateInput');
    const hourFormatSelect = document.getElementById('workspaceHourFormatSelect');
    const showWeekendsInput = document.getElementById('workspaceShowWeekendsInput');
    const weekStartSelect = document.getElementById('workspaceWeekStartSelect');
    const durationInput = document.getElementById('workspaceDefaultDurationInput');
    const saveBtn = document.getElementById('workspaceSettingsSaveBtn');
    const deleteBtn = document.getElementById('workspaceSettingsDeleteBtn');
    const hintNode = document.getElementById('workspaceSettingsHint');
    if (
        !nameInput ||
        !startDateInput ||
        !endDateInput ||
        !hourFormatSelect ||
        !showWeekendsInput ||
        !weekStartSelect ||
        !durationInput
    ) {
        showErrorToast('Workspace settings form is unavailable. Please refresh this page.', 'Workspace Error', {
            code: 'WORKSPACE_SETTINGS_DOM_MISSING'
        });
        return;
    }

    if (requestedMode === 'create') {
        const fallbackDuration = normalizeWorkspaceDefaultDuration(state.settings?.timeline?.defaultDuration || 2, 2);
        const fallbackHourFormat = state.settings?.timeline?.hourFormat === '12' ? '12' : '24';
        const fallbackShowWeekends = typeof state.settings?.timeline?.showWeekends === 'boolean'
            ? state.settings.timeline.showWeekends
            : true;
        const fallbackWeekStart = state.settings?.timeline?.weekStart === 'sun' ? 'sun' : 'mon';
        if (titleNode) titleNode.textContent = 'New Workspace';
        if (saveBtn) saveBtn.textContent = 'Create';
        nameInput.value = '';
        startDateInput.value = '';
        endDateInput.value = '';
        hourFormatSelect.value = fallbackHourFormat;
        showWeekendsInput.checked = fallbackShowWeekends;
        weekStartSelect.value = fallbackWeekStart;
        durationInput.value = String(fallbackDuration);
        workspaceSettingsDialog = { mode: 'create', workspaceId: '' };
        if (deleteBtn) {
            deleteBtn.hidden = true;
            deleteBtn.toggleAttribute('disabled', false);
            deleteBtn.removeAttribute('data-workspace-id');
        }
        if (hintNode) hintNode.textContent = 'Configure workspace timeline and basic board behavior.';
        openModal('workspaceSettingsModal');
        return;
    }

    const workspaceId = getProjectWorkspaceId(targetProject) || (isUuid(targetProject.id) ? targetProject.id : '');
    const startDate = getProjectTimelineStartDate(targetProject);
    const endDate = getProjectTimelineEndDate(targetProject);
    const hourFormat = getProjectHourFormat(targetProject);
    const showWeekends = getProjectShowWeekends(targetProject);
    const weekStart = getProjectWeekStart(targetProject);
    const defaultDuration = getProjectDefaultDurationHours(targetProject);

    if (titleNode) titleNode.textContent = 'Workspace Settings';
    if (saveBtn) saveBtn.textContent = 'Save';
    nameInput.value = sanitizeText(targetProject.name, 80) || '';
    startDateInput.value = startDate;
    endDateInput.value = endDate;
    hourFormatSelect.value = hourFormat;
    showWeekendsInput.checked = showWeekends;
    weekStartSelect.value = weekStart;
    durationInput.value = String(defaultDuration);
    workspaceSettingsDialog = { mode: 'edit', workspaceId };
    if (deleteBtn) {
        const canDelete = canDeleteWorkspace(targetProject);
        deleteBtn.hidden = !canDelete;
        deleteBtn.toggleAttribute('disabled', false);
        if (canDelete) {
            deleteBtn.dataset.workspaceId = workspaceId;
        } else {
            deleteBtn.removeAttribute('data-workspace-id');
        }
    }
    if (hintNode) hintNode.textContent = 'Configure workspace timeline and basic board behavior.';
    openModal('workspaceSettingsModal');
}

async function saveWorkspaceSettings() {
    const mode = workspaceSettingsDialog && workspaceSettingsDialog.mode === 'create' ? 'create' : 'edit';
    const requestedWorkspaceId = workspaceSettingsDialog && isUuid(workspaceSettingsDialog.workspaceId)
        ? workspaceSettingsDialog.workspaceId
        : '';

    const nameInput = document.getElementById('workspaceNameInput');
    const startDateInput = document.getElementById('workspaceStartDateInput');
    const endDateInput = document.getElementById('workspaceEndDateInput');
    const hourFormatSelect = document.getElementById('workspaceHourFormatSelect');
    const showWeekendsInput = document.getElementById('workspaceShowWeekendsInput');
    const weekStartSelect = document.getElementById('workspaceWeekStartSelect');
    const durationInput = document.getElementById('workspaceDefaultDurationInput');
    if (
        !nameInput ||
        !startDateInput ||
        !endDateInput ||
        !hourFormatSelect ||
        !showWeekendsInput ||
        !weekStartSelect ||
        !durationInput
    ) {
        showErrorToast('Workspace settings form is unavailable. Please refresh this page.', 'Workspace Error', {
            code: 'WORKSPACE_SETTINGS_DOM_MISSING'
        });
        return;
    }

    const nextName = sanitizeText(nameInput.value, 80);
    if (!nextName) {
        showCustomConfirm({
            title: 'Validation Error',
            message: 'Workspace name is required.'
        });
        nameInput.focus();
        return;
    }

    const nextStartDate = normalizeWorkspaceDate(startDateInput.value);
    const nextEndDate = normalizeWorkspaceDate(endDateInput.value);
    if (nextStartDate && nextEndDate && fromISODate(nextStartDate) > fromISODate(nextEndDate)) {
        showCustomConfirm({
            title: 'Validation Error',
            message: 'End date must be on or after start date.'
        });
        endDateInput.focus();
        return;
    }
    const nextHourFormat = normalizeWorkspaceHourFormat(hourFormatSelect.value, '24');
    const nextShowWeekends = normalizeWorkspaceShowWeekends(showWeekendsInput.checked, true);
    const nextWeekStart = normalizeWorkspaceWeekStart(weekStartSelect.value, 'mon');
    const nextDefaultDuration = normalizeWorkspaceDefaultDuration(
        durationInput.value,
        state.settings?.timeline?.defaultDuration || 2
    );
    const nextWorkspaceSettingsPayload = {
        startDate: nextStartDate || null,
        endDate: nextEndDate || null,
        hourFormat: nextHourFormat,
        showWeekends: nextShowWeekends,
        weekStart: nextWeekStart,
        defaultDurationHours: nextDefaultDuration,
    };

    if (mode === 'create') {
        if (!hasTaskApiClient() || !window.OrbitTaskApi.getToken()) {
            showErrorToast('You need to sign in before creating a workspace.', 'Authentication Required', {
                code: 'WORKSPACE_CREATE_AUTH_REQUIRED'
            });
            return;
        }
        const createLockKey = 'workspace:create';
        if (!acquireMutationLock(createLockKey)) {
            showErrorToast('Workspace creation is already in progress. Please wait a moment.', 'Workspace Busy', {
                code: 'WORKSPACE_CREATE_LOCKED'
            });
            return;
        }
        setWorkspaceSettingsBusy(true);
        let createdWorkspaceId = '';
        try {
            const created = await window.OrbitTaskApi.createWorkspace({ name: nextName });
            if (!created || !isUuid(created.id)) {
                throw new Error('Unable to create workspace');
            }
            createdWorkspaceId = created.id;
            const savedSettingsRaw = typeof window.OrbitTaskApi.updateWorkspaceSettings === 'function'
                ? await window.OrbitTaskApi.updateWorkspaceSettings(
                    created.id,
                    nextWorkspaceSettingsPayload,
                    { workspaceId: created.id }
                )
                : nextWorkspaceSettingsPayload;
            const savedSettings = normalizeWorkspaceSettingsRecord(
                savedSettingsRaw,
                nextWorkspaceSettingsPayload
            );
            state.workspaceDisplaySettings[created.id] = savedSettings;

            const localCreatedProject = sanitizeProject({
                id: created.id,
                name: nextName,
                active: true,
                workspaceId: created.id,
                ownerUserId: typeof created.ownerUserId === 'string' ? created.ownerUserId : '',
                workspaceRole: typeof created.role === 'string' ? created.role : 'OWNER',
                settings: {
                    startDate: savedSettings.startDate,
                    endDate: savedSettings.endDate,
                    hourFormat: savedSettings.hourFormat,
                    showWeekends: savedSettings.showWeekends,
                    weekStart: savedSettings.weekStart,
                    defaultDurationHours: savedSettings.defaultDuration,
                },
                startDate: savedSettings.startDate,
                endDate: savedSettings.endDate,
                hourFormat: savedSettings.hourFormat,
                showWeekends: savedSettings.showWeekends,
                weekStart: savedSettings.weekStart,
                defaultDurationHours: savedSettings.defaultDuration,
                members: [],
                tasks: []
            }, state.projects.length);

            state.projects = normalizeProjectsCollection([
                ...state.projects.map((project) => ({ ...project, active: false })),
                localCreatedProject
            ]);

            closeModals();
            switchProject(created.id);
            saveState({ immediate: true });
            showErrorToast('Workspace created successfully.', 'Workspace Created', 2200, { code: 'WORKSPACE_CREATED' });

            void (async () => {
                try {
                    const remoteState = await loadStateFromRemote();
                    if (!Array.isArray(remoteState) || remoteState.length === 0) {
                        return;
                    }
                    state.projects = normalizeProjectsCollection(
                        remoteState.map((project) => ({
                            ...project,
                            active: project.id === created.id
                        }))
                    );
                    renderProjects();
                    updateUIAfterProjectSwitch();
                    saveState({ immediate: true, skipRemoteSync: true });
                } catch (backgroundError) {
                    console.warn('Unable to hydrate workspace list after create:', backgroundError);
                }
            })();
            return;
        } catch (error) {
            console.warn('Unable to create workspace', error);
            if (createdWorkspaceId) {
                void refreshRemoteProjects({ silent: true });
                showErrorToast(
                    'The workspace was created, but its settings could not be saved. The dashboard has been reloaded from the server.',
                    'Workspace Settings Failed',
                    { code: 'WORKSPACE_SETTINGS_SYNC_FAILED' }
                );
            } else {
                showErrorToast('Unable to create workspace right now. Please try again.', 'Workspace Create Failed', {
                    code: 'WORKSPACE_CREATE_FAILED'
                });
            }
            return;
        } finally {
            setWorkspaceSettingsBusy(false);
            releaseMutationLock(createLockKey);
        }
    }

    const activeProject = (
        requestedWorkspaceId
            ? state.projects.find((project) => getProjectWorkspaceId(project) === requestedWorkspaceId || project.id === requestedWorkspaceId)
            : null
    ) || getActiveProject();
    if (!activeProject) {
        showErrorToast('Select a workspace first.', 'Workspace Error', { code: 'WORKSPACE_SETTINGS_RUNTIME' });
        return;
    }

    const workspaceId = getProjectWorkspaceId(activeProject);
    const updateLockKey = `workspace:update:${workspaceId || 'local'}`;
    if (!acquireMutationLock(updateLockKey)) {
        showErrorToast('Workspace update is already in progress. Please wait a moment.', 'Workspace Busy', {
            code: 'WORKSPACE_UPDATE_LOCKED'
        });
        return;
    }
    setWorkspaceSettingsBusy(true);

    try {
        let savedName = nextName;
        let savedSettings = normalizeWorkspaceSettingsRecord(nextWorkspaceSettingsPayload, nextWorkspaceSettingsPayload);

        if (
            workspaceId &&
            hasTaskApiClient() &&
            window.OrbitTaskApi.getToken() &&
            typeof window.OrbitTaskApi.updateWorkspace === 'function' &&
            typeof window.OrbitTaskApi.updateWorkspaceSettings === 'function'
        ) {
            const [workspaceResult, settingsResult] = await Promise.allSettled([
                window.OrbitTaskApi.updateWorkspace(
                    workspaceId,
                    { name: nextName },
                    { workspaceId }
                ),
                window.OrbitTaskApi.updateWorkspaceSettings(
                    workspaceId,
                    nextWorkspaceSettingsPayload,
                    { workspaceId }
                )
            ]);

            if (workspaceResult.status !== 'fulfilled' || settingsResult.status !== 'fulfilled') {
                console.warn('Unable to update workspace settings remotely:', {
                    workspaceResult,
                    settingsResult,
                });

                try {
                    if (
                        typeof window.OrbitTaskApi.getWorkspace === 'function' &&
                        typeof window.OrbitTaskApi.getWorkspaceSettings === 'function'
                    ) {
                        const [serverWorkspace, serverSettings] = await Promise.all([
                            window.OrbitTaskApi.getWorkspace(workspaceId, { workspaceId }),
                            window.OrbitTaskApi.getWorkspaceSettings(workspaceId, { workspaceId }),
                        ]);
                        activeProject.name = sanitizeText(serverWorkspace && serverWorkspace.name, 80) || activeProject.name;
                        const normalizedServerSettings = normalizeWorkspaceSettingsRecord(
                            serverSettings || (serverWorkspace && serverWorkspace.settings),
                            nextWorkspaceSettingsPayload
                        );
                        state.workspaceDisplaySettings[workspaceId] = normalizedServerSettings;
                        setProjectWorkspaceDisplaySettings(activeProject, {
                            startDate: normalizedServerSettings.startDate,
                            endDate: normalizedServerSettings.endDate,
                            hourFormat: normalizedServerSettings.hourFormat,
                            showWeekends: normalizedServerSettings.showWeekends,
                            weekStart: normalizedServerSettings.weekStart,
                            defaultDuration: normalizedServerSettings.defaultDuration,
                        });
                    } else {
                        await refreshRemoteProjects({ silent: true, preserveActiveProjectId: activeProject.id });
                    }
                } catch (resyncError) {
                    console.warn('Unable to resync workspace settings after partial failure:', resyncError);
                    await refreshRemoteProjects({ silent: true, preserveActiveProjectId: activeProject.id });
                }

                renderProjects();
                updateUIAfterProjectSwitch();
                showErrorToast('Unable to save workspace settings to the server. The dashboard has been reloaded from the latest saved data.', 'Update Failed', {
                    code: 'WORKSPACE_SETTINGS_SYNC_FAILED'
                });
                return;
            }

            savedName = sanitizeText(workspaceResult.value && workspaceResult.value.name, 80) || nextName;
            savedSettings = normalizeWorkspaceSettingsRecord(settingsResult.value, nextWorkspaceSettingsPayload);
        }

        activeProject.name = savedName;
        if (workspaceId) {
            state.workspaceDisplaySettings[workspaceId] = savedSettings;
        }
        setProjectWorkspaceDisplaySettings(activeProject, {
            startDate: savedSettings.startDate,
            endDate: savedSettings.endDate,
            hourFormat: savedSettings.hourFormat,
            showWeekends: savedSettings.showWeekends,
            weekStart: savedSettings.weekStart,
            defaultDuration: savedSettings.defaultDuration,
        });
        state.didInitialScroll = false;
        saveState({ immediate: true });
        renderProjects();
        updateUIAfterProjectSwitch();
        closeModals();
    } finally {
        setWorkspaceSettingsBusy(false);
        releaseMutationLock(updateLockKey);
    }
}

async function deleteWorkspaceFromSettingsModal() {
    const requestedWorkspaceId = workspaceSettingsDialog && isUuid(workspaceSettingsDialog.workspaceId)
        ? workspaceSettingsDialog.workspaceId
        : '';
    const targetProject = (
        requestedWorkspaceId
            ? state.projects.find((project) => getProjectWorkspaceId(project) === requestedWorkspaceId || project.id === requestedWorkspaceId)
            : null
    ) || getActiveProject();

    if (!targetProject) {
        showErrorToast('Select a workspace first.', 'Workspace Error', { code: 'WORKSPACE_DELETE_NO_ACTIVE' });
        return;
    }
    if (!canDeleteWorkspace(targetProject)) {
        showErrorToast('Only workspace owner can delete this workspace.', 'Permission Denied', {
            code: 'WORKSPACE_DELETE_FORBIDDEN'
        });
        return;
    }

    closeModals();
    currentContextMenuProjectId = targetProject.id;
    try {
        await confirmDeleteProject();
    } finally {
        currentContextMenuProjectId = null;
    }
}

function setupEventListeners() {
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            applySidebarCollapsedState(!state.ui.sidebarCollapsed, true);
        });
    }
    const mobileSidebarOpenBtn = document.getElementById('mobileSidebarOpenBtn');
    if (mobileSidebarOpenBtn) {
        mobileSidebarOpenBtn.addEventListener('click', () => {
            setMobileSidebarOpen(true);
        });
    }
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            setMobileSidebarOpen(false);
        });
    }
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            if (e.target.closest('.nav-item, #projectList li, .profile-card')) {
                setMobileSidebarOpen(false);
            }
        });
    }

    const addProjectTrigger = document.getElementById('addProjectTrigger');
    if (addProjectTrigger) {
        addProjectTrigger.addEventListener('click', addNewProject);
    }

    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) {
        addTaskBtn.addEventListener('click', () => {
            openTaskModal(null, true);
        });
    }

    const workspaceSettingsCloseBtn = document.getElementById('workspaceSettingsCloseBtn');
    if (workspaceSettingsCloseBtn) workspaceSettingsCloseBtn.addEventListener('click', closeModals);
    const workspaceSettingsCancelBtn = document.getElementById('workspaceSettingsCancelBtn');
    if (workspaceSettingsCancelBtn) workspaceSettingsCancelBtn.addEventListener('click', closeModals);
    const workspaceSettingsSaveBtn = document.getElementById('workspaceSettingsSaveBtn');
    if (workspaceSettingsSaveBtn) {
        workspaceSettingsSaveBtn.addEventListener('click', () => {
            void saveWorkspaceSettings();
        });
    }
    const workspaceSettingsDeleteBtn = document.getElementById('workspaceSettingsDeleteBtn');
    if (workspaceSettingsDeleteBtn) {
        workspaceSettingsDeleteBtn.addEventListener('click', () => {
            void deleteWorkspaceFromSettingsModal();
        });
    }
    const workspaceStartDateInput = document.getElementById('workspaceStartDateInput');
    const workspaceEndDateInput = document.getElementById('workspaceEndDateInput');
    if (workspaceStartDateInput && workspaceEndDateInput) {
        const syncDateConstraint = () => {
            const startDate = normalizeWorkspaceDate(workspaceStartDateInput.value);
            if (startDate) {
                workspaceEndDateInput.min = startDate;
            } else {
                workspaceEndDateInput.removeAttribute('min');
            }
        };
        workspaceStartDateInput.addEventListener('change', syncDateConstraint);
        syncDateConstraint();
    }
    const workspaceDefaultDurationInput = document.getElementById('workspaceDefaultDurationInput');
    if (workspaceDefaultDurationInput) {
        workspaceDefaultDurationInput.addEventListener('change', (event) => {
            const safeDuration = normalizeWorkspaceDefaultDuration(
                event && event.target ? event.target.value : '',
                state.settings?.timeline?.defaultDuration || 2
            );
            event.target.value = String(safeDuration);
        });
    }

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModals);
    const abortBtn = document.getElementById('abortBtn');
    if (abortBtn) abortBtn.addEventListener('click', closeModals);
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.onclick = saveTask;
    }
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', deleteTask);

    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeModals);
    const confirmSettingsBtn = document.getElementById('confirmSettingsBtn');
    if (confirmSettingsBtn) confirmSettingsBtn.addEventListener('click', saveProjectSettings);
    const addMemberBtn = document.getElementById('addMemberBtn');
    if (addMemberBtn) {
        addMemberBtn.addEventListener('click', () => {
            void handleAddMemberInSettings();
        });
    }

    const taskImageFile = document.getElementById('taskImageFile');
    if (taskImageFile) taskImageFile.addEventListener('change', handleFileSelect);
    const projectBackgroundFile = document.getElementById('projectBackgroundFile');
    if (projectBackgroundFile) projectBackgroundFile.addEventListener('change', handleFileSelect);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) hideContextMenus();
        const renamePopup = document.getElementById('renamePopup');
        if (renamePopup && renamePopup.style.display === 'block' && !e.target.closest('#renamePopup')) {
            renamePopup.style.display = 'none';
        }
    });

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('keydown', handleGlobalKeyDown);

    const pmenuSettings = document.getElementById('pmenuSettings');
    if (pmenuSettings) {
        pmenuSettings.addEventListener('click', () => {
            void openProjectSettings();
        });
    }
    const pmenuStar = document.getElementById('pmenuStar');
    if (pmenuStar) pmenuStar.addEventListener('click', toggleProjectStar);
    const pmenuDelete = document.getElementById('pmenuDelete');
    if (pmenuDelete) pmenuDelete.addEventListener('click', confirmDeleteProject);

    const renameCancelBtn = document.getElementById('renameCancelBtn');
    if (renameCancelBtn) {
        renameCancelBtn.addEventListener('click', () => {
            const renamePopup = document.getElementById('renamePopup');
            if (renamePopup) renamePopup.style.display = 'none';
        });
    }
    const renameConfirmBtn = document.getElementById('renameConfirmBtn');
    if (renameConfirmBtn) renameConfirmBtn.addEventListener('click', renameProjectFromPopup);

    const menuEdit = document.getElementById('menuEdit');
    if (menuEdit) menuEdit.addEventListener('click', () => {
        hideContextMenus();
        if (currentContextTaskData) openTaskModal(currentContextTaskData);
    });
    const menuDelete = document.getElementById('menuDelete');
    if (menuDelete) menuDelete.addEventListener('click', () => {
        hideContextMenus();
        if (currentContextTaskData) {
            currentTaskData = currentContextTaskData;
            deleteTask();
        }
    });

    const menuStatusMap = [
        { id: 'menuStatusNotStarted', status: 'Not Started' },
        { id: 'menuStatusInProgress', status: 'In Progress' },
        { id: 'menuStatusDone', status: 'Done' },
        { id: 'menuStatusDropped', status: 'Dropped' }
    ];
    menuStatusMap.forEach((entry) => {
        const el = document.getElementById(entry.id);
        if (!el) return;
        el.addEventListener('click', () => {
            hideContextMenus();
            if (currentContextTaskData) switchTaskStatus(currentContextTaskData.id, entry.status);
        });
    });

    const searchInput = document.getElementById('taskSearchInput');
    const statusFilter = document.getElementById('taskStatusFilter');
    const memberFilter = document.getElementById('taskMemberFilter');
    const timelineViewBtn = document.getElementById('timelineViewBtn');
    const boardViewBtn = document.getElementById('boardViewBtn');
    const timelineContainer = document.querySelector('.timeline-container');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.filters.text = e.target.value.trim().toLowerCase();
            scheduleFilteredLayout();
        });
    }
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            state.filters.status = e.target.value;
            scheduleFilteredLayout();
        });
    }
    if (memberFilter) {
        memberFilter.addEventListener('change', (e) => {
            state.filters.member = e.target.value;
            scheduleFilteredLayout();
        });
    }
    if (timelineViewBtn) {
        timelineViewBtn.addEventListener('click', () => setBoardViewMode('timeline'));
    }
    if (boardViewBtn) {
        boardViewBtn.addEventListener('click', () => setBoardViewMode('board'));
    }

    if (timelineContainer) {
        timelineContainer.addEventListener('wheel', (e) => {
            if (!e.shiftKey) return;
            timelineContainer.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });
    }

    syncSidebarProfile();
    updateProfileConnectionDot();

    const profileCard = document.getElementById('profileCard');
    if (profileCard) {
        profileCard.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigateTo('../setting/#tab-account');
        });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Sign out of Orbit?')) {
                clearConnectionProbeTimer();
                if (realtimeSync && typeof realtimeSync.disconnect === 'function') {
                    realtimeSync.disconnect();
                }
                if (window.OrbitAuth) {
                    await window.OrbitAuth.signOut({
                        redirectTo: '/landing/',
                    });
                    window.location.replace(routePath('/landing/'));
                } else {
                    window.location.href = routePath('/landing/');
                }
            }
        });
    }

    const taskStatusSelect = document.getElementById('taskStatusSelect');
    if (taskStatusSelect) taskStatusSelect.addEventListener('change', updateSelectColor);
    window.addEventListener('orbit:workspace-changed', (event) => {
        const workspaceId = event && event.detail && typeof event.detail.workspaceId === 'string'
            ? event.detail.workspaceId
            : '';
        if (!isUuid(workspaceId)) {
            return;
        }
        void switchWorkspaceContext(workspaceId);
    });
    window.addEventListener('orbit:open-workspace-settings', (event) => {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        const workspaceId = event && event.detail && typeof event.detail.workspaceId === 'string'
            ? event.detail.workspaceId
            : '';
        void openWorkspaceSettingsModal({ mode: 'edit', workspaceId });
    });
    window.addEventListener('orbit:notification-open', (event) => {
        const detail = event && event.detail && typeof event.detail === 'object' ? event.detail : {};
        const workspaceIdCandidates = [
            detail.workspaceId,
            detail.workspace_id,
            detail.workspaceID
        ];
        const projectIdCandidates = [
            detail.projectId,
            detail.project_id,
            detail.projectID
        ];
        const workspaceId = workspaceIdCandidates.find((value) => isUuid(value)) || '';
        const projectId = projectIdCandidates.find((value) => isUuid(value)) || '';
        if (projectId) {
            const project = state.projects.find((candidate) => candidate.id === projectId);
            if (project) {
                switchProject(projectId);
                return;
            }
        }
        if (!workspaceId) {
            return;
        }
        void switchWorkspaceContext(workspaceId, projectId);
    });
    window.addEventListener('storage', (e) => {
        if (e.key === 'orbitSettings') {
            state.settings = loadBoardSettings();
            syncSidebarProfile();
            layoutAllTasks();
        }
        if (e.key === WORKSPACE_DISPLAY_SETTINGS_STORAGE_KEY) {
            return;
        }
    });
    window.addEventListener('pagehide', () => {
        if (state.filters.debounceTimer) {
            clearTimeout(state.filters.debounceTimer);
            state.filters.debounceTimer = null;
        }
        if (state.realtimeInvalidate.timer) {
            clearTimeout(state.realtimeInvalidate.timer);
            state.realtimeInvalidate.timer = null;
        }
        clearRealtimeTaskFallbackTimer();
        state.realtimeInvalidate.lastTaskDeltaAt = 0;
        if (typeof window.removeEventListener === 'function') {
            window.removeEventListener(TASK_AUTH_FAILURE_EVENT, handleTaskAuthFailureEvent);
            window.removeEventListener(TASK_AUTH_SUCCESS_EVENT, handleTaskAuthSuccessEvent);
        }
        clearConnectionProbeTimer();
        if (realtimeSync && typeof realtimeSync.disconnect === 'function') {
            realtimeSync.disconnect();
        }
    });
    window.addEventListener('pageshow', () => {
        if (!state.authFailures.locked) {
            attachTaskAuthWatchers();
            connectRealtimeSync();
        }
        scheduleConnectionProbe(true);
    });
    document.addEventListener('visibilitychange', () => {
        scheduleConnectionProbe(true);
    });
}

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null);
}

function handleGlobalKeyDown(e) {
    if (e.key === 'Escape') {
        if (activeModal) {
            closeModals();
            e.preventDefault();
            return;
        }
        const detailModal = document.getElementById('taskDetailModal');
        if (detailModal) {
            detailModal.remove();
            e.preventDefault();
            return;
        }
        const renamePopup = document.getElementById('renamePopup');
        if (renamePopup && renamePopup.style.display === 'block') {
            renamePopup.style.display = 'none';
            e.preventDefault();
        }
    }

    if (activeModal && e.key === 'Tab') {
        const focusable = getFocusableElements(activeModal);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
        } else if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
        }
    }
}

function updateSelectColor(e) {
    const sel = e.target;
    sel.dataset.value = sel.value;
    const statusColors = {
        'Not Started': '#000000',
        'In Progress': '#0d1a2e',
        'Done': '#0a1a0d',
        'Dropped': '#1a0a0a'
    };
    if (statusColors[sel.value] !== undefined) {
        sel.style.backgroundColor = statusColors[sel.value];
    }
}

function applySelectColors() {
    document.querySelectorAll('.modal-content select').forEach((sel) => {
        sel.dataset.value = sel.value;
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    activeModal = modal;
    modal.style.display = 'flex';

    const content = modal.querySelector('.modal-content');
    if (content) {
        content.classList.remove('animate-in');
        void content.offsetWidth;
        content.classList.add('animate-in');
        const firstInput = content.querySelector('input, textarea, select, button');
        if (firstInput) firstInput.focus();
    }
    applySelectColors();
}

function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => { m.style.display = 'none'; });
    currentTaskData = null;
    currentContextMenuProjectId = null;
    workspaceSettingsDialog = { mode: 'edit', workspaceId: '' };
    activeModal = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }
    lastFocusedElement = null;
}

function showCustomConfirm({ title, message, onOk, onCancel }) {
    const modal = document.getElementById('customConfirmModal');
    document.getElementById('customConfirmTitle').textContent = title;
    document.getElementById('customConfirmMessage').textContent = message;

    const normalizedTitle = String(title || '').toLowerCase();
    const isErrorNotice =
        normalizedTitle.includes('error') ||
        normalizedTitle.includes('failed') ||
        normalizedTitle.includes('permission') ||
        normalizedTitle.includes('read-only') ||
        normalizedTitle.includes('unavailable');
    if (isErrorNotice && message) {
        showErrorToast(message, title || 'Error');
    }

    const okBtn = document.getElementById('customConfirmOk');
    const cancelBtn = document.getElementById('customConfirmCancel');
    const closeBtn = document.getElementById('customConfirmClose');

    const cleanup = () => {
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;
        activeModal = null;
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
        lastFocusedElement = null;
    };

    okBtn.onclick = () => { if (onOk) onOk(); cleanup(); };
    cancelBtn.onclick = () => { if (onCancel) onCancel(); cleanup(); };
    closeBtn.onclick = () => { if (onCancel) onCancel(); cleanup(); };

    lastFocusedElement = document.activeElement;
    activeModal = modal;
    modal.style.display = 'flex';
    okBtn.focus();
}

function confirmDialogAsync(title, message) {
    return new Promise((resolve) => {
        showCustomConfirm({
            title,
            message,
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

function confirmWorkspaceDeletionByName(workspaceName) {
    const expectedName = sanitizeText(workspaceName, 120);
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '12050';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0, 0, 0, 0.56)';
        overlay.style.backdropFilter = 'blur(4px)';

        const card = document.createElement('section');
        card.style.width = 'min(440px, 92vw)';
        card.style.borderRadius = '14px';
        card.style.border = '1px solid rgba(255,255,255,0.16)';
        card.style.background = 'linear-gradient(180deg, rgba(20,20,22,0.97), rgba(12,12,14,0.97))';
        card.style.boxShadow = '0 26px 60px rgba(0,0,0,0.46)';
        card.style.padding = '16px';

        const title = document.createElement('h3');
        title.textContent = 'Type Workspace Name To Confirm';
        title.style.margin = '0 0 8px';
        title.style.fontSize = '16px';
        title.style.letterSpacing = '0.03em';
        title.style.color = 'rgba(255,255,255,0.92)';

        const message = document.createElement('p');
        message.textContent = `Enter "${expectedName}" to permanently delete this workspace.`;
        message.style.margin = '0 0 10px';
        message.style.fontSize = '14px';
        message.style.lineHeight = '1.5';
        message.style.color = 'rgba(255,255,255,0.75)';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = expectedName;
        input.autocomplete = 'off';
        input.style.width = '100%';
        input.style.height = '38px';
        input.style.padding = '0 12px';
        input.style.borderRadius = '10px';
        input.style.border = '1px solid rgba(255,255,255,0.2)';
        input.style.background = 'rgba(255,255,255,0.03)';
        input.style.color = 'rgba(255,255,255,0.9)';
        input.style.marginBottom = '8px';

        const error = document.createElement('div');
        error.style.minHeight = '18px';
        error.style.fontSize = '12px';
        error.style.color = 'rgba(255, 184, 184, 0.95)';
        error.style.marginBottom = '10px';

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.justifyContent = 'flex-end';
        actions.style.gap = '8px';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.height = '34px';
        cancelBtn.style.padding = '0 12px';
        cancelBtn.style.borderRadius = '9px';
        cancelBtn.style.border = '1px solid rgba(255,255,255,0.2)';
        cancelBtn.style.background = 'rgba(255,255,255,0.06)';
        cancelBtn.style.color = 'rgba(255,255,255,0.9)';
        cancelBtn.style.cursor = 'pointer';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.textContent = 'Delete Workspace';
        confirmBtn.style.height = '34px';
        confirmBtn.style.padding = '0 14px';
        confirmBtn.style.borderRadius = '9px';
        confirmBtn.style.border = '1px solid rgba(255,255,255,0.32)';
        confirmBtn.style.background = 'rgba(255,255,255,0.92)';
        confirmBtn.style.color = '#000';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.style.fontWeight = '600';

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        card.appendChild(title);
        card.appendChild(message);
        card.appendChild(input);
        card.appendChild(error);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        confirmBtn.addEventListener('click', () => {
            const typedName = sanitizeText(input.value, 120);
            if (typedName !== expectedName) {
                error.textContent = 'Workspace name does not match.';
                input.focus();
                input.select();
                return;
            }
            cleanup(true);
        });
        cancelBtn.addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                cleanup(false);
            }
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                confirmBtn.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                cleanup(false);
            }
        });

        input.focus();
    });
}

function hexToRgba(hex, alpha = 1) {
    if (!hex || !/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        return 'rgba(255, 255, 255, 0.1)';
    }
    let c = hex.substring(1).split('');
    if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    const num = Number(`0x${c.join('')}`);
    return `rgba(${[(num >> 16) & 255, (num >> 8) & 255, num & 255].join(',')},${alpha})`;
}

function resolveRoleInput(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].includes(normalized) ? normalized : 'MEMBER';
}

function getSettingsProjectContext() {
    const project = state.projects.find((p) => p.id === currentContextMenuProjectId) || null;
    return {
        project,
        isNew: !project
    };
}

function canManageRemoteMembers(project) {
    return Boolean(
        project &&
        isUuid(project.id) &&
        isUuid(getProjectWorkspaceId(project)) &&
        hasTaskApiClient() &&
        window.OrbitTaskApi.getToken()
    );
}

function collectMembersFromSettingsModal() {
    const members = [];
    document.querySelectorAll('#projectMembersList .member-row').forEach((row) => {
        const rawName = row.querySelector('.member-name-input').value;
        const rawColor = row.querySelector('.member-color-input').value;
        const roleValue = row.querySelector('.member-role-select').value;
        const userId = typeof row.dataset.userId === 'string' ? row.dataset.userId : '';
        const memberName = sanitizeText(rawName, 40);
        if (!memberName) return;
        members.push(sanitizeMember({
            name: memberName,
            color: rawColor,
            role: resolveRoleInput(roleValue),
            userId
        }, members.length));
    });
    return members;
}

function syncProjectMembersFromSettingsModal(project) {
    if (!project) return;
    project.members = collectMembersFromSettingsModal();
}

async function refreshRemoteMembersInSettings(project) {
    if (!canManageRemoteMembers(project)) return;

    const membersList = document.getElementById('projectMembersList');
    if (!membersList) return;

    const remoteMembers = await window.OrbitTaskApi.listProjectMembers(project.id, getProjectRequestOptions(project));
    const mappedMembers = Array.isArray(remoteMembers)
        ? remoteMembers.map((member, index) => {
            const userId = typeof (member && member.userId) === 'string'
                ? member.userId
                : '';
            const role = typeof (member && member.role) === 'string'
                ? member.role
                : 'MEMBER';
            const existing = Array.isArray(project.members)
                ? project.members.find((candidate) => candidate.userId === userId)
                : null;
            return sanitizeMember({
                userId,
                role,
                name: resolveMemberDisplay(member) || (existing && existing.name ? existing.name : 'User'),
                user: member && typeof member.user === 'object' ? member.user : {},
                color: existing && existing.color ? existing.color : '#6e56cf'
            }, index);
        })
        : [];

    membersList.innerHTML = '';
    if (mappedMembers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'member-empty';
        empty.textContent = 'No members';
        membersList.appendChild(empty);
    } else {
        mappedMembers.forEach((member) => renderMemberRow(member));
    }
    project.members = mappedMembers.length > 0 ? mappedMembers : project.members;
}

async function handleAddMemberInSettings() {
    const context = getSettingsProjectContext();
    if (context.project && !canManageWorkspaceMembers(context.project)) {
        showCustomConfirm({
            title: 'Permission Denied',
            message: 'Only workspace admin/owner can manage members.'
        });
        return;
    }
    if (context.isNew || !canManageRemoteMembers(context.project)) {
        showCustomConfirm({
            title: 'Save Project First',
            message: 'Please create/save project first, then invite members by email.'
        });
        return;
    }

    const emailInput = document.getElementById('projectMemberEmailInput');
    const roleSelect = document.getElementById('projectMemberRoleSelect');
    const feedback = document.getElementById('projectMembersFeedback');
    if (!emailInput || !roleSelect) return;

    const email = normalizeEmail(emailInput.value);
    if (!email) {
        if (feedback) feedback.textContent = 'Please enter a valid email';
        return;
    }
    const role = resolveRoleInput(roleSelect.value);
    if (role === 'OWNER') {
        if (feedback) feedback.textContent = 'Project owner is immutable and cannot be reassigned';
        return;
    }
    if (feedback) feedback.textContent = 'Inviting member...';

    try {
        await window.OrbitTaskApi.addProjectMemberByEmail(context.project.id, {
            email,
            role
        }, getProjectRequestOptions(context.project));
        emailInput.value = '';
        if (feedback) feedback.textContent = 'Member invited';
        await refreshRemoteMembersInSettings(context.project);
        saveState({ immediate: true });
    } catch (error) {
        const errorCode = error && typeof error === 'object' &&
            error.body && typeof error.body === 'object' &&
            typeof error.body.code === 'string'
            ? error.body.code
            : '';
        if (errorCode === 'USER_NOT_REGISTERED') {
            if (feedback) feedback.textContent = 'USER_NOT_REGISTERED: Email has not registered yet';
            return;
        }
        if (errorCode === 'PROJECT_OWNER_IMMUTABLE') {
            if (feedback) feedback.textContent = 'PROJECT_OWNER_IMMUTABLE: Project owner cannot be changed';
            return;
        }

        const message = error && typeof error === 'object' && typeof error.message === 'string'
            ? error.message
            : 'Unable to add member right now.';
        if (feedback) feedback.textContent = message;
    }
}

async function openProjectSettings() {
    const context = getSettingsProjectContext();
    const project = context.project;
    if (!context.isNew && !canManageProjectSettings(project)) {
        showCustomConfirm({
            title: 'Permission Denied',
            message: 'You do not have permission to edit project settings.'
        });
        return;
    }

    document.getElementById('settingsModalTitle').textContent = context.isNew ? 'New Project Settings' : 'Project Settings';
    document.getElementById('projectNameInput').value = context.isNew ? 'New Cosmic Project' : project.name;
    document.getElementById('projectAvatarInitialInput').value = context.isNew ? '' : sanitizeProjectAvatarInitial(project.avatarInitial);
    document.getElementById('projectBackgroundInput').value = context.isNew ? '' : (project.background || '');
    const visibilitySelect = document.getElementById('projectVisibilitySelect');
    const defaultViewSelect = document.getElementById('projectDefaultViewSelect');
    const allowMemberInviteCheckbox = document.getElementById('projectAllowMemberInvite');
    const allowViewerCommentCheckbox = document.getElementById('projectAllowViewerComment');
    const allowTaskReorderCheckbox = document.getElementById('projectAllowTaskReorder');
    const allowTaskDeleteByMemberCheckbox = document.getElementById('projectAllowTaskDeleteByMember');
    const memberFeedback = document.getElementById('projectMembersFeedback');
    if (memberFeedback) memberFeedback.textContent = '';
    if (visibilitySelect) {
        visibilitySelect.value = context.isNew
            ? 'PRIVATE'
            : (String(project.visibility || 'PRIVATE').toUpperCase() === 'WORKSPACE' ? 'WORKSPACE' : 'PRIVATE');
    }
    if (defaultViewSelect) {
        defaultViewSelect.value = context.isNew
            ? (state.viewMode === 'board' ? 'BOARD' : 'CALENDAR')
            : (String(project.defaultView || (state.viewMode === 'board' ? 'BOARD' : 'CALENDAR')).toUpperCase() === 'CALENDAR' ? 'CALENDAR' : 'BOARD');
    }
    if (allowMemberInviteCheckbox) allowMemberInviteCheckbox.checked = false;
    if (allowViewerCommentCheckbox) allowViewerCommentCheckbox.checked = false;
    if (allowTaskReorderCheckbox) allowTaskReorderCheckbox.checked = true;
    if (allowTaskDeleteByMemberCheckbox) allowTaskDeleteByMemberCheckbox.checked = false;

    const membersList = document.getElementById('projectMembersList');
    membersList.innerHTML = '';
    const authUser = window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
        ? window.OrbitAuth.getStoredUser()
        : null;
    const membersToRender = context.isNew
        ? [{
            name: sanitizeText(
                (typeof authUser?.displayName === 'string' && authUser.displayName.trim()) ||
                (typeof authUser?.fullName === 'string' && authUser.fullName.trim()) ||
                (typeof authUser?.email === 'string' && authUser.email.includes('@') ? authUser.email.split('@')[0] : ''),
                40
            ) || 'You',
            color: '#6e56cf',
            role: 'OWNER',
            userId: typeof authUser?.id === 'string' ? authUser.id : '',
            user: {
                displayName: typeof authUser?.displayName === 'string' ? authUser.displayName : '',
                fullName: typeof authUser?.fullName === 'string' ? authUser.fullName : '',
                email: typeof authUser?.email === 'string' ? authUser.email : '',
                avatarUrl: typeof authUser?.avatarUrl === 'string' ? authUser.avatarUrl : ''
            }
        }]
        : project.members;
    membersToRender.forEach((member) => renderMemberRow(member));

    openModal('projectSettingsModal');

    if (!context.isNew && canManageRemoteMembers(project)) {
        try {
            const settings = await window.OrbitTaskApi.getProjectSettings(project.id, getProjectRequestOptions(project));
            if (settings && typeof settings === 'object') {
                if (defaultViewSelect && (settings.defaultView === 'BOARD' || settings.defaultView === 'CALENDAR')) {
                    defaultViewSelect.value = settings.defaultView;
                }
                if (allowMemberInviteCheckbox && typeof settings.allowMemberInvite === 'boolean') {
                    allowMemberInviteCheckbox.checked = settings.allowMemberInvite;
                }
                if (allowViewerCommentCheckbox && typeof settings.allowViewerComment === 'boolean') {
                    allowViewerCommentCheckbox.checked = settings.allowViewerComment;
                }
                if (allowTaskReorderCheckbox && typeof settings.allowTaskReorder === 'boolean') {
                    allowTaskReorderCheckbox.checked = settings.allowTaskReorder;
                }
                if (allowTaskDeleteByMemberCheckbox && typeof settings.allowTaskDeleteByMember === 'boolean') {
                    allowTaskDeleteByMemberCheckbox.checked = settings.allowTaskDeleteByMember;
                }
            }
            await refreshRemoteMembersInSettings(project);
        } catch (error) {
            console.warn('Unable to load remote project members:', error);
            showErrorToast('Unable to load project members right now.', 'Load Failed');
        }
    }
}

function renderMemberRow(member = { name: '', color: '#ffffff', role: 'MEMBER', userId: '' }) {
    const membersList = document.getElementById('projectMembersList');
    if (!membersList) return;

    const context = getSettingsProjectContext();
    const memberRow = document.createElement('div');
    memberRow.className = 'member-row';
    const normalizedMember = sanitizeMember(member, membersList.children.length);
    if (normalizedMember.userId) {
        memberRow.dataset.userId = normalizedMember.userId;
    }

    const colorWrap = document.createElement('div');
    colorWrap.className = 'color-picker-wrap';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'member-color-input';
    colorInput.value = normalizedMember.color;
    colorInput.disabled = Boolean(context.project && canManageRemoteMembers(context.project));

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'color-confirm-btn';
    confirmBtn.title = 'Confirm color';
    confirmBtn.textContent = 'OK';
    confirmBtn.style.background = colorInput.value;
    confirmBtn.disabled = colorInput.disabled;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'member-name-input';
    nameInput.placeholder = 'Member name';
    nameInput.value = normalizedMember.name;
    nameInput.maxLength = 40;
    nameInput.readOnly = true;

    const isOwner = normalizedMember.role === 'OWNER' ||
        (context.project && isUuid(context.project.ownerUserId) && context.project.ownerUserId === normalizedMember.userId);

    const roleSelect = document.createElement('select');
    roleSelect.className = 'member-role-select';
    const allowedRoles = isOwner ? ['OWNER'] : ['ADMIN', 'MEMBER', 'VIEWER'];
    allowedRoles.forEach((role) => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        roleSelect.appendChild(option);
    });
    roleSelect.value = allowedRoles.includes(resolveRoleInput(normalizedMember.role))
        ? resolveRoleInput(normalizedMember.role)
        : allowedRoles[0];
    roleSelect.disabled = isOwner;

    const isRemoteMember = Boolean(
        context.project &&
        canManageWorkspaceMembers(context.project) &&
        canManageRemoteMembers(context.project) &&
        isUuid(normalizedMember.userId)
    );

    const saveRoleBtn = document.createElement('button');
    saveRoleBtn.type = 'button';
    saveRoleBtn.className = 'btn-add-member';
    saveRoleBtn.textContent = 'Save';
    saveRoleBtn.style.display = isRemoteMember && !isOwner ? 'inline-flex' : 'none';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-member';
    removeBtn.textContent = 'Remove';
    removeBtn.disabled = isOwner;

    colorWrap.appendChild(colorInput);
    colorWrap.appendChild(confirmBtn);
    memberRow.appendChild(colorWrap);
    memberRow.appendChild(nameInput);
    memberRow.appendChild(roleSelect);
    memberRow.appendChild(saveRoleBtn);
    memberRow.appendChild(removeBtn);
    membersList.appendChild(memberRow);

    colorInput.addEventListener('input', () => {
        confirmBtn.style.background = colorInput.value;
    });
    confirmBtn.addEventListener('click', () => {
        confirmBtn.style.background = colorInput.value;
    });

    saveRoleBtn.addEventListener('click', () => {
        const liveContext = getSettingsProjectContext();
        if (!liveContext.project || !isUuid(normalizedMember.userId)) return;
        const feedback = document.getElementById('projectMembersFeedback');
        const role = resolveRoleInput(roleSelect.value);
        if (role === 'OWNER') {
            if (feedback) feedback.textContent = 'Project owner is immutable and cannot be reassigned';
            return;
        }
        if (feedback) feedback.textContent = 'Updating role...';
        void window.OrbitTaskApi.updateProjectMemberRole(
            liveContext.project.id,
            normalizedMember.userId,
            { role },
            getProjectRequestOptions(liveContext.project)
        )
            .then(async () => {
                if (feedback) feedback.textContent = 'Member role updated';
                await refreshRemoteMembersInSettings(liveContext.project);
                saveState({ immediate: true });
            })
            .catch((error) => {
                const code = error && typeof error === 'object' && error.body && typeof error.body.code === 'string'
                    ? error.body.code
                    : '';
                if (code === 'PROJECT_OWNER_IMMUTABLE') {
                    if (feedback) feedback.textContent = 'PROJECT_OWNER_IMMUTABLE: Project owner cannot be changed';
                    return;
                }
                if (feedback) {
                    feedback.textContent = error && typeof error === 'object' && typeof error.message === 'string'
                        ? error.message
                        : 'Unable to update member role right now.';
                }
            });
    });

    removeBtn.addEventListener('click', () => {
        void (async () => {
            const liveContext = getSettingsProjectContext();
            const memberUserId = typeof memberRow.dataset.userId === 'string'
                ? memberRow.dataset.userId
                : '';

            if (liveContext.project && canManageRemoteMembers(liveContext.project) && isUuid(memberUserId)) {
                try {
                    const feedback = document.getElementById('projectMembersFeedback');
                    if (feedback) feedback.textContent = 'Removing member...';
                    await window.OrbitTaskApi.removeProjectMember(
                        liveContext.project.id,
                        memberUserId,
                        getProjectRequestOptions(liveContext.project)
                    );
                    memberRow.remove();
                    syncProjectMembersFromSettingsModal(liveContext.project);
                    saveState({ immediate: true });
                    if (feedback) feedback.textContent = 'Member removed';
                } catch (error) {
                    const feedback = document.getElementById('projectMembersFeedback');
                    if (feedback) {
                        feedback.textContent = error && typeof error === 'object' && typeof error.message === 'string'
                            ? error.message
                            : 'Unable to remove member right now.';
                    }
                }
                return;
            }

            memberRow.remove();
            if (liveContext.project) {
                syncProjectMembersFromSettingsModal(liveContext.project);
            }
        })();
    });
}

function saveProjectSettings() {
    const isNew = !state.projects.some((p) => p.id === currentContextMenuProjectId);
    const nameInput = document.getElementById('projectNameInput');
    const avatarInitialInput = document.getElementById('projectAvatarInitialInput');
    const bgInput = document.getElementById('projectBackgroundInput');
    const visibilitySelect = document.getElementById('projectVisibilitySelect');
    const defaultViewSelect = document.getElementById('projectDefaultViewSelect');
    const allowMemberInviteCheckbox = document.getElementById('projectAllowMemberInvite');
    const allowViewerCommentCheckbox = document.getElementById('projectAllowViewerComment');
    const allowTaskReorderCheckbox = document.getElementById('projectAllowTaskReorder');
    const allowTaskDeleteByMemberCheckbox = document.getElementById('projectAllowTaskDeleteByMember');

    const projectName = sanitizeText(nameInput.value, 80);
    if (!projectName) {
        showCustomConfirm({ title: 'Validation Error', message: 'Project name is required.' });
        nameInput.focus();
        return;
    }
    const avatarInitial = sanitizeProjectAvatarInitial(avatarInitialInput ? avatarInitialInput.value : '');

    const background = sanitizeImageUrl(bgInput.value);
    if (bgInput.value.trim() && !background) {
        showCustomConfirm({ title: 'Validation Error', message: 'Background URL must be a valid http(s) or image data URL.' });
        bgInput.focus();
        return;
    }

    const members = collectMembersFromSettingsModal();
    const visibility = visibilitySelect && String(visibilitySelect.value).toUpperCase() === 'WORKSPACE'
        ? 'WORKSPACE'
        : 'PRIVATE';
    const defaultView = defaultViewSelect && String(defaultViewSelect.value).toUpperCase() === 'CALENDAR'
        ? 'CALENDAR'
        : 'BOARD';

    if (isNew) {
        state.projects.forEach((p) => { p.active = false; });
        const authUser = window.OrbitAuth && typeof window.OrbitAuth.getStoredUser === 'function'
            ? window.OrbitAuth.getStoredUser()
            : null;
        const workspaceId = resolveDefaultWorkspaceId();
        const createdAt = Date.now();
        state.projects.push({
            id: currentContextMenuProjectId || `proj-${Date.now()}`,
            name: projectName,
            avatarInitial,
            active: true,
            background,
            workspaceId,
            startDate: '',
            endDate: '',
            hourFormat: '24',
            showWeekends: true,
            weekStart: 'mon',
            defaultDurationHours: 2,
            lastAccessedAt: createdAt,
            ownerUserId: typeof authUser?.id === 'string' ? authUser.id : '',
            visibility,
            defaultView,
            members,
            tasks: []
        });
    } else {
        const project = state.projects.find((p) => p.id === currentContextMenuProjectId);
        if (project) {
            if (!canManageProjectSettings(project)) {
                showCustomConfirm({
                    title: 'Permission Denied',
                    message: 'You do not have permission to edit project settings.'
                });
                return;
            }
            project.name = projectName;
            project.avatarInitial = avatarInitial;
            project.background = background;
            project.members = members;
            project.visibility = visibility;
            project.defaultView = defaultView;
            project.tasks = Array.isArray(project.tasks) ? project.tasks : [];
            const requestOptions = getProjectRequestOptions(project);
            if (canManageRemoteMembers(project)) {
                void window.OrbitTaskApi.updateProject(project.id, {
                    name: projectName,
                    description: buildProjectDescription(project),
                    visibility,
                    defaultView
                }, requestOptions).catch((error) => {
                    console.warn('Unable to update project:', error);
                    showErrorToast('Unable to update project settings right now.', 'Update Failed');
                });
                void window.OrbitTaskApi.updateProjectSettings(project.id, {
                    defaultView,
                    allowMemberInvite: allowMemberInviteCheckbox ? Boolean(allowMemberInviteCheckbox.checked) : false,
                    allowViewerComment: allowViewerCommentCheckbox ? Boolean(allowViewerCommentCheckbox.checked) : false,
                    allowTaskReorder: allowTaskReorderCheckbox ? Boolean(allowTaskReorderCheckbox.checked) : true,
                    allowTaskDeleteByMember: allowTaskDeleteByMemberCheckbox ? Boolean(allowTaskDeleteByMemberCheckbox.checked) : false
                }, requestOptions).catch((error) => {
                    console.warn('Unable to update project settings:', error);
                    showErrorToast('Unable to save project policy settings.', 'Update Failed');
                });
            }
        }
    }

    const activeProject = getActiveProject();
    if (activeProject) {
        markProjectAccessed(activeProject.id);
    }
    saveState({ immediate: true });
    renderProjects();
    updateUIAfterProjectSwitch();
    closeModals();
}

function populateMemberSelect(activeProject) {
    const select = document.getElementById('taskMembersSelect');
    if (!select) return;
    select.innerHTML = '';
    if (!activeProject || !Array.isArray(activeProject.members)) return;

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'Unassigned';
    select.appendChild(emptyOpt);

    activeProject.members.forEach((member) => {
        const opt = document.createElement('option');
        opt.value = isUuid(member.userId) ? member.userId : member.name;
        opt.textContent = member.name;
        opt.dataset.memberName = member.name;
        if (isUuid(member.userId)) {
            opt.dataset.userId = member.userId;
        }
        select.appendChild(opt);
    });
}

function populateTaskFilterMembers(activeProject) {
    const select = document.getElementById('taskMemberFilter');
    if (!select) return;
    const currentValue = select.value || 'All';
    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'All';
    allOpt.textContent = 'All Members';
    select.appendChild(allOpt);

    if (activeProject && Array.isArray(activeProject.members)) {
        activeProject.members.forEach((member) => {
            const opt = document.createElement('option');
            opt.value = member.name;
            opt.textContent = member.name;
            select.appendChild(opt);
        });
    }

    if ([...select.options].some((opt) => opt.value === currentValue)) {
        select.value = currentValue;
        state.filters.member = currentValue;
    } else {
        select.value = 'All';
        state.filters.member = 'All';
    }
}

function openTaskModal(taskData = null, isNew = false, prefill = null) {
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject) {
        showErrorToast('Create or select a workspace before adding tasks.', 'Task Error', { code: 'TASK_SAVE_RUNTIME' });
        showCustomConfirm({ title: 'No Active Workspace', message: 'Create a workspace before adding tasks.' });
        return;
    }
    const canEdit = canEditProjectTasks(activeProject);
    if (!canEdit) {
        if (taskData) {
            openTaskDetail(taskData);
            return;
        }
        showCustomConfirm({
            title: 'Read-only Mode',
            message: 'You do not have permission to create tasks in this workspace.'
        });
        showErrorToast('You do not have permission to create tasks in this workspace.', 'Permission Denied', { code: 'TASK_SAVE_PERMISSION_DENIED' });
        return;
    }
    if (taskData && !canMutateTask(taskData, activeProject)) {
        showTaskOwnershipDenied('edit tasks');
        openTaskDetail(taskData);
        return;
    }

    try {
        populateMemberSelect(activeProject);

        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) {
            confirmBtn.onclick = saveTask;
        }

        const deleteBtn = assertElementById('deleteBtn', 'TASK_SAVE_DOM_MISSING');
        const modalTitle = assertElementById('modalTitle', 'TASK_SAVE_DOM_MISSING');
        const taskInput = assertElementById('taskInput', 'TASK_SAVE_DOM_MISSING');
        const startAtInput = assertElementById('taskStartAtInput', 'TASK_SAVE_DOM_MISSING');
        const endAtInput = assertElementById('taskEndAtInput', 'TASK_SAVE_DOM_MISSING');
        const statusSelect = assertElementById('taskStatusSelect', 'TASK_SAVE_DOM_MISSING');
        const prioritySelect = assertElementById('taskPrioritySelect', 'TASK_SAVE_DOM_MISSING');
        const taskNote = assertElementById('taskNote', 'TASK_SAVE_DOM_MISSING');
        const taskImageUrl = assertElementById('taskImageUrl', 'TASK_SAVE_DOM_MISSING');
        const memberSelect = assertElementById('taskMembersSelect', 'TASK_SAVE_DOM_MISSING');

        deleteBtn.style.display = taskData ? 'block' : 'none';
        modalTitle.textContent = taskData ? 'Edit Task' : 'New Task';
        currentTaskData = taskData;

        if (taskData) {
            const startDate = isISODate(taskData.startDate) ? taskData.startDate : (isISODate(taskData.date) ? taskData.date : getTodayISO());
            const startTime = isTimeValue(taskData.startTime) ? taskData.startTime : leftToTime(taskData.left);
            const endDate = isISODate(taskData.endDate) ? taskData.endDate : startDate;
            const endTime = isTimeValue(taskData.endTime) ? taskData.endTime : leftToTime(taskData.left + taskData.width);

            taskInput.value = taskData.name || '';
            startAtInput.value = toDateTimeLocal(startDate, startTime);
            endAtInput.value = toDateTimeLocal(endDate, endTime);
            statusSelect.value = taskData.status || 'Not Started';
            prioritySelect.value = taskData.priority || 'Medium';
            taskNote.value = taskData.note || '';
            taskImageUrl.value = taskData.image || '';

            const preferredMemberValue = isUuid(taskData.memberUserId)
                ? taskData.memberUserId
                : (taskData.memberName || '');
            if ([...memberSelect.options].some((option) => option.value === preferredMemberValue)) {
                memberSelect.value = preferredMemberValue;
            } else {
                memberSelect.value = '';
            }
        } else {
            const prefillStartDate = prefill && isISODate(prefill.startDate) ? prefill.startDate : '';
            const prefillStartTime = prefill && isTimeValue(prefill.startTime) ? prefill.startTime : '';
            const prefillEndDate = prefill && isISODate(prefill.endDate) ? prefill.endDate : '';
            const prefillEndTime = prefill && isTimeValue(prefill.endTime) ? prefill.endTime : '';
            const startDate = prefillStartDate || getTodayISO();
            const startTime = prefillStartTime || getQuarterRoundedNowTime();
            const defaultDurationHours = getProjectDefaultDurationHours(activeProject);
            const fallbackEnd = computeEndDateTime(startDate, startTime, defaultDurationHours);
            const endDate = prefillEndDate || fallbackEnd.endDate;
            const endTime = prefillEndTime || fallbackEnd.endTime;

            taskInput.value = '';
            startAtInput.value = toDateTimeLocal(startDate, startTime);
            endAtInput.value = toDateTimeLocal(endDate, endTime);
            statusSelect.value = 'Not Started';
            prioritySelect.value = 'Medium';
            taskNote.value = '';
            taskImageUrl.value = '';
            const currentUserId = getCurrentUserId();
            if (isMemberRestrictedEditor(activeProject) && currentUserId) {
                memberSelect.value = currentUserId;
            } else {
                memberSelect.value = '';
            }
        }

        openModal('taskModal');
    } catch (error) {
        const meta = getTaskFlowErrorMeta(
            error,
            'TASK_SAVE_DOM_MISSING',
            'Task form is unavailable. Please refresh and try again.'
        );
        const debugContext = getTaskDebugContext(activeProject, {
            source: 'openTaskModal',
            mode: taskData ? 'edit' : 'create',
            ...meta.context
        });
        console.error('Unable to open task modal', {
            code: meta.code,
            message: meta.message,
            context: debugContext,
            error
        });
        showErrorToast(meta.message, 'Task Form Error', { code: meta.code });
    }
}

function validateTaskPayload(payload, activeProject) {
    const errors = [];
    const projectMembers = activeProject && Array.isArray(activeProject.members) ? activeProject.members : [];
    if (!payload.name) errors.push('Task name is required.');
    if (!isISODate(payload.startDate)) errors.push('Please select a valid start date.');
    if (!isTimeValue(payload.startTime)) errors.push('Please select a valid start time.');
    if (!isISODate(payload.endDate)) errors.push('Please select a valid end date.');
    if (!isTimeValue(payload.endTime)) errors.push('Please select a valid end time.');
    if (!TASK_STATUSES.includes(payload.status)) errors.push('Invalid task status.');
    if (!TASK_PRIORITIES.includes(payload.priority)) errors.push('Invalid task priority.');
    if (payload.imageInput && !payload.image) errors.push('Image URL must be a valid http(s) or image data URL.');

    if (errors.length === 0) {
        const start = new Date(`${payload.startDate}T${payload.startTime}:00`);
        const end = new Date(`${payload.endDate}T${payload.endTime}:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            errors.push('Invalid task schedule.');
        } else if (end <= start) {
            errors.push('End date/time must be after start date/time.');
        }
    }

    const hasMember = payload.memberUserId
        ? projectMembers.some((member) => member.userId === payload.memberUserId)
        : (payload.memberName && projectMembers.some((member) => member.name === payload.memberName));
    if ((payload.memberName || payload.memberUserId) && !hasMember) {
        errors.push('Selected member is not part of this project.');
    }
    return errors;
}

function showTaskOwnershipDenied(actionLabel = 'modify this task') {
    const message = `Members can only ${actionLabel} assigned to themselves.`;
    showCustomConfirm({
        title: 'Permission Denied',
        message
    });
    showErrorToast(message, 'Permission Denied', { code: 'TASK_OWNERSHIP_FORBIDDEN' });
}

function saveTask() {
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject) {
        showErrorToast('No active workspace selected.', 'Task Error', { code: 'TASK_SAVE_RUNTIME' });
        return;
    }
    if (!canEditProjectTasks(activeProject)) {
        showCustomConfirm({
            title: 'Read-only Mode',
            message: 'You do not have permission to edit tasks in this workspace.'
        });
        showErrorToast('You do not have permission to edit tasks in this workspace.', 'Permission Denied', { code: 'TASK_SAVE_PERMISSION_DENIED' });
        return;
    }
    if (currentTaskData && !canMutateTask(currentTaskData, activeProject)) {
        showTaskOwnershipDenied('edit tasks');
        return;
    }
    const now = Date.now();
    if (now < Number(state.taskSubmit.busyUntil || 0)) {
        showErrorToast(
            'Task submission is already in progress. Please wait a moment.',
            'Task Busy',
            { code: 'TASK_SAVE_SUBMIT_COOLDOWN' }
        );
        return;
    }
    state.taskSubmit.busyUntil = now + TASK_SUBMIT_COOLDOWN_MS;

    const mutationLockKey = currentTaskData && typeof currentTaskData.id === 'string' && currentTaskData.id
        ? `task:save:${currentTaskData.id}`
        : `task:save:new:${activeProject.id}`;
    if (!acquireMutationLock(mutationLockKey)) {
        showErrorToast(
            'Task save is in progress. Please wait a moment.',
            'Task Busy',
            { code: 'TASK_SAVE_LOCKED' }
        );
        return;
    }

    try {
        try {
            const taskInput = assertElementById('taskInput', 'TASK_SAVE_DOM_MISSING');
            const startAtInput = assertElementById('taskStartAtInput', 'TASK_SAVE_DOM_MISSING');
            const endAtInput = assertElementById('taskEndAtInput', 'TASK_SAVE_DOM_MISSING');
            const statusSelect = assertElementById('taskStatusSelect', 'TASK_SAVE_DOM_MISSING');
            const prioritySelect = assertElementById('taskPrioritySelect', 'TASK_SAVE_DOM_MISSING');
            const taskNoteInput = assertElementById('taskNote', 'TASK_SAVE_DOM_MISSING');
            const taskImageInput = assertElementById('taskImageUrl', 'TASK_SAVE_DOM_MISSING');
            const memberSelect = assertElementById('taskMembersSelect', 'TASK_SAVE_DOM_MISSING');

            const name = sanitizeText(taskInput.value, 120);
            const startAtRaw = startAtInput.value;
            const endAtRaw = endAtInput.value;
            const startAt = parseDateTimeLocal(startAtRaw);
            const endAt = parseDateTimeLocal(endAtRaw);
            const startDate = startAt ? startAt.date : '';
            const startTime = startAt ? startAt.time : '';
            const endDate = endAt ? endAt.date : '';
            const endTime = endAt ? endAt.time : '';
            const status = statusSelect.value;
            const priority = prioritySelect.value;

            if (!memberSelect.options || typeof memberSelect.selectedIndex !== 'number') {
                throw createTaskFlowError(
                    'TASK_SAVE_DOM_MISSING',
                    'Assignee selector is unavailable. Please refresh and try again.',
                    { elementId: 'taskMembersSelect' }
                );
            }
            const selectedMemberOption = memberSelect.options[memberSelect.selectedIndex] || null;
            const selectedMemberValue = sanitizeText(memberSelect.value, 120);
            const memberUserId = isUuid(selectedMemberValue) ? selectedMemberValue : '';
            const memberName = sanitizeText(
                selectedMemberOption && selectedMemberOption.dataset.memberName
                    ? selectedMemberOption.dataset.memberName
                    : (memberUserId ? normalizeMemberLabel(memberUserId) : selectedMemberValue),
                40
            );
            const note = sanitizeNote(taskNoteInput.value);
            const imageInput = taskImageInput.value.trim();
            const image = sanitizeImageUrl(imageInput);
            if (isMemberRestrictedEditor(activeProject)) {
                const currentUserId = getCurrentUserId();
                if (!currentUserId || memberUserId !== currentUserId) {
                    showTaskOwnershipDenied('create or edit tasks');
                    return;
                }
            }
            const defaultDurationHours = getProjectDefaultDurationHours(activeProject);
            const maxWidth = state.hourWidth * DAY_HOURS;
            const fallbackLeft = currentTaskData ? currentTaskData.left : 48;
            const startMinutes = timeToMinutes(startTime);
            const endMinutes = timeToMinutes(endTime);

            let left = clamp(startMinutes !== null ? timeToLeft(startTime) : fallbackLeft, 0, maxWidth);
            let width = state.hourWidth * defaultDurationHours;
            if (startMinutes !== null && endMinutes !== null) {
                if (startDate === endDate) {
                    const durationMinutes = Math.max(15, endMinutes - startMinutes);
                    width = (durationMinutes / 60) * state.hourWidth;
                } else {
                    width = maxWidth - left;
                }
            } else if (currentTaskData) {
                width = currentTaskData.width;
            }
            width = clamp(width, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - left));

            const payload = {
                id: currentTaskData ? currentTaskData.id : `task-${Date.now()}`,
                name,
                date: startDate,
                startDate,
                startTime,
                endDate,
                endTime,
                status,
                priority,
                dueTime: endTime,
                memberName,
                memberUserId,
                note,
                image,
                imageInput,
                left,
                width
            };

            const errors = validateTaskPayload(payload, activeProject);
            if (errors.length > 0) {
                const validationMessage = errors[0];
                showErrorToast(validationMessage, 'Validation Error', { code: 'TASK_SAVE_VALIDATION_FAILED' });
                showCustomConfirm({ title: 'Validation Error', message: errors[0] });
                if (validationMessage === 'Task name is required.') {
                    safeFocusById('taskInput');
                } else if (validationMessage === 'Please select a valid start date.' || validationMessage === 'Please select a valid start time.') {
                    safeFocusById('taskStartAtInput');
                } else if (validationMessage === 'Please select a valid end date.') {
                    safeFocusById('taskEndAtInput');
                } else if (validationMessage === 'Please select a valid end time.' || validationMessage === 'End date/time must be after start date/time.') {
                    safeFocusById('taskEndAtInput');
                }
                return;
            }

            payload.left = clamp(payload.left, 0, maxWidth);
            payload.width = clamp(payload.width, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - payload.left));
            if (!currentTaskData) {
                const workspaceId = getProjectWorkspaceId(activeProject) || (isUuid(activeProject.id) ? activeProject.id : '');
                const createSignature = buildTaskCreateSpamSignature(payload, workspaceId);
                if (isTaskCreateSpam(createSignature)) {
                    showErrorToast(
                        'Duplicate task create request was blocked. Please wait a few seconds before retrying the same task.',
                        'Task Blocked',
                        { code: 'TASK_CREATE_DUPLICATE_BLOCKED' }
                    );
                    return;
                }
                rememberTaskCreateSpamSignature(createSignature);
            }

            if (!Array.isArray(activeProject.tasks)) {
                activeProject.tasks = [];
            }

            const idx = activeProject.tasks.findIndex((task) => task.id === payload.id);
            if (idx >= 0) {
                activeProject.tasks[idx] = { ...activeProject.tasks[idx], ...payload };
            } else {
                activeProject.tasks.push(payload);
            }

            try {
                saveState({ immediate: true });
                layoutAllTasks();
            } catch (renderError) {
                throw createTaskFlowError(
                    'TASK_SAVE_RENDER_FAILED',
                    'Task saved but UI refresh failed. Please reload to continue.',
                    {
                        taskId: payload.id,
                        renderMessage: typeof renderError?.message === 'string' ? renderError.message : ''
                    }
                );
            }

            const isVisibleAfterSave = applyTaskFilters(activeProject.tasks).some((task) => task.id === payload.id);
            if (!isVisibleAfterSave) {
                showErrorToast(
                    'Task was saved but is hidden by current filters/search.',
                    'Task Hidden',
                    { code: 'TASK_SAVE_FILTER_HIDDEN' }
                );
            }
            setTimeout(() => scrollToTaskSchedule(payload.startDate, payload.left), 40);
            closeModals();
        } catch (error) {
            const meta = getTaskFlowErrorMeta(
                error,
                'TASK_SAVE_RUNTIME',
                'Unexpected error while saving task. Please try again.'
            );
            const context = getTaskDebugContext(activeProject, {
                source: 'saveTask',
                ...meta.context
            });
            console.error('Task save failed', {
                code: meta.code,
                message: meta.message,
                context,
                error
            });
            showErrorToast(meta.message, 'Task Save Failed', { code: meta.code });
        }
    } finally {
        releaseMutationLock(mutationLockKey);
    }
}

function deleteTask() {
    if (!currentTaskData) {
        showErrorToast('Task data is missing.', 'Task Error', { code: 'TASK_VIEW_RUNTIME' });
        return;
    }
    showCustomConfirm({
        title: 'Delete Task',
        message: `Are you sure you want to delete "${currentTaskData.name}"? This action cannot be undone.`,
        onOk: () => {
            const activeProject = state.projects.find((p) => p.active);
            if (!activeProject) {
                showErrorToast('No active workspace selected.', 'Task Error', { code: 'TASK_VIEW_RUNTIME' });
                return;
            }
            if (!canEditProjectTasks(activeProject)) {
                showCustomConfirm({
                    title: 'Read-only Mode',
                    message: 'You do not have permission to delete tasks in this workspace.'
                });
                showErrorToast('You do not have permission to delete tasks in this workspace.', 'Permission Denied', { code: 'TASK_SAVE_PERMISSION_DENIED' });
                return;
            }
            if (!canMutateTask(currentTaskData, activeProject)) {
                showTaskOwnershipDenied('delete tasks');
                return;
            }

            if (!Array.isArray(activeProject.tasks)) {
                activeProject.tasks = [];
            }
            activeProject.tasks = activeProject.tasks.filter((task) => task.id !== currentTaskData.id);

            try {
                saveState({ immediate: true });
                layoutAllTasks();
                closeModals();
            } catch (error) {
                const debugContext = getTaskDebugContext(activeProject, {
                    source: 'deleteTask',
                    taskId: currentTaskData && currentTaskData.id ? currentTaskData.id : ''
                });
                console.error('Task delete failed during UI refresh', {
                    code: 'TASK_VIEW_RENDER_FAILED',
                    context: debugContext,
                    error
                });
                showErrorToast(
                    'Task deleted but failed to refresh the view. Please reload this page.',
                    'Task Delete Warning',
                    { code: 'TASK_VIEW_RENDER_FAILED' }
                );
            }
        }
    });
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read file.'));
        reader.readAsDataURL(file);
    });
}

async function handleFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showCustomConfirm({ title: 'Invalid File', message: 'Please choose an image file.' });
        e.target.value = '';
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        showCustomConfirm({ title: 'File Too Large', message: 'Please choose an image smaller than 2MB.' });
        e.target.value = '';
        return;
    }

    try {
        const dataUrl = await readFileAsDataURL(file);
        const targetInputId = e.target.id === 'taskImageFile' ? 'taskImageUrl' : 'projectBackgroundInput';
        document.getElementById(targetInputId).value = dataUrl;
    } catch (_) {
        showCustomConfirm({ title: 'Error', message: 'Could not load selected image.' });
    } finally {
        e.target.value = '';
    }
}
function formatDisplayTime(hourDecimal) {
    const hour = clamp(hourDecimal, 0, DAY_HOURS);
    const totalMinutes = Math.round(hour * 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const activeProject = getActiveProject();
    const hourFormat = getProjectHourFormat(activeProject);

    if (hourFormat === '12') {
        const suffix = hrs >= 12 ? 'PM' : 'AM';
        const adjusted = hrs % 12 === 0 ? 12 : hrs % 12;
        return `${adjusted}:${String(mins).padStart(2, '0')} ${suffix}`;
    }
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function calculateTimeString(left, width) {
    const maxWidth = state.hourWidth * DAY_HOURS;
    const safeLeft = clamp(left, 0, maxWidth);
    const safeWidth = clamp(width, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, maxWidth - safeLeft));
    const startHour = safeLeft / state.hourWidth;
    const endHour = (safeLeft + safeWidth) / state.hourWidth;
    return `${formatDisplayTime(startHour)} - ${formatDisplayTime(endHour)}`;
}

function formatTaskSchedule(taskData) {
    const baseRange = calculateTimeString(taskData.left, taskData.width);
    const startDate = isISODate(taskData.startDate) ? taskData.startDate : taskData.date;
    const endDate = isISODate(taskData.endDate) ? taskData.endDate : startDate;
    if (startDate && endDate && startDate !== endDate) {
        return `${baseRange} (${formatDisplayDateRange(startDate, endDate)})`;
    }
    return baseRange;
}

function formatTaskDateTimeSummary(taskData) {
    const startDate = isISODate(taskData.startDate) ? taskData.startDate : taskData.date;
    const endDate = isISODate(taskData.endDate) ? taskData.endDate : startDate;
    const startTime = isTimeValue(taskData.startTime) ? taskData.startTime : leftToTime(taskData.left);
    const endTime = isTimeValue(taskData.endTime) ? taskData.endTime : leftToTime(taskData.left + taskData.width);
    return formatDisplayDateTimeRange(
        { startDate, startTime, endDate, endTime },
        getProjectHourFormat(getActiveProject())
    );
}

function startResize(e, taskEl) {
    if (e.button !== 0) return;
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject || !canEditProjectTasks(activeProject)) {
        showErrorToast('You do not have permission to resize tasks in this project.', 'Permission Denied', { code: 'TASK_VIEW_PERMISSION_DENIED' });
        return;
    }
    const task = getActiveTaskById(taskEl && taskEl.dataset ? taskEl.dataset.id : '');
    if (!task || !canMutateTask(task, activeProject)) {
        showTaskOwnershipDenied('resize tasks');
        return;
    }
    e.stopPropagation();
    resizingTask = taskEl;
    taskEl.dataset.startHeight = String(taskEl.offsetHeight);
    taskEl.dataset.mouseY = String(e.clientY);
    isResizing = true;
    resizeMoved = false;
    requestAnimationFrame(dragUpdateLoop);
}

function handleDragMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (isDragging && draggingTask) {
        const pointerStartX = Number(draggingTask.dataset.pointerStartX);
        const pointerStartY = Number(draggingTask.dataset.pointerStartY);
        if (Number.isFinite(pointerStartX) && Number.isFinite(pointerStartY)) {
            if (Math.abs(mouseX - pointerStartX) > 3 || Math.abs(mouseY - pointerStartY) > 3) {
                draggingTask.dataset.suppressClick = '1';
                dragMoved = true;
            }
        }
    }
    if (isResizing && resizingTask) {
        const resizeStartY = Number(resizingTask.dataset.mouseY);
        if (Number.isFinite(resizeStartY) && Math.abs(mouseY - resizeStartY) > 2) {
            resizeMoved = true;
        }
    }
    if (isDragging || isResizing) touchMoved = true;
}

function getActiveTaskById(taskId) {
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject) return null;
    const tasks = Array.isArray(activeProject.tasks) ? activeProject.tasks : [];
    return tasks.find((task) => task.id === taskId) || null;
}

function getLaneFromPoint(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;
    return element.closest('.task-lane');
}

function dragUpdateLoop() {
    const activeProject = getActiveProject();
    const timelineSnapEnabled = false;
    const snapInterval = state.hourWidth * 0.25;
    const dayHeight = state.hourWidth * DAY_HOURS;

    if (isDragging && draggingTask) {
        const startOffsetY = Number(draggingTask.dataset.startY);
        let newTop = mouseY - startOffsetY;
        if (timelineSnapEnabled) newTop = Math.round(newTop / snapInterval) * snapInterval;
        const maxTop = Math.max(0, dayHeight - draggingTask.offsetHeight);
        newTop = clamp(newTop, 0, maxTop);

        draggingTask.style.top = `${newTop}px`;
        const timeEl = draggingTask.querySelector('.time-estimate');
        if (timeEl) timeEl.textContent = calculateTimeString(newTop, draggingTask.offsetHeight);

        const nextLane = getLaneFromPoint(mouseX, mouseY);
        if (nextLane && nextLane !== draggingTask.parentElement) {
            nextLane.appendChild(draggingTask);
        }
    }

    if (isResizing && resizingTask) {
        const diff = mouseY - Number(resizingTask.dataset.mouseY);
        const startHeight = Number(resizingTask.dataset.startHeight);
        let newHeight = startHeight + diff;

        const maxHeight = Math.max(state.hourWidth * 0.25, dayHeight - resizingTask.offsetTop);
        newHeight = clamp(newHeight, state.hourWidth * 0.25, maxHeight);
        if (timelineSnapEnabled) {
            newHeight = Math.round(newHeight / snapInterval) * snapInterval;
            newHeight = clamp(newHeight, state.hourWidth * 0.25, maxHeight);
        }

        resizingTask.style.height = `${newHeight}px`;
        const timeEl = resizingTask.querySelector('.time-estimate');
        if (timeEl) timeEl.textContent = calculateTimeString(resizingTask.offsetTop, newHeight);
    }

    if (isDragging || isResizing) {
        requestAnimationFrame(dragUpdateLoop);
    }
}

function handleDragEnd() {
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject) return;

    const dayHeight = state.hourWidth * DAY_HOURS;
    let needsLayout = false;

    if (isDragging && draggingTask && dragMoved) {
        draggingTask.style.zIndex = 2;
        const task = activeProject.tasks.find((t) => t.id === draggingTask.dataset.id);
        if (task) {
            task.left = clamp(draggingTask.offsetTop, 0, Math.max(0, dayHeight - draggingTask.offsetHeight));
            const lane = draggingTask.closest('.task-lane');
            const targetDate = lane && isISODate(lane.dataset.date) ? lane.dataset.date : task.date;
            task.startDate = targetDate;
            task.date = targetDate;
            task.startTime = leftToTime(task.left);
            task.endDate = task.startDate;
            task.endTime = leftToTime(task.left + task.width);
            task.dueTime = task.endTime;
            needsLayout = true;
        }
    } else if (isDragging && draggingTask) {
        draggingTask.style.zIndex = 2;
    }

    if (isResizing && resizingTask && resizeMoved) {
        const task = activeProject.tasks.find((t) => t.id === resizingTask.dataset.id);
        if (task) {
            task.width = clamp(resizingTask.offsetHeight, state.hourWidth * 0.25, Math.max(state.hourWidth * 0.25, dayHeight - resizingTask.offsetTop));
            task.endDate = isISODate(task.startDate) ? task.startDate : task.date;
            task.endTime = leftToTime(task.left + task.width);
            task.dueTime = task.endTime;
            needsLayout = true;
        }
    }

    isDragging = false;
    isResizing = false;
    dragMoved = false;
    resizeMoved = false;
    draggingTask = null;
    resizingTask = null;
    touchMoved = false;

    if (needsLayout) {
        try {
            saveState();
            layoutAllTasks();
        } catch (error) {
            const activeContextProject = getActiveProject();
            const context = getTaskDebugContext(activeContextProject, {
                source: 'handleDragEnd',
                isDragging: Boolean(dragMoved),
                isResizing: Boolean(resizeMoved)
            });
            console.error('Task drag/resize failed during UI refresh', {
                code: 'TASK_VIEW_RENDER_FAILED',
                context,
                error
            });
            showErrorToast(
                'Task updated but failed to refresh timeline/board. Please reload this page.',
                'Task Move Warning',
                { code: 'TASK_VIEW_RENDER_FAILED' }
            );
        }
    }
}

function showContextMenu(menuId, x, y) {
    hideContextMenus();
    const menu = document.getElementById(menuId);
    if (!menu) return;
    menu.style.display = 'block';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

function hideContextMenus() {
    document.querySelectorAll('.context-menu').forEach((menu) => {
        menu.style.display = 'none';
    });
}

function switchTaskStatus(taskId, nextStatus) {
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject) {
        showErrorToast('No active project selected.', 'Task Error', { code: 'TASK_VIEW_RUNTIME' });
        return;
    }
    if (!TASK_STATUSES.includes(nextStatus)) {
        showErrorToast('Invalid task status requested.', 'Task Error', { code: 'TASK_VIEW_VALIDATION_FAILED' });
        return;
    }
    if (!canEditProjectTasks(activeProject)) {
        showCustomConfirm({
            title: 'Read-only Mode',
            message: 'You do not have permission to change task status.'
        });
        showErrorToast('You do not have permission to change task status.', 'Permission Denied', { code: 'TASK_VIEW_PERMISSION_DENIED' });
        return;
    }
    if (!Array.isArray(activeProject.tasks)) {
        activeProject.tasks = [];
    }
    const task = activeProject.tasks.find((item) => item.id === taskId);
    if (!task) {
        showErrorToast('Task no longer exists. Please refresh and try again.', 'Task Error', { code: 'TASK_VIEW_RUNTIME' });
        return;
    }
    if (!canMutateTask(task, activeProject)) {
        showTaskOwnershipDenied('change task status');
        return;
    }
    task.status = nextStatus;
    try {
        saveState();
        layoutAllTasks();
    } catch (error) {
        const context = getTaskDebugContext(activeProject, {
            source: 'switchTaskStatus',
            taskId,
            nextStatus
        });
        console.error('Task status update failed during UI refresh', {
            code: 'TASK_VIEW_RENDER_FAILED',
            context,
            error
        });
        showErrorToast(
            'Task status changed but failed to refresh the view. Please reload this page.',
            'Task Status Warning',
            { code: 'TASK_VIEW_RENDER_FAILED' }
        );
    }
}

function cycleTaskStatus(taskId) {
    const task = getActiveTaskById(taskId);
    if (!task) return;
    const idx = TASK_STATUSES.indexOf(task.status);
    const nextStatus = TASK_STATUSES[(idx + 1) % TASK_STATUSES.length];
    switchTaskStatus(taskId, nextStatus);
}

function renderTask(taskData) {
    const dayLane = document.querySelector(`.task-lane[data-date="${taskData.date}"]`);
    if (!dayLane) return;

    const activeProject = state.projects.find((p) => p.active);
    const editable = canMutateTask(taskData, activeProject);
    const member = activeProject && Array.isArray(activeProject.members)
        ? activeProject.members.find((m) => m.name === taskData.memberName)
        : null;
    const isOwnedTask = isTaskOwnedByCurrentUser(taskData);
    const assigneeColor = resolveTaskAssigneeColor(taskData, member);
    const layoutMeta = state.timelineLayout.layoutByTaskId.get(taskData.id) || { trackIndex: 0, trackCount: 1 };
    const trackWidthPercent = 100 / Math.max(1, layoutMeta.trackCount);

    const taskEl = document.createElement('div');
    taskEl.className = 'task-card';
    taskEl.dataset.id = taskData.id;
    taskEl.style.left = `calc(${(layoutMeta.trackIndex * trackWidthPercent).toFixed(6)}% + 2px)`;
    taskEl.style.width = `calc(${trackWidthPercent.toFixed(6)}% - 4px)`;
    taskEl.style.top = `${taskData.left}px`;
    taskEl.style.height = `${taskData.width}px`;
    taskEl.tabIndex = 0;
    taskEl.style.background = `linear-gradient(135deg, ${hexToRgba(assigneeColor, isOwnedTask ? 0.62 : 0.26)} 0%, ${hexToRgba(assigneeColor, isOwnedTask ? 0.42 : 0.14)} 100%)`;
    taskEl.style.borderColor = isOwnedTask
        ? hexToRgba(assigneeColor, 0.5)
        : hexToRgba(assigneeColor, 0.22);
    if (!editable) {
        taskEl.classList.add('task-readonly');
        taskEl.dataset.readonly = '1';
    }

    if (taskData.image) {
        const img = document.createElement('img');
        img.src = taskData.image;
        img.className = 'task-img';
        img.alt = 'task';
        taskEl.appendChild(img);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'task-name';
    nameEl.textContent = taskData.name;
    taskEl.appendChild(nameEl);

    const timeEl = document.createElement('div');
    timeEl.className = 'time-estimate';
    timeEl.textContent = formatTaskSchedule(taskData);
    taskEl.appendChild(timeEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'status-indicator';
    statusEl.textContent = `${taskData.status} | ${taskData.priority}${editable ? '' : ' | Read only'}`;
    taskEl.appendChild(statusEl);

    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    if (!editable) {
        resizer.style.display = 'none';
    }
    resizer.addEventListener('mousedown', (e) => startResize(e, taskEl));
    taskEl.appendChild(resizer);

    taskEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentContextTaskData = taskData;
        showContextMenu('contextMenu', e.pageX, e.pageY);
    });

    let clickIntentTimer = null;
    taskEl.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        if (e.target.classList.contains('resizer')) return;
        if (taskEl.dataset.suppressClick === '1') {
            taskEl.dataset.suppressClick = '0';
            return;
        }
        if (clickIntentTimer) {
            clearTimeout(clickIntentTimer);
        }
        clickIntentTimer = setTimeout(() => {
            openTaskDetail(taskData);
            clickIntentTimer = null;
        }, 180);
    });

    taskEl.addEventListener('dblclick', (e) => {
        if (e.button !== 0) return;
        if (e.target.classList.contains('resizer')) return;
        if (clickIntentTimer) {
            clearTimeout(clickIntentTimer);
            clickIntentTimer = null;
        }
        if (!editable) {
            openTaskDetail(taskData);
            return;
        }
        openTaskModal(taskData);
    });

    taskEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.classList.contains('resizer')) return;
        if (!editable) {
            showErrorToast('You do not have permission to move tasks in this project.', 'Permission Denied', { code: 'TASK_VIEW_PERMISSION_DENIED' });
            return;
        }
        draggingTask = taskEl;
        dragMoved = false;
        taskEl.dataset.startY = String(e.clientY - taskEl.offsetTop);
        taskEl.dataset.pointerStartX = String(e.clientX);
        taskEl.dataset.pointerStartY = String(e.clientY);
        taskEl.dataset.suppressClick = '0';
        taskEl.style.zIndex = 10;
        isDragging = true;
        touchMoved = false;
        requestAnimationFrame(dragUpdateLoop);
    });

    taskEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (editable) {
                openTaskModal(taskData);
            } else {
                openTaskDetail(taskData);
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (!editable) return;
            e.preventDefault();
            currentTaskData = taskData;
            deleteTask();
        } else if (e.key.toLowerCase() === 'e') {
            if (!editable) return;
            e.preventDefault();
            openTaskModal(taskData);
        } else if (e.key.toLowerCase() === 's') {
            if (!editable) return;
            e.preventDefault();
            cycleTaskStatus(taskData.id);
        }
    });

    taskEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchMoved = false;
        longPressOpened = false;
        const touch = e.touches[0];
        longPressTimer = setTimeout(() => {
            currentContextTaskData = taskData;
            showContextMenu('contextMenu', touch.clientX, touch.clientY);
            longPressOpened = true;
        }, 500);
    }, { passive: true });

    taskEl.addEventListener('touchmove', () => {
        touchMoved = true;
        if (longPressTimer) clearTimeout(longPressTimer);
    }, { passive: true });

    taskEl.addEventListener('touchend', () => {
        if (longPressTimer) clearTimeout(longPressTimer);
        if (!touchMoved && !longPressOpened) {
            openTaskDetail(taskData);
        }
    });

    dayLane.appendChild(taskEl);
}

function sortTasksForBoard(tasks) {
    return [...tasks].sort((a, b) => {
        const aDate = isISODate(a.startDate) ? a.startDate : (isISODate(a.date) ? a.date : '9999-12-31');
        const bDate = isISODate(b.startDate) ? b.startDate : (isISODate(b.date) ? b.date : '9999-12-31');
        if (aDate !== bDate) return aDate.localeCompare(bDate);

        const aTime = isTimeValue(a.startTime) ? a.startTime : leftToTime(a.left);
        const bTime = isTimeValue(b.startTime) ? b.startTime : leftToTime(b.left);
        if (aTime !== bTime) return aTime.localeCompare(bTime);

        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function openNewTaskForStatus(status) {
    openTaskModal(null, true);
    if (!TASK_STATUSES.includes(status)) return;
    const statusSelect = document.getElementById('taskStatusSelect');
    if (!statusSelect) return;
    statusSelect.value = status;
    updateSelectColor({ target: statusSelect });
}

function createKanbanTaskCard(taskData, activeProject, editable) {
    const member = activeProject.members.find((m) => m.name === taskData.memberName);
    const isOwnedTask = isTaskOwnedByCurrentUser(taskData);
    const assigneeColor = resolveTaskAssigneeColor(taskData, member);
    const taskEl = document.createElement('article');
    taskEl.className = 'kanban-task-card';
    taskEl.dataset.id = taskData.id;
    taskEl.tabIndex = 0;
    taskEl.draggable = editable;
    if (!editable) {
        taskEl.classList.add('task-readonly');
    }

    taskEl.style.borderLeftColor = isOwnedTask
        ? hexToRgba(assigneeColor, 0.85)
        : hexToRgba(assigneeColor, 0.38);
    taskEl.style.background = `linear-gradient(135deg, ${hexToRgba(assigneeColor, isOwnedTask ? 0.42 : 0.2)} 0%, ${hexToRgba(assigneeColor, isOwnedTask ? 0.22 : 0.1)} 100%)`;

    if (taskData.image) {
        const img = document.createElement('img');
        img.src = taskData.image;
        img.alt = 'task';
        img.className = 'kanban-task-img';
        taskEl.appendChild(img);
    }

    const title = document.createElement('div');
    title.className = 'kanban-task-title';
    title.textContent = taskData.name;
    taskEl.appendChild(title);

    const schedule = document.createElement('div');
    schedule.className = 'kanban-task-meta';
    schedule.textContent = formatTaskSchedule(taskData);
    taskEl.appendChild(schedule);

    const badges = document.createElement('div');
    badges.className = 'kanban-task-badges';

    const priority = document.createElement('span');
    const priorityClass = String(taskData.priority || 'medium').toLowerCase().replace(/\s+/g, '-');
    priority.className = `kanban-task-priority priority-${priorityClass}`;
    priority.textContent = String(taskData.priority || 'Medium');
    badges.appendChild(priority);

    if (taskData.memberName) {
        const memberBadge = document.createElement('span');
        memberBadge.className = 'kanban-task-chip';
        memberBadge.textContent = taskData.memberName;
        badges.appendChild(memberBadge);
    }
    if (!editable) {
        const readonlyBadge = document.createElement('span');
        readonlyBadge.className = 'kanban-task-chip';
        readonlyBadge.textContent = 'Read only';
        badges.appendChild(readonlyBadge);
    }

    const hasEndDate = isISODate(taskData.endDate);
    const hasEndTime = isTimeValue(taskData.endTime);
    if (hasEndDate || hasEndTime) {
        const dueBadge = document.createElement('span');
        dueBadge.className = 'kanban-task-chip due';
        dueBadge.textContent = formatDueLabel(
            {
                date: hasEndDate ? taskData.endDate : '',
                time: hasEndTime ? taskData.endTime : '',
            },
            getProjectHourFormat(getActiveProject())
        );
        if (dueBadge.textContent) {
            badges.appendChild(dueBadge);
        }
    }
    taskEl.appendChild(badges);

    const actions = document.createElement('div');
    actions.className = 'kanban-task-actions';
    if (editable) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'kanban-action-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openTaskModal(taskData);
        });
        actions.appendChild(editBtn);
    }
    taskEl.appendChild(actions);

    let cardClickIntentTimer = null;
    taskEl.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (cardClickIntentTimer) {
            clearTimeout(cardClickIntentTimer);
        }
        cardClickIntentTimer = setTimeout(() => {
            openTaskDetail(taskData);
            cardClickIntentTimer = null;
        }, 180);
    });
    taskEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        if (cardClickIntentTimer) {
            clearTimeout(cardClickIntentTimer);
            cardClickIntentTimer = null;
        }
        if (!editable) {
            openTaskDetail(taskData);
            return;
        }
        openTaskModal(taskData);
    });
    taskEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentContextTaskData = taskData;
        showContextMenu('contextMenu', e.pageX, e.pageY);
    });
    taskEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (editable) {
                openTaskModal(taskData);
            } else {
                openTaskDetail(taskData);
            }
        } else if (e.key.toLowerCase() === 's') {
            if (!editable) return;
            e.preventDefault();
            cycleTaskStatus(taskData.id);
        }
    });
    taskEl.addEventListener('dragstart', (e) => {
        if (!editable) {
            e.preventDefault();
            showErrorToast('You do not have permission to move tasks in this project.', 'Permission Denied', { code: 'TASK_VIEW_PERMISSION_DENIED' });
            return;
        }
        taskEl.classList.add('dragging');
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', taskData.id);
    });
    taskEl.addEventListener('dragend', () => {
        taskEl.classList.remove('dragging');
    });

    return taskEl;
}

function renderKanban(filteredTasks, activeProject) {
    const container = document.getElementById('kanbanContainer');
    if (!container || !activeProject) return;
    const editable = canEditProjectTasks(activeProject);

    container.textContent = '';

    const grouped = {};
    TASK_STATUSES.forEach((status) => { grouped[status] = []; });

    filteredTasks.forEach((task) => {
        const status = TASK_STATUSES.includes(task.status) ? task.status : 'Not Started';
        grouped[status].push(task);
    });

    TASK_STATUSES.forEach((status) => {
        const column = document.createElement('section');
        column.className = 'kanban-column';
        column.dataset.status = status;

        const header = document.createElement('div');
        header.className = 'kanban-column-header';

        const title = document.createElement('div');
        title.className = 'kanban-column-title';
        title.textContent = status;
        header.appendChild(title);

        const count = document.createElement('div');
        count.className = 'kanban-column-count';
        count.textContent = String(grouped[status].length);
        header.appendChild(count);

        column.appendChild(header);

        const list = document.createElement('div');
        list.className = 'kanban-task-list';
        const sorted = sortTasksForBoard(grouped[status]);
        if (sorted.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'kanban-column-empty';
            empty.textContent = 'No tasks';
            list.appendChild(empty);
        } else {
            sorted.forEach((task) => {
                const taskEditable = canMutateTask(task, activeProject);
                list.appendChild(createKanbanTaskCard(task, activeProject, taskEditable));
            });
        }
        column.appendChild(list);

        const addTaskBtn = document.createElement('button');
        addTaskBtn.type = 'button';
        addTaskBtn.className = 'kanban-add-btn';
        addTaskBtn.textContent = '+ Add Task';
        addTaskBtn.disabled = !editable;
        if (!editable) {
            addTaskBtn.title = 'You do not have permission to add task in this workspace.';
        }
        addTaskBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!editable) {
                showErrorToast('You do not have permission to create tasks in this workspace.', 'Permission Denied', {
                    code: 'TASK_SAVE_PERMISSION_DENIED'
                });
                return;
            }
            openNewTaskForStatus(status);
        });
        column.appendChild(addTaskBtn);

        column.addEventListener('dragover', (e) => {
            e.preventDefault();
            column.classList.add('drag-over');
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        column.addEventListener('dragleave', (e) => {
            if (!column.contains(e.relatedTarget)) column.classList.remove('drag-over');
        });
        column.addEventListener('drop', (e) => {
            e.preventDefault();
            column.classList.remove('drag-over');
            if (!editable) return;
            if (!e.dataTransfer) return;
            const taskId = e.dataTransfer.getData('text/plain');
            if (!taskId) return;
            switchTaskStatus(taskId, status);
        });

        container.appendChild(column);
    });
}

function renderProjects() {
    const projectList = document.getElementById('projectList');
    if (!projectList) return;
    const addProjectEl = projectList.querySelector('.add-project');
    projectList.querySelectorAll('li:not(.add-project)').forEach((li) => li.remove());

    const sortedProjects = sortProjectsByRecentAccess(state.projects);
    sortedProjects.forEach((project) => {
        const li = document.createElement('li');
        li.dataset.id = project.id;
        li.tabIndex = 0;
        if (project.active) li.className = 'active-project';
        if (project.starred) li.classList.add('starred');

        const dot = document.createElement('span');
        dot.className = 'dot';
        li.appendChild(dot);
        li.appendChild(document.createTextNode(` ${project.name}`));

        if (project.starred) {
            const badge = document.createElement('span');
            badge.className = 'star-badge';
            badge.textContent = '*';
            li.appendChild(badge);
        }

        li.addEventListener('click', (e) => {
            e.stopPropagation();
            switchProject(project.id);
        });

        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                switchProject(project.id);
            }
        });

        if (addProjectEl) {
            projectList.insertBefore(li, addProjectEl);
            return;
        }
        projectList.appendChild(li);
    });
}

function openRenamePopup(projectId, anchorEl) {
    const popup = document.getElementById('renamePopup');
    const input = document.getElementById('renameInput');
    const project = state.projects.find((p) => p.id === projectId);
    if (!popup || !input || !project) return;

    currentContextMenuProjectId = projectId;
    input.value = project.name;
    const rect = anchorEl.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX + 16}px`;
    popup.style.top = `${rect.bottom + window.scrollY + 8}px`;
    popup.style.display = 'block';
    input.focus();
    input.select();
}

function renameProjectFromPopup() {
    const input = document.getElementById('renameInput');
    const popup = document.getElementById('renamePopup');
    const newName = sanitizeText(input.value, 80);
    if (!newName || !currentContextMenuProjectId) {
        popup.style.display = 'none';
        return;
    }

    const project = state.projects.find((p) => p.id === currentContextMenuProjectId);
    if (project) {
        project.name = newName;
        saveState();
        renderProjects();
        updateUIAfterProjectSwitch();
    }
    popup.style.display = 'none';
}

function toggleProjectStar() {
    const project = state.projects.find((p) => p.id === currentContextMenuProjectId);
    if (project) {
        project.starred = !project.starred;
        saveState();
        renderProjects();
    }
    hideContextMenus();
}

async function confirmDeleteProject() {
    hideContextMenus();

    const targetProject = (
        currentContextMenuProjectId
            ? state.projects.find((project) => project.id === currentContextMenuProjectId)
            : null
    ) || getActiveProject();
    if (!targetProject) {
        showErrorToast('Select a workspace first.', 'Workspace Error', {
            code: 'WORKSPACE_DELETE_NO_ACTIVE'
        });
        return;
    }

    const workspaceId = getProjectWorkspaceId(targetProject) || (isUuid(targetProject.id) ? targetProject.id : '');
    if (!isUuid(workspaceId)) {
        showErrorToast('Workspace identifier is invalid. Please refresh and try again.', 'Workspace Error', {
            code: 'WORKSPACE_DELETE_INVALID_ID'
        });
        return;
    }

    if (!canDeleteWorkspace(targetProject)) {
        showErrorToast('Only workspace owner can delete this workspace.', 'Permission Denied', {
            code: 'WORKSPACE_DELETE_FORBIDDEN'
        });
        return;
    }

    if (
        !hasTaskApiClient() ||
        !window.OrbitTaskApi.getToken() ||
        typeof window.OrbitTaskApi.deleteWorkspace !== 'function'
    ) {
        showErrorToast('Workspace delete is unavailable. Please sign in again and retry.', 'Delete Unavailable', {
            code: 'WORKSPACE_DELETE_API_UNAVAILABLE'
        });
        return;
    }

    const deleteLockKey = `workspace:delete:${workspaceId}`;
    if (!acquireMutationLock(deleteLockKey)) {
        showErrorToast('Workspace deletion is already running. Please wait.', 'Workspace Busy', {
            code: 'WORKSPACE_DELETE_LOCKED'
        });
        return;
    }

    try {
        const stepOneConfirmed = await confirmDialogAsync(
            'Delete Workspace',
            `Delete workspace ${targetProject.name}? This action cannot be undone.`
        );
        if (!stepOneConfirmed) {
            return;
        }

        const stepTwoConfirmed = await confirmWorkspaceDeletionByName(targetProject.name);
        if (!stepTwoConfirmed) {
            return;
        }

        await window.OrbitTaskApi.deleteWorkspace(workspaceId, { workspaceId });

        state.projects = state.projects.filter((project) => getProjectWorkspaceId(project) !== workspaceId && project.id !== workspaceId);
        delete state.workspaceDisplaySettings[workspaceId];
        persistWorkspaceDisplaySettings();
        delete state.projectAccessIndex[workspaceId];
        writeProjectAccessIndex();

        const nextProject = sortProjectsByRecentAccess(state.projects)[0] || null;
        state.projects.forEach((project) => {
            project.active = Boolean(nextProject && project.id === nextProject.id);
        });

        if (nextProject) {
            const nextWorkspaceId = getProjectWorkspaceId(nextProject);
            if (nextWorkspaceId) {
                applyActiveWorkspace(nextWorkspaceId);
            }
            markProjectAccessed(nextProject.id);
        } else {
            state.remoteSync.workspaceId = '';
            delete window.__ORBIT_ACTIVE_WORKSPACE_ID;
            localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
            if (realtimeSync && typeof realtimeSync.setWorkspaceId === 'function') {
                realtimeSync.setWorkspaceId('');
            }
        }

        saveState({ immediate: true, skipRemoteSync: true });
        renderProjects();
        updateUIAfterProjectSwitch();
        showErrorToast('Workspace deleted successfully.', 'Workspace Deleted', 2200, {
            code: 'WORKSPACE_DELETED'
        });
    } catch (error) {
        console.warn('Unable to delete workspace:', error);
        const errorCode = readErrorCodeFromError(error) || 'WORKSPACE_DELETE_FAILED';
        let message = 'Unable to delete workspace right now. Please try again.';
        if (errorCode === 'WORKSPACE_FORBIDDEN' || errorCode === 'WORKSPACE_DELETE_FORBIDDEN') {
            message = 'Only workspace owner can delete this workspace.';
        } else if (errorCode === 'WORKSPACE_NOT_FOUND') {
            message = 'Workspace was already removed.';
        }
        showErrorToast(message, 'Workspace Delete Failed', { code: errorCode });
    } finally {
        releaseMutationLock(deleteLockKey);
    }
}

function addNewProject(e) {
    if (e) e.stopPropagation();
    currentContextMenuProjectId = null;
    setMobileSidebarOpen(false);
    void openWorkspaceSettingsModal({ mode: 'create' });
}

function switchProject(id) {
    const target = state.projects.find((project) => project.id === id);
    if (!target) {
        showErrorToast('Project not found or no longer accessible.', 'Project Error');
        return;
    }
    state.projects.forEach((p) => { p.active = p.id === id; });
    markProjectAccessed(id);
    const workspaceId = getProjectWorkspaceId(target);
    if (workspaceId) {
        applyActiveWorkspace(workspaceId);
    }
    saveState({ skipRemoteSync: true });
    renderProjects();
    updateUIAfterProjectSwitch();
    setMobileSidebarOpen(false);
}

function getActiveProject() {
    return state.projects.find((project) => project.active) || null;
}

function syncSidebarProfile() {
    const raw = safeParseJSON(localStorage.getItem('orbitSettings'));
    const authUser = safeParseJSON(localStorage.getItem('authUser'));
    const settings = sanitizeBoardSettings(raw);
    const settingsDisplayName =
        raw && raw.account && typeof raw.account.displayName === 'string'
            ? sanitizeText(raw.account.displayName, 50)
            : '';
    const authDisplayName =
        authUser && typeof authUser === 'object'
            ? sanitizeText(
                (typeof authUser.fullName === 'string' && authUser.fullName.trim()) ||
                (typeof authUser.username === 'string' && authUser.username.trim()) ||
                (typeof authUser.email === 'string' ? authUser.email.split('@')[0] : ''),
                50,
            )
            : '';
    const displayName = authDisplayName || settingsDisplayName;
    const nameEl = document.getElementById('sidebarName');
    if (nameEl && displayName) {
        nameEl.textContent = displayName;
    }

    const avatarEl = document.getElementById('sidebarAvatar');
    const activeProject = getActiveProject();
    const projectInitial = resolveProjectAvatarInitial(activeProject);
    const avatarData = raw && raw.account && typeof raw.account.avatarDataUrl === 'string' ? sanitizeImageUrl(raw.account.avatarDataUrl) : '';
    const useProjectAvatar = state.ui.sidebarCollapsed || !avatarData;
    if (avatarEl) {
        if (useProjectAvatar) {
            avatarEl.textContent = projectInitial;
            avatarEl.classList.add('project-avatar');
        } else if (avatarData) {
            avatarEl.textContent = '';
            avatarEl.classList.remove('project-avatar');
            const img = document.createElement('img');
            img.src = avatarData;
            img.alt = 'avatar';
            avatarEl.appendChild(img);
        } else {
            avatarEl.textContent = projectInitial;
            avatarEl.classList.add('project-avatar');
        }
    }
    state.settings = settings;
    updateProfileConnectionDot();
}

function openTaskDetail(taskData) {
    const activeProject = state.projects.find((p) => p.active);
    const member = activeProject?.members.find((m) => m.name === taskData.memberName);
    const memberColor = resolveTaskAssigneeColor(taskData, member);

    const existing = document.getElementById('taskDetailModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'taskDetailModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:linear-gradient(135deg,#0d0d1a 0%,#111128 100%);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 28px 22px;min-width:320px;max-width:420px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.05);position:relative;';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'x';
    closeBtn.style.cssText = 'position:absolute;top:12px;right:14px;cursor:pointer;color:#777;font-size:14.16px;line-height:1;border:none;background:transparent;';
    closeBtn.addEventListener('click', () => modal.remove());
    panel.appendChild(closeBtn);

    const accent = document.createElement('div');
    accent.style.cssText = `width:36px;height:3px;border-radius:2px;background:${memberColor};margin-bottom:16px;`;
    panel.appendChild(accent);

    if (taskData.image) {
        const img = document.createElement('img');
        img.src = taskData.image;
        img.alt = 'task';
        img.style.cssText = 'width:100%;border-radius:8px;margin-bottom:14px;max-height:140px;object-fit:cover;';
        panel.appendChild(img);
    }

    const title = document.createElement('div');
    title.textContent = taskData.name;
    title.style.cssText = 'font-size:21.24px;font-weight:700;color:#fff;margin-bottom:14px;line-height:1.3;';
    panel.appendChild(title);

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    panel.appendChild(meta);

    const timeRow = document.createElement('div');
    timeRow.style.cssText = 'font-size:15.34px;color:rgba(255,255,255,0.75);';
    timeRow.textContent = `${formatTaskSchedule(taskData)} | ${formatTaskDateTimeSummary(taskData)}`;
    meta.appendChild(timeRow);

    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'font-size:15.34px;color:rgba(255,255,255,0.75);';
    statusRow.textContent = `${taskData.status} | Priority ${taskData.priority}`;
    meta.appendChild(statusRow);

    if (taskData.memberName) {
        const memberRow = document.createElement('div');
        memberRow.style.cssText = 'font-size:15.34px;color:rgba(255,255,255,0.75);';
        memberRow.textContent = `Assignee: ${taskData.memberName}`;
        meta.appendChild(memberRow);
    }
    if (taskData.note) {
        const noteRow = document.createElement('div');
        noteRow.style.cssText = 'font-size:15.34px;color:rgba(255,255,255,0.75);line-height:1.5;';
        noteRow.textContent = taskData.note;
        meta.appendChild(noteRow);
    }

    const actionWrap = document.createElement('div');
    actionWrap.style.cssText = 'margin-top:16px;border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
    panel.appendChild(actionWrap);

    ['Not Started', 'In Progress', 'Done'].forEach((status) => {
        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.textContent = status;
        statusBtn.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12.98px;';
        statusBtn.addEventListener('click', () => {
            switchTaskStatus(taskData.id, status);
            modal.remove();
        });
        actionWrap.appendChild(statusBtn);
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit Task';
    editBtn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;padding:7px 16px;border-radius:8px;cursor:pointer;font-size:14.16px;';
    editBtn.addEventListener('click', () => {
        modal.remove();
        openTaskModal(taskData);
    });
    actionWrap.appendChild(editBtn);

    modal.appendChild(panel);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function applyTaskFilters(tasks) {
    const sourceTasks = Array.isArray(tasks) ? tasks : [];
    const text = state.filters.text;
    const status = state.filters.status;
    const member = state.filters.member;
    return sourceTasks.filter((task) => {
        if (status !== 'All' && task.status !== status) return false;
        if (member !== 'All' && task.memberName !== member) return false;
        if (!text) return true;
        const haystack = `${task.name} ${task.note} ${task.memberName} ${task.status}`.toLowerCase();
        return haystack.includes(text);
    });
}

function updateEmptyState(mode) {
    const wrapper = getActiveBoardWrapper();
    document.querySelectorAll('.board-empty-state').forEach((el) => {
        if (!wrapper || el.parentElement !== wrapper || !mode) {
            el.style.display = 'none';
        }
    });
    if (!wrapper) return;

    let empty = wrapper.querySelector('.board-empty-state');
    if (!empty) {
        empty = document.createElement('div');
        empty.className = 'board-empty-state';
        wrapper.appendChild(empty);
    }

    if (!mode) {
        empty.style.display = 'none';
        return;
    }

    empty.style.display = 'flex';
    empty.textContent = '';

    const title = document.createElement('div');
    title.className = 'empty-title';
    const sub = document.createElement('div');
    sub.className = 'empty-sub';

    if (mode === 'no-project') {
        title.textContent = 'No workspaces yet';
        sub.textContent = 'Use New Workspace in the sidebar to create your first workspace.';
    } else if (mode === 'no-results') {
        title.textContent = 'No matching tasks';
        sub.textContent = 'Adjust search or filters to see tasks.';
    } else {
        title.textContent = 'No tasks yet';
        sub.textContent = 'Click any time slot in the calendar to create your first task.';
    }

    empty.appendChild(title);
    empty.appendChild(sub);
}

function updateUIAfterProjectSwitch() {
    const activeProject = getActiveProject();
    populateTaskFilterMembers(activeProject || null);

    if (!activeProject) {
        document.getElementById('projectName').textContent = 'No Workspace';
        applyTimelineRangeLayout(7);
        document.body.style.backgroundImage = 'none';
        document.getElementById('daysGrid').innerHTML = '';
        document.getElementById('hoursScale').innerHTML = '';
        const kanbanContainer = document.getElementById('kanbanContainer');
        if (kanbanContainer) kanbanContainer.innerHTML = '';
        document.querySelectorAll('.task-card').forEach((task) => task.remove());
        document.querySelectorAll('.kanban-task-card').forEach((task) => task.remove());
        updateEmptyState('no-project');
        syncSidebarProfile();
        return;
    }

    document.getElementById('projectName').textContent = `${activeProject.name}`;
    setProjectWorkspaceDisplaySettings(activeProject, {
        startDate: getProjectTimelineStartDate(activeProject),
        endDate: getProjectTimelineEndDate(activeProject),
        hourFormat: getProjectHourFormat(activeProject),
        showWeekends: getProjectShowWeekends(activeProject),
        weekStart: getProjectWeekStart(activeProject),
        defaultDuration: getProjectDefaultDurationHours(activeProject),
    });
    document.body.style.backgroundImage = activeProject.background ? `url(${activeProject.background})` : 'none';
    layoutAllTasks();
    syncSidebarProfile();
}

function scrollToTaskSchedule(dateISO, left = 0) {
    const container = document.querySelector('.timeline-container');
    const lane = document.querySelector(`.task-lane[data-date="${dateISO}"]`);
    if (!container || !lane) return;

    const laneParent = lane.parentElement;
    container.scrollTop = Math.max(0, left - state.hourWidth * 1.5);
    if (laneParent) {
        container.scrollLeft = Math.max(0, laneParent.offsetLeft - 80);
    }
}

function layoutAllTasks() {
    const activeProject = state.projects.find((p) => p.active);
    if (!activeProject) {
        updateEmptyState('no-project');
        return;
    }

    const allTasks = Array.isArray(activeProject.tasks) ? activeProject.tasks : [];
    const filteredTasks = applyTaskFilters(allTasks);
    if (state.viewMode === 'board') {
        renderKanban(filteredTasks, activeProject);
    } else {
        const taskDates = allTasks.flatMap((task) => [task.date, task.endDate]).filter(isISODate);
        initTimeline(taskDates);

        const tasksByDay = {};
        state.timelineLayout.layoutByTaskId = new Map();
        document.querySelectorAll('.task-lane').forEach((lane) => {
            tasksByDay[lane.dataset.date] = [];
        });

        filteredTasks.forEach((task) => {
            if (tasksByDay[task.date]) tasksByDay[task.date].push(task);
        });

        Object.keys(tasksByDay).forEach((date) => {
            const tasksForDay = tasksByDay[date].sort((a, b) => a.left - b.left);
            const tracks = [];
            tasksForDay.forEach((task) => {
                let placed = false;
                for (let i = 0; i < tracks.length; i++) {
                    const conflicts = tracks[i].some((t) => task.left < t.left + t.width && t.left < task.left + task.width);
                    if (!conflicts) {
                        tracks[i].push(task);
                        task.track = i;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    task.track = tracks.length;
                    tracks.push([task]);
                }
            });
            const trackCount = Math.max(1, tracks.length);
            tasksForDay.forEach((task) => {
                state.timelineLayout.layoutByTaskId.set(task.id, {
                    trackIndex: Number.isFinite(task.track) ? task.track : 0,
                    trackCount
                });
            });
        });

        document.querySelectorAll('.task-card').forEach((task) => task.remove());
        filteredTasks.forEach((task) => renderTask(task));
    }

    if (filteredTasks.length === 0) {
        updateEmptyState(allTasks.length === 0 ? 'no-tasks' : 'no-results');
    } else {
        updateEmptyState(null);
    }

    if (state.viewMode === 'timeline' && !state.didInitialScroll) {
        const todayColumn = document.querySelector('.week-day-column.today-column');
        const timelineContainer = document.querySelector('.timeline-container');
        if (todayColumn && timelineContainer) {
            setTimeout(() => {
                timelineContainer.scrollLeft = Math.max(0, todayColumn.offsetLeft - 120);
            }, 80);
        }
        state.didInitialScroll = true;
    }
}

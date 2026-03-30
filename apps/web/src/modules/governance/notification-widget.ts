import {
  connectNotificationsStream,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './governance-api';
import { getToken } from '../../core/auth/session';

const WIDGET_STYLE_ID = 'orbit-notification-widget-style';

function ensureStyle(): void {
  if (document.getElementById(WIDGET_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = WIDGET_STYLE_ID;
  style.textContent = `
  .orbit-notify-wrap { position: relative; display: inline-flex; margin-left: 10px; }
  .orbit-notify-btn { border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.88); border-radius: 12px; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; line-height: 1; }
  .orbit-notify-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.28); }
  .orbit-notify-badge { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; border-radius: 999px; background: rgba(255,255,255,0.9); color: #000; font-size: 11px; line-height: 18px; text-align: center; padding: 0 5px; }
  .orbit-notify-panel { position: absolute; right: 0; top: 44px; width: min(420px, 90vw); max-height: 60vh; overflow: auto; background: rgba(12,12,14,0.98); border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; box-shadow: 0 24px 56px rgba(0,0,0,0.45); z-index: 99; }
  .orbit-notify-panel[hidden] { display: none; }
  .orbit-notify-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.92); font-size: 14px; }
  .orbit-notify-head button { background: transparent; border: 0; color: rgba(255,255,255,0.7); cursor: pointer; }
  .orbit-notify-list { list-style: none; margin: 0; padding: 0; }
  .orbit-notify-item { padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); cursor: pointer; }
  .orbit-notify-item:last-child { border-bottom: 0; }
  .orbit-notify-item.unread { background: rgba(255,255,255,0.05); }
  .orbit-notify-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; color: rgba(255,255,255,0.95); }
  .orbit-notify-body { font-size: 12px; opacity: 0.84; margin-bottom: 4px; }
  .orbit-notify-time { font-size: 11px; opacity: 0.64; }
  .orbit-notify-empty { padding: 14px 12px; color: rgba(255,255,255,0.64); font-size: 13px; }
  `;
  document.head.appendChild(style);
}

function formatTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString();
}

function toNotificationRows(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
}

export function mountNotificationWidget(): void {
  if (!getToken()) {
    return;
  }

  const host =
    document.querySelector<HTMLElement>('.header-governance-actions') ||
    document.querySelector<HTMLElement>('.content-header .header-right') ||
    document.querySelector<HTMLElement>('.content-header');
  if (!host || host.querySelector('.orbit-notify-wrap')) {
    return;
  }

  ensureStyle();

  const wrap = document.createElement('div');
  wrap.className = 'orbit-notify-wrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'orbit-notify-btn';
  button.setAttribute('aria-label', 'Notifications');
  button.setAttribute('title', 'Notifications');
  button.textContent = '◌';

  const badge = document.createElement('span');
  badge.className = 'orbit-notify-badge';
  badge.hidden = true;

  const panel = document.createElement('section');
  panel.className = 'orbit-notify-panel';
  panel.hidden = true;

  panel.innerHTML = `
    <div class="orbit-notify-head">
      <span>Notification Inbox</span>
      <button type="button" data-act="read-all">Mark all read</button>
    </div>
    <ul class="orbit-notify-list"></ul>
  `;

  const listNode = panel.querySelector<HTMLUListElement>('.orbit-notify-list');
  const readAllNode = panel.querySelector<HTMLButtonElement>('button[data-act="read-all"]');

  wrap.appendChild(button);
  wrap.appendChild(badge);
  wrap.appendChild(panel);
  const profileButton = host.querySelector('.header-profile-btn');
  if (profileButton) {
    host.insertBefore(wrap, profileButton);
  } else {
    host.appendChild(wrap);
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelayMs = 2000;
  let stopStream: (() => void) | null = null;
  let latestRowsById = new Map<string, Record<string, unknown>>();

  function updateBadge(count: number): void {
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = String(count > 99 ? '99+' : count);
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
  }

  async function refreshUnreadCount(): Promise<void> {
    try {
      const response = await getUnreadNotificationCount();
      const count = Number(
        response &&
        typeof response === 'object' &&
        response.data &&
        typeof response.data === 'object'
          ? (response.data as { unreadCount?: unknown }).unreadCount
          : 0,
      );
      updateBadge(Number.isFinite(count) ? Math.max(0, count) : 0);
    } catch {
      // keep previous unread badge
    }
  }

  function renderList(rows: Array<Record<string, unknown>>): void {
    if (!listNode) {
      return;
    }

    if (rows.length === 0) {
      latestRowsById = new Map();
      listNode.innerHTML = '<li class="orbit-notify-empty">No notifications</li>';
      return;
    }

    latestRowsById = new Map(
      rows.map((row) => [typeof row.id === 'string' ? row.id : '', row]),
    );

    listNode.innerHTML = rows
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id : '';
        const title = typeof row.title === 'string' ? row.title : 'Notification';
        const body = typeof row.body === 'string' ? row.body : '';
        const createdAt = formatTime(row.createdAt);
        const unread = row.isRead !== true;
        return `
          <li class="orbit-notify-item ${unread ? 'unread' : ''}" data-id="${id}">
            <div class="orbit-notify-title">${title}</div>
            <div class="orbit-notify-body">${body}</div>
            <div class="orbit-notify-time">${createdAt}</div>
          </li>
        `;
      })
      .join('');
  }

  async function refreshNotifications(): Promise<void> {
    try {
      const response = await listNotifications({ page: 1, limit: 20 });
      renderList(toNotificationRows(response.data));
    } catch {
      if (listNode) {
        listNode.innerHTML = '<li class="orbit-notify-empty">Cannot load notifications</li>';
      }
    }
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function stopReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function startPollingFallback(): void {
    stopPolling();
    pollTimer = setInterval(() => {
      void refreshUnreadCount();
      if (!panel.hidden) {
        void refreshNotifications();
      }
    }, 30_000);
  }

  function startStream(): void {
    stopStream?.();
    stopStream = connectNotificationsStream({
      onCreated: () => {
        void refreshUnreadCount();
        if (!panel.hidden) {
          void refreshNotifications();
        }
      },
      onRead: () => {
        void refreshUnreadCount();
        if (!panel.hidden) {
          void refreshNotifications();
        }
      },
      onUnreadCount: (payload) => {
        const count = Number(
          payload && typeof payload === 'object'
            ? (payload as { unreadCount?: unknown }).unreadCount
            : 0,
        );
        if (Number.isFinite(count)) {
          updateBadge(Math.max(0, count));
        }
      },
      onError: () => {
        stopStream?.();
        stopStream = null;
        startPollingFallback();
        stopReconnect();
        reconnectTimer = setTimeout(() => {
          reconnectDelayMs = Math.min(reconnectDelayMs * 1.5, 30_000);
          startStream();
        }, reconnectDelayMs);
      },
    });
    reconnectDelayMs = 2000;
    stopPolling();
  }

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      void refreshNotifications();
    }
  });

  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target as Node)) {
      panel.hidden = true;
    }
  });

  listNode?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.orbit-notify-item[data-id]');
    if (!row) {
      return;
    }
    const notificationId = row.dataset.id || '';
    if (!notificationId) {
      return;
    }
    const selected = latestRowsById.get(notificationId) || null;
    window.dispatchEvent(
      new CustomEvent('orbit:notification-open', {
        detail: {
          notificationId,
          ...(selected || {}),
        },
      }),
    );
    void markNotificationRead(notificationId)
      .then(() => {
        void refreshUnreadCount();
        void refreshNotifications();
      })
      .catch(() => undefined);
  });

  readAllNode?.addEventListener('click', () => {
    void markAllNotificationsRead()
      .then(() => {
        void refreshUnreadCount();
        void refreshNotifications();
      })
      .catch(() => undefined);
  });

  void refreshUnreadCount();
  startStream();

  window.addEventListener('beforeunload', () => {
    stopStream?.();
    stopPolling();
    stopReconnect();
  });
}


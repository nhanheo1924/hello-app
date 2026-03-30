const GLOBAL_LOADING_STYLE_ID = 'ctm-global-loading-style';
const GLOBAL_LOADING_ROOT_ID = 'ctm-global-loading-root';
const DEFAULT_LOADING_DELAY_MS = 500;
const MIN_VISIBLE_MS = 220;

type LoadingStartOptions = {
  trackLoading?: boolean;
  loadingDelayMs?: number;
  loadingScope?: string;
  silent?: boolean;
};

type LoadingStopHandler = () => void;

const scopeCounters = new Map<string, number>();

const state = {
  pending: 0,
  visible: false,
  shownAt: 0,
  showTimer: 0 as number | null,
  hideTimer: 0 as number | null,
};

function ensureStyle(): void {
  if (document.getElementById(GLOBAL_LOADING_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = GLOBAL_LOADING_STYLE_ID;
  style.textContent = `
    .ctm-global-loading-root {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 11000;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(14, 14, 16, 0.92);
      color: rgba(255, 255, 255, 0.92);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.42);
      pointer-events: none;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      font-size: 13px;
      line-height: 1.2;
      letter-spacing: 0.02em;
    }

    .ctm-global-loading-root.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .ctm-global-loading-spinner {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      border: 2px solid rgba(255, 255, 255, 0.25);
      border-top-color: rgba(255, 255, 255, 0.9);
      animation: ctm-global-loading-spin 0.75s linear infinite;
    }

    @keyframes ctm-global-loading-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function ensureRoot(): HTMLDivElement {
  ensureStyle();
  let root = document.getElementById(GLOBAL_LOADING_ROOT_ID) as HTMLDivElement | null;
  if (root) {
    return root;
  }

  root = document.createElement('div');
  root.id = GLOBAL_LOADING_ROOT_ID;
  root.className = 'ctm-global-loading-root';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'ctm-global-loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.textContent = 'Loading...';

  root.appendChild(spinner);
  root.appendChild(text);
  document.body.appendChild(root);
  return root;
}

function incrementScope(scope: string): void {
  const next = (scopeCounters.get(scope) || 0) + 1;
  scopeCounters.set(scope, next);
}

function decrementScope(scope: string): void {
  const current = scopeCounters.get(scope) || 0;
  if (current <= 1) {
    scopeCounters.delete(scope);
    return;
  }
  scopeCounters.set(scope, current - 1);
}

function setVisible(visible: boolean, scope?: string): void {
  const root = ensureRoot();
  if (scope) {
    root.dataset.scope = scope;
  } else {
    delete root.dataset.scope;
  }

  if (visible) {
    root.classList.add('is-visible');
    state.visible = true;
    state.shownAt = Date.now();
    return;
  }

  root.classList.remove('is-visible');
  state.visible = false;
}

function clearShowTimer(): void {
  if (state.showTimer !== null) {
    window.clearTimeout(state.showTimer);
    state.showTimer = null;
  }
}

function clearHideTimer(): void {
  if (state.hideTimer !== null) {
    window.clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }
}

function scheduleShow(delayMs: number, scope?: string): void {
  clearHideTimer();
  if (state.visible || state.showTimer !== null) {
    return;
  }

  state.showTimer = window.setTimeout(() => {
    state.showTimer = null;
    if (state.pending <= 0) {
      return;
    }
    setVisible(true, scope);
  }, Math.max(0, delayMs));
}

function scheduleHide(): void {
  clearShowTimer();
  clearHideTimer();
  if (!state.visible) {
    return;
  }

  const elapsed = Date.now() - state.shownAt;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
  state.hideTimer = window.setTimeout(() => {
    state.hideTimer = null;
    if (state.pending > 0) {
      return;
    }
    setVisible(false);
  }, wait);
}

export function beginGlobalLoading(options: LoadingStartOptions = {}): LoadingStopHandler {
  const trackLoading = options.trackLoading !== false && options.silent !== true;
  if (!trackLoading) {
    return () => undefined;
  }

  const delayMs = Number.isFinite(Number(options.loadingDelayMs))
    ? Number(options.loadingDelayMs)
    : DEFAULT_LOADING_DELAY_MS;
  const scope = typeof options.loadingScope === 'string' && options.loadingScope.trim()
    ? options.loadingScope.trim()
    : '';

  state.pending += 1;
  if (scope) {
    incrementScope(scope);
  }

  if (state.pending === 1) {
    scheduleShow(delayMs, scope || undefined);
  }

  let completed = false;
  return () => {
    if (completed) return;
    completed = true;

    if (scope) {
      decrementScope(scope);
    }

    state.pending = Math.max(0, state.pending - 1);
    if (state.pending === 0) {
      scheduleHide();
    }
  };
}


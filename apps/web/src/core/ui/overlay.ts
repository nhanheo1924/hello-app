const OVERLAY_STYLE_ID = 'ctm-ui-overlay-style';

type DialogType = 'info' | 'confirm';

type DialogOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: DialogType;
};

type DialogResult = {
  confirmed: boolean;
  closed: boolean;
};

function ensureStyle(): void {
  if (document.getElementById(OVERLAY_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    .ctm-overlay-root {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(8px);
    }

    .ctm-overlay-root.is-open {
      display: flex;
    }

    .ctm-overlay-panel {
      width: min(440px, 100%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(22, 22, 24, 0.98), rgba(12, 12, 14, 0.98));
      color: rgba(255, 255, 255, 0.9);
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
      overflow: hidden;
    }

    .ctm-overlay-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 18px 0;
    }

    .ctm-overlay-title {
      margin: 0;
      font-size: 18px;
      line-height: 1.35;
      letter-spacing: 0.01em;
    }

    .ctm-overlay-body {
      padding: 12px 18px 18px;
      color: rgba(255, 255, 255, 0.72);
      line-height: 1.6;
      font-size: 14px;
      white-space: pre-wrap;
    }

    .ctm-overlay-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 0 18px 18px;
      flex-wrap: wrap;
    }

    .ctm-overlay-btn {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.88);
      padding: 10px 14px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
    }

    .ctm-overlay-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.24);
      transform: translateY(-1px);
    }

    .ctm-overlay-btn.primary {
      background: rgba(255, 255, 255, 0.92);
      color: #000;
      border-color: rgba(255, 255, 255, 0.92);
    }

    .ctm-overlay-btn.danger {
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.9);
    }

    .ctm-toast-stack {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 10001;
      display: grid;
      gap: 10px;
      max-width: min(92vw, 360px);
    }

    .ctm-toast {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 14px;
      background: rgba(16, 16, 18, 0.96);
      color: rgba(255, 255, 255, 0.88);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      padding: 12px 14px;
      font-size: 13px;
      line-height: 1.5;
      transform: translateY(8px);
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }

    .ctm-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
}

function createOverlayPanel(): HTMLDivElement {
  ensureStyle();
  let root = document.getElementById('ctm-overlay-root') as HTMLDivElement | null;
  if (root) {
    return root;
  }

  root = document.createElement('div');
  root.id = 'ctm-overlay-root';
  root.className = 'ctm-overlay-root';
  root.innerHTML = `
    <section class="ctm-overlay-panel" role="dialog" aria-modal="true" aria-labelledby="ctm-overlay-title">
      <div class="ctm-overlay-head">
        <h2 class="ctm-overlay-title" id="ctm-overlay-title"></h2>
      </div>
      <div class="ctm-overlay-body" id="ctm-overlay-body"></div>
      <div class="ctm-overlay-actions" id="ctm-overlay-actions"></div>
    </section>
  `;
  document.body.appendChild(root);
  return root;
}

export function showToast(message: string, timeoutMs = 2800): void {
  ensureStyle();
  let stack = document.getElementById('ctm-toast-stack') as HTMLDivElement | null;
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'ctm-toast-stack';
    stack.className = 'ctm-toast-stack';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = 'ctm-toast';
  toast.textContent =
    window.OrbitI18n && typeof window.OrbitI18n.t === 'function'
      ? window.OrbitI18n.t(message)
      : message;
  stack.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  window.setTimeout(() => {
    toast.classList.remove('show');
    window.setTimeout(() => {
      toast.remove();
      if (stack && stack.childElementCount === 0) {
        stack.remove();
      }
    }, 220);
  }, timeoutMs);
}

export function openDialog(options: DialogOptions): Promise<DialogResult> {
  const root = createOverlayPanel();
  const titleNode = root.querySelector<HTMLElement>('#ctm-overlay-title');
  const bodyNode = root.querySelector<HTMLElement>('#ctm-overlay-body');
  const actionsNode = root.querySelector<HTMLElement>('#ctm-overlay-actions');

  if (!titleNode || !bodyNode || !actionsNode) {
    return Promise.resolve({ confirmed: false, closed: true });
  }

  const translate = (value: string): string => (
    window.OrbitI18n && typeof window.OrbitI18n.t === 'function'
      ? window.OrbitI18n.t(value)
      : value
  );

  titleNode.textContent = translate(
    options.title || (options.type === 'confirm' ? 'Confirm' : 'Message')
  );
  bodyNode.textContent = translate(options.message);
  actionsNode.innerHTML = '';

  root.classList.add('is-open');

  return new Promise((resolve) => {
    const close = (confirmed: boolean) => {
      root.classList.remove('is-open');
      actionsNode.innerHTML = '';
      resolve({ confirmed, closed: !confirmed });
    };

    if (options.type === 'confirm') {
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'ctm-overlay-btn';
      cancelButton.textContent = translate(options.cancelLabel || 'Cancel');
      cancelButton.addEventListener('click', () => close(false));

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'ctm-overlay-btn primary';
      confirmButton.textContent = translate(options.confirmLabel || 'Confirm');
      confirmButton.addEventListener('click', () => close(true));

      actionsNode.append(cancelButton, confirmButton);
    } else {
      const okButton = document.createElement('button');
      okButton.type = 'button';
      okButton.className = 'ctm-overlay-btn primary';
      okButton.textContent = translate(options.confirmLabel || 'OK');
      okButton.addEventListener('click', () => close(true));
      actionsNode.append(okButton);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.removeEventListener('keydown', onKeyDown);
        close(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    root.addEventListener(
      'click',
      (event) => {
        if (event.target === root) {
          window.removeEventListener('keydown', onKeyDown);
          close(false);
        }
      },
      { once: true },
    );
  });
}

import { getCurrentUser } from '../../core/auth/auth-api';
import { resolveAppPath } from '../../core/config/routes';

export async function mountAdminShortcut(): Promise<void> {
  const user = await getCurrentUser();
  const role = String(user?.systemRole || '').toUpperCase();
  if (role !== 'SYSTEM_ADMIN' && role !== 'SUPER_ADMIN') {
    return;
  }

  const target =
    document.querySelector<HTMLElement>('.content-header .header-right') ||
    document.querySelector<HTMLElement>('.content-header');
  if (!target || target.querySelector('[data-admin-shortcut]')) {
    return;
  }

  const link = document.createElement('a');
  link.href = resolveAppPath('/admin/');
  link.textContent = 'Admin';
  link.setAttribute('data-admin-shortcut', '1');
  link.style.marginLeft = '8px';
  link.style.padding = '8px 12px';
  link.style.border = '1px solid rgba(255,255,255,0.16)';
  link.style.borderRadius = '12px';
  link.style.color = 'rgba(255,255,255,0.92)';
  link.style.textDecoration = 'none';
  link.style.background = 'rgba(255,255,255,0.05)';

  target.appendChild(link);
}


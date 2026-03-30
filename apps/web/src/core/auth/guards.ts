import { appRoutes, resolveAppPath } from '../config/routes';
import { getCurrentUser, requireAuth } from './auth-api';

export async function redirectIfAuthenticated(destination = appRoutes.home): Promise<boolean> {
  const user = await getCurrentUser();
  if (user) {
    window.location.href = resolveAppPath(destination);
    return true;
  }
  return false;
}

export async function protectPage(redirectPath = appRoutes.signin) {
  return requireAuth(redirectPath);
}

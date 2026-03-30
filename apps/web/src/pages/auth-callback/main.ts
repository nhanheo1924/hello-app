import { appRoutes, resolveAppPath } from '../../core/config/routes';
import { getCurrentUser, invalidateProfileCache } from '../../core/auth/auth-api';
import { storeToken } from '../../core/auth/session';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const googleStatus = params.get('google');
const message = params.get('message');

if (token) {
  storeToken(token);
  invalidateProfileCache();
  await getCurrentUser({ forceRefresh: true });
  window.location.replace(resolveAppPath(appRoutes.home));
} else if (googleStatus) {
  const target = new URL(resolveAppPath(appRoutes.signin), window.location.origin);
  target.searchParams.set('google', googleStatus);
  if (message) {
    target.searchParams.set('message', message);
  }
  window.location.replace(target.toString());
} else {
  window.location.replace(resolveAppPath(appRoutes.signin));
}

import { appRoutes, resolveAppPath } from '../../core/config/routes';
import { exchangeOauthCode } from '../../core/auth/auth-api';

const statusTitleNode = document.getElementById('auth-callback-status-title');
const statusDetailNode = document.getElementById('auth-callback-status-detail');

function setStatus(title: string, detail = '', isError = false): void {
  if (statusTitleNode) {
    statusTitleNode.textContent = title;
  }
  if (statusDetailNode) {
    statusDetailNode.textContent = detail;
  }
  document.body.classList.toggle('is-error', isError);
}

function navigateTo(path: string, options?: { replace?: boolean }): void {
  const target = resolveAppPath(path);
  const resolved = new URL(target, window.location.origin);
  const pathWithQuery = `${resolved.pathname}${resolved.search}${resolved.hash}`;

  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        type: 'orbit-shell-navigate',
        path: pathWithQuery,
        replace: options?.replace === true
      },
      window.location.origin,
    );
    return;
  }

  if (options?.replace === true) {
    window.location.replace(resolved.toString());
    return;
  }
  window.location.href = resolved.toString();
}

function redirectToSignin(query?: { google?: string; message?: string }): void {
  const target = new URL(resolveAppPath(appRoutes.signin), window.location.origin);
  if (query?.google) {
    target.searchParams.set('google', query.google);
  }
  if (query?.message) {
    target.searchParams.set('message', query.message);
  }
  navigateTo(`${target.pathname}${target.search}${target.hash}`, { replace: true });
}

async function runOauthCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const oauthCode = params.get('oauthCode');
  const googleStatus = params.get('google');
  const message = params.get('message');

  if (oauthCode) {
    setStatus('Authenticating', 'Completing secure sign-in...');
    const result = await exchangeOauthCode(oauthCode);
    if (!result.ok) {
      if (result.requiresTwoFactor) {
        redirectToSignin({
          google: '2fa',
          message: result.error || 'Google account requires 2FA verification.'
        });
        return;
      }
      redirectToSignin({
        google: 'error',
        message: result.error || 'OAuth authentication failed.'
      });
      return;
    }

    setStatus('Success', 'Redirecting to your workspace...');
    navigateTo(appRoutes.home, { replace: true });
    return;
  }

  if (googleStatus) {
    redirectToSignin({
      google: googleStatus,
      message: message || undefined
    });
    return;
  }

  redirectToSignin({
    google: 'error',
    message: 'Missing OAuth callback data.'
  });
}

void runOauthCallback().catch(() => {
  setStatus('Authentication Failed', 'Unable to complete OAuth callback.', true);
  setTimeout(() => {
    redirectToSignin({
      google: 'error',
      message: 'Unable to complete OAuth callback.'
    });
  }, 1200);
});

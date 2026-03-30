import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

function normalizeBasePath(rawBasePath: string | undefined): string {
  const value = String(rawBasePath || '/').trim();
  if (!value || value === '/') {
    return '/';
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

function resolveProxyOrigin(candidate: string | undefined, fallback: string): string {
  const raw = String(candidate || '').trim();
  if (!raw) {
    return fallback;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return fallback;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Keep dev default local-first for repeatable student setup.
  const bffProxyOrigin = resolveProxyOrigin(env.BFF_PROXY_TARGET_URL, 'http://localhost:3001');

  return {
    base: normalizeBasePath(env.VITE_APP_BASE_PATH),
    server: {
      host: true,
      allowedHosts: true,
      proxy: {
        '/api/v1': {
          target: bffProxyOrigin,
          changeOrigin: true,
          secure: false,
          ws: true
        }
      }
    },
    build: {
      rollupOptions: {
        input: {
          root: resolve(__dirname, 'index.html'),
          landing: resolve(__dirname, 'landing/index.html'),
          signin: resolve(__dirname, 'signin/index.html'),
          signup: resolve(__dirname, 'signup/index.html'),
          home: resolve(__dirname, 'home/index.html'),
          admin: resolve(__dirname, 'admin/index.html'),
          setting: resolve(__dirname, 'setting/index.html'),
          workspaceSetting: resolve(__dirname, 'workspace-setting/index.html'),
          about: resolve(__dirname, 'about/index.html'),
          authCallback: resolve(__dirname, 'auth/callback/index.html')
        }
      }
    }
  };
});

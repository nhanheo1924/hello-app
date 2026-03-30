/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BASE_PATH?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_FRONTEND_URL?: string;
  readonly VITE_OAUTH_CALLBACK_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

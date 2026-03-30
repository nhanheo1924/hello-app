# CTM Web Frontend (Local)

## Overview

- Vite multi-page app
- Existing UI is preserved (HTML/CSS/JS)
- Frontend API calls use `VITE_API_BASE_URL` (default `/api/v1`)

## Local Dev Proxy Defaults

`vite.config.ts` defaults to local BFF target:
- `/api/v1/*` -> `http://localhost:3001`

Override if needed:
- `BFF_PROXY_TARGET_URL`

## Local env (`apps/web/.env.local`)

```env
VITE_APP_BASE_PATH=/
VITE_API_BASE_URL=/api/v1
VITE_FRONTEND_URL=http://localhost:5173
VITE_OAUTH_CALLBACK_PATH=/auth/callback/
BFF_PROXY_TARGET_URL=http://localhost:3001
INTERNAL_PROXY_SECRET=dev-internal-proxy-secret-0123456789ab
```

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

# CTM Full Local Stack (Web + Nest + PostgreSQL)

This repository runs fully on local machine:
- `apps/web`: HTML/CSS/JS UI (Vite)
- `apps/auth-service`: NestJS auth API
- `apps/task-service`: NestJS task/workspace API
- `PostgreSQL`: direct host connection (`localhost:5432`)

Guide to share with teammates:
- `SETUP_LOCAL_FOR_FRIEND.md`

## Local Architecture

- Frontend calls same-origin paths:
  - `/api/auth/*` -> auth-service
  - `/api/workspaces/*`, `/api/projects/*`, `/api/tasks/*` -> task-service
- Vite dev proxy is local-first by default.
- Backends fail fast if DB is unreachable.
- Non-production backend blocks Docker-internal DB hosts and non-`5432` port by default.
- Database layout:
  - auth-service: schema `public`
  - task-service: schema `task`

## Quick Start

### 1) Prepare local PostgreSQL

Expected default:
- host: `localhost`
- port: `5432`
- database: `ctm-auth-service`

### 2) Sync env for all apps

```bash
npm run env:sync
```

Generated files:
- `apps/auth-service/.env`
- `apps/task-service/.env`
- `apps/web/.env.local`

### 3) Install dependencies

```bash
npm run install:all
```

### 4) Generate Prisma client + migrate DB

```bash
npm run db:generate
npm run db:migrate
```

### 5) Run stack in 3 terminals

```bash
npm run dev:auth
npm run dev:task
npm run dev:web
```

### 6) Verify end-to-end persistence

If auth/task are already running:

```bash
npm run verify:stack
```

Or run auth + task + verify in one command:

```bash
npm run verify:local
```

The verify flow creates user/workspace/project/task through APIs and confirms data is returned from board API.

## Build

```bash
npm run build
```

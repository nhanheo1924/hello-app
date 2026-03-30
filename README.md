  # CTM Full Local Stack (Web + BFF + Nest + PostgreSQL)

  This repository runs fully on a local machine:
  - `apps/web`: HTML/CSS/JS frontend (Vite)
  - `apps/bff-service`: NestJS BFF gateway for browser traffic
  - `apps/auth-service`: NestJS auth domain service
  - `apps/task-service`: NestJS workspace/project/task domain service
  - `PostgreSQL`: Dockerized local database with persistent volume

  ## Local Architecture

  - Browser traffic goes to BFF only:
    - `/api/v1/auth/*`
    - `/api/v1/workspaces/*`, `/api/v1/projects/*`, `/api/v1/tasks/*`
  - BFF proxy mapping:
    - `/api/v1/auth/*` -> auth-service `/api/auth/*`
    - `/api/v1/workspaces|projects|tasks/*` -> task-service `/api/*`
  - Database split:
    - auth-service uses schema `public`
    - task-service uses schema `task`

  ## Monorepo Structure (Scanned)

  The tree below is the current practical structure (excluding `.git`, `node_modules`, `dist`, `.tmp`):

  ```txt
  e:\ctm
  |- apps
  |  |- auth-service
  |  |  |- prisma
  |  |  |  |- migrations
  |  |  |  \- schema.prisma
  |  |  |- sql
  |  |  |- src
  |  |  |  |- auth
  |  |  |  |- common
  |  |  |  |- config
  |  |  |  |- health
  |  |  |  |- prisma
  |  |  |  |- types
  |  |  |  |- users
  |  |  |  |- app.module.ts
  |  |  |  \- main.ts
  |  |  |- test
  |  |  |- .env.example
  |  |  |- package.json
  |  |  \- README.md
  |  |- bff-service
  |  |  |- src
  |  |  |  |- common
  |  |  |  |- config
  |  |  |  |- health
  |  |  |  |- proxy
  |  |  |  |- sync
  |  |  |  |- types
  |  |  |  |- app.module.ts
  |  |  |  \- main.ts
  |  |  |- .env.example
  |  |  |- package.json
  |  |  \- README.md
  |  |- task-service
  |  |  |- prisma
  |  |  |  |- migrations
  |  |  |  \- schema.prisma
  |  |  |- src
  |  |  |  |- auth
  |  |  |  |- common
  |  |  |  |- config
  |  |  |  |- health
  |  |  |  |- prisma
  |  |  |  |- tasks
  |  |  |  |- types
  |  |  |  |- app.module.ts
  |  |  |  \- main.ts
  |  |  |- test
  |  |  |- .env.example
  |  |  |- package.json
  |  |  \- README.md
  |  \- web
  |     |- about
  |     |- auth
  |     |  \- callback
  |     |- home
  |     |- landing
  |     |- Resources
  |     |- setting
  |     |- signin
  |     |- signup
  |     |- src
  |     |  |- config
  |     |  |- core
  |     |  |- legacy
  |     |  |- modules
  |     |  \- pages
  |     |- .env.example
  |     |- package.json
  |     \- vite.config.ts
  |- scripts
  |  |- configure-cloudflared-env.ps1
  |  |- db-setup-local.ps1
  |  |- run-local-verify.ps1
  |  |- start-dev-all.ps1
  |  |- stop-dev-all.ps1
  |  |- sync-local-env.ps1
  |  |- verify-auth-flows.ps1
  |  \- verify-local-stack.ps1
  |- docker-compose.yml
  |- package.json
  |- .env.example
  \- Agents.md
  ```
  ## Database Topology (Detailed)

  ### 1) Runtime/Container

  - PostgreSQL container: `postgres:16-alpine`
  - Compose service: `postgres`
  - Exposed port: `${POSTGRES_PORT:-5432}`
  - Persistent volume: `ctm_postgres_data:/var/lib/postgresql/data`
  - Health check: `pg_isready`

  ### 2) Schema `public` (auth-service)

  Source of truth:
  - Prisma: `apps/auth-service/prisma/schema.prisma`
  - Migrations:
    - `20260226093000_init`
    - `20260303110000_auth_2fa_sessions_google`
    - `20260305050000_requirements_core_alignment`

  Enums:
  - `user_status`: `ACTIVE`, `LOCKED`, `DISABLED`
  - `session_revoke_reason`: `NEW_LOGIN`, `LOGOUT`, `REFRESH_REUSE`, `ADMIN`, `SECURITY`
  - `audit_action`: `REGISTER`, `LOGIN_OK`, `LOGIN_FAIL`, `REFRESH_OK`, `REFRESH_FAIL`, `LOGOUT`, `SESSION_REVOKED`, `SECURITY_EVENT`

  Tables and columns:
  - `users`
    - `id`, `email`, `password_hash`, `status`, `email_verified_at`, `last_login_at`, `full_name`, `google_id`, `two_factor_enabled`, `two_factor_secret`, `two_factor_temp_secret`, `two_factor_backup_codes`, `created_at`, `updated_at`
  - `sessions`
    - `id`, `user_id`, `ip`, `user_agent`, `device_id`, `created_at`, `last_seen_at`, `revoked_at`, `revoke_reason`
  - `refresh_tokens`
    - `id`, `session_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at`, `replaced_by_token_id`, `created_by_ip`, `created_by_user_agent`, `last_used_at`, `updated_at`
  - `audit_logs`
    - `id`, `user_id`, `email`, `ip`, `user_agent`, `action`, `detail`, `created_at`

  Important constraints/indexes:
  - Unique: `users.email`, `users.google_id`
  - Active-session policy index: one active session per user (`sessions` partial unique by `user_id` where not revoked)
  - FK:
    - `sessions.user_id -> users.id` (`ON DELETE CASCADE`)
    - `refresh_tokens.session_id -> sessions.id` (`ON DELETE CASCADE`)
    - `audit_logs.user_id -> users.id` (`ON DELETE SET NULL`)
  - Operational indexes on token hash, expiry, action/time fields

  ### 3) Schema `task` (task-service)

  Source of truth:
  - Prisma: `apps/task-service/prisma/schema.prisma`
  - Migration: `20260306090000_init`

  Enums:
  - `workspace_role`: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
  - `project_status`: `ACTIVE`, `ARCHIVED`
  - `task_priority`: `LOW`, `MEDIUM`, `HIGH`, `URGENT`
  - `task_status`: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`

  Tables and columns:
  - `workspaces`
    - `id`, `name`, `owner_id`, `created_at`, `updated_at`
  - `workspace_members`
    - `workspace_id`, `user_id`, `role`, `joined_at`
  - `projects`
    - `id`, `workspace_id`, `name`, `description`, `status`, `created_by`, `created_at`, `updated_at`
  - `project_members`
    - `project_id`, `user_id`, `role`, `joined_at`
  - `columns`
    - `id`, `project_id`, `name`, `position`, `created_at`, `updated_at`
  - `tasks`
    - `id`, `project_id`, `column_id`, `title`, `description`, `priority`, `status`, `due_at`, `assignee_id`, `order_index`, `created_by`, `archived_at`, `created_at`, `updated_at`
  - `comments`
    - `id`, `task_id`, `author_id`, `content`, `created_at`, `updated_at`
  - `labels`
    - `id`, `workspace_id`, `name`, `color`, `created_at`, `updated_at`
  - `task_labels`
    - `task_id`, `label_id`, `created_at`
  - `activities`
    - `id`, `workspace_id`, `project_id`, `task_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `payload`, `created_at`
  - `idempotency_records`
    - `id`, `key`, `user_id`, `action`, `request_hash`, `response`, `created_at`

  Important constraints/indexes:
  - PK composite:
    - `workspace_members(workspace_id, user_id)`
    - `project_members(project_id, user_id)`
    - `task_labels(task_id, label_id)`
  - Unique:
    - `labels(workspace_id, name)`
    - `idempotency_records(key, user_id, action)`
  - FK cascade chain:
    - workspace -> projects/labels/members/activities
    - project -> columns/tasks/members/activities
    - task -> comments/task_labels/activities
  - Indexes for board sorting and query patterns:
    - `tasks(project_id, column_id, order_index)`
    - `tasks(status)`, `tasks(due_at)`, `tasks(assignee_id)`
    - activity timeline indexes by workspace/project/task + `created_at`

  ## Setup and Scripts

  ### Quick Start

  1) Start PostgreSQL:

  ```bash
  docker compose up -d postgres
  ```

  2) Sync local env files:

  ```bash
  npm run env:sync
  ```

  Generated files:
  - `apps/auth-service/.env`
  - `apps/task-service/.env`
  - `apps/bff-service/.env`
  - `apps/web/.env.local`

  3) Install all dependencies:

  ```bash
  npm run install:all
  ```

  4) Prisma and DB setup:

  ```bash
  npm run db:generate
  npm run db:migrate
  ```

  5) Run services:

  ```bash
  npm run dev:auth
  npm run dev:task
  npm run dev:bff
  npm run dev:web
  ```

  Or run all 4 services at once:

  ```bash
  npm run dev:all
  npm run dev:all:stop
  ```

  6) Verify stack:

  ```bash
  npm run verify:stack
  npm run verify:local
  ```

  ## Cloudflared Tunnel Flow (Optional)

  Configure tunnel env once:

  ```bash
  npm run tunnel:config -- --ApiTunnelUrl https://<api-tunnel-domain> --WebTunnelUrl https://<web-tunnel-domain> --CloudflareZaClientId <cf-access-client-id> --CloudflareZaClientSecret <cf-access-client-secret>
  ```

  Run verify through tunnel:

  ```bash
  npm run verify:local:tunnel
  ```

  Notes:
  - `GOOGLE_OAUTH_REDIRECT_URI_LOCAL` is derived as `<api-tunnel-domain>/api/v1/auth/google/callback`
  - Add that exact redirect URI in Google OAuth credentials
  - If not using ZA, omit `--CloudflareZaClientId` and `--CloudflareZaClientSecret`

  ## Build

  ```bash
  npm run build
  ```

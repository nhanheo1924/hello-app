# AGENTS.md

This file defines shared working rules for this student fullstack project.

Goal:
Keep the project simple, clear, maintainable, and easy to understand.
Do not over-engineer.
Prefer practical solutions over complex architecture.

## 1. Project Overview

This project is a student fullstack monorepo.

Main parts:

- `apps/web`: frontend using HTML, CSS, JavaScript, and Vite
- `apps/bff-service`: NestJS BFF gateway for frontend-facing APIs
- `apps/auth-service`: NestJS backend for authentication and user features
- `apps/task-service`: NestJS backend for workspace, project, and task features
- PostgreSQL: database running in Docker

Responsibility split:

- Frontend handles UI, client state, and API calls.
- Frontend calls `bff-service` only.
- BFF handles request proxying, retry/timeout policy, and shared gateway concerns.
- Auth/task services handle business logic, validation, and database access.
- Frontend must never access the database directly.

Service boundaries:

- `bff-service`: public API for browser clients (`/api/v1/*`)
- `auth-service`: auth, user, token, access, Google OAuth logic
- `task-service`: workspace, project, task logic

Request flow:

- browser -> `web` -> `bff-service` -> (`auth-service` or `task-service`) -> PostgreSQL

## 2. Architecture Rules

- Keep frontend, backend, and database responsibilities clearly separated.
- Frontend must not call `auth-service` or `task-service` directly in normal browser flows.
- Keep UI logic, API calls, and business logic separated.
- Do not put all logic into one file.
- Avoid unnecessary abstraction while the project is still small.
- Shared code should stay minimal and be in a clear shared location if needed.
- Prefer clear structure over clever structure.

General principle:

- frontend = UI + state + API requests
- bff = gateway/proxy + transport concerns (not domain business logic)
- auth/task backend = request handling + business logic + database operations
- database = persistent data storage only

## 3. Code Conventions

- Use clear and descriptive names for variables, functions, files, and folders.
- Avoid confusing abbreviations.
- One file should have one main responsibility.
- Keep functions short and readable.
- Split large functions into smaller parts.
- Prefer `const`.
- Use `let` only when necessary.
- Do not use `var`.
- Avoid duplicated logic.
- Avoid repeated magic values in multiple places.
- Write short comments only when explaining why, not obvious behavior.
- Keep formatting and linting consistent across the repo.

Naming:

- variables and functions: `camelCase`
- classes and components: `PascalCase`
- file and folder names: consistent and descriptive

Priority:

1. readability
2. consistency
3. simplicity
4. reuse when useful

## 4. Frontend Rules

Frontend responsibilities:

- render UI
- manage client-side state
- collect user input
- call backend APIs
- handle basic user-facing errors

Frontend must not:

- access the database directly
- contain backend business logic
- hardcode API URLs in many places

API configuration:

- Use one single API configuration entry point.
- Current entry: `apps/web/src/config/api.ts`.
- All frontend API requests must go through this shared configuration.

Environment variables:

- `VITE_APP_BASE_PATH`
- `VITE_API_BASE_URL`
- `VITE_FRONTEND_URL`
- `VITE_OAUTH_CALLBACK_PATH`

Local dev proxy variable:

- `BFF_PROXY_TARGET_URL` (used by Vite dev server proxy)

Production frontend domain:

- `https://nhanctm.site`

Deployment target:

- Vercel

Recommended shared config:

```ts
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";
```

Frontend structure guidelines:

- Keep UI files separate from API call logic when possible.
- Do not put too much HTML, CSS, and JavaScript into one large file if a feature grows.
- If many pages/components use the same API logic, move it to a shared helper/service file.

## 5. Backend Rules

Backend framework:

- NestJS (`bff-service`, `auth-service`, `task-service`)

Required structure:

- module
- controller
- service
- dto
- repository or prisma layer if needed

Responsibility rules:

- Controllers receive requests and return responses.
- Controllers must not contain heavy business logic.
- Services handle business logic.
- Database access should stay in a proper data access layer when needed.
- Keep service boundaries clear between `auth-service` and `task-service`.
- `bff-service` should not re-implement auth/task business logic.

Validation:

- Use DTOs.
- Use `class-validator`.
- Use `ValidationPipe`.

Error handling:

- Return consistent error responses.
- Do not expose raw database errors to clients.
- Return messages simple enough for frontend handling.

Production API domain:

- `https://api.nhanctm.site` (public BFF entry)

Additional rules:

- Do not put database queries directly in controllers.
- Do not let one service take over another service domain.
- Keep APIs predictable and easy for the frontend to consume.
- Keep `INTERNAL_PROXY_SECRET` consistent across `bff-service`, `auth-service`, and `task-service`.

## 6. Database, Docker, and Env Rules

Database:

- PostgreSQL

Local database rule:

- PostgreSQL must run in Docker during local development.

Docker rules:

- Always use a Docker volume for PostgreSQL data.
- Data must persist across container restart/recreation.
- Do not rely on container-only storage.

Database configuration:

- Read all database connection settings from environment variables.
- Do not hardcode database credentials in source code.

Schema rules:

- Use migrations or versioned schema changes.
- Team members must be able to run the same schema setup consistently.
- Keep schema changes traceable.

Recommended support:

- Provide a seed script if demo data is needed.
- Provide a reset script if local DB reset is needed.

Environment rules:

- Local and production must use the same configuration mechanism.
- Only values should change between environments.
- Do not switch environments by editing source code.
- Do not hardcode API URLs in multiple files.
- Do not commit `.env`.
- Do not push secrets, tokens, or passwords to GitHub.

Minimum environment variables by service:

Frontend (`apps/web`):

- `VITE_APP_BASE_PATH`
- `VITE_API_BASE_URL`
- `VITE_FRONTEND_URL`
- `VITE_OAUTH_CALLBACK_PATH`

BFF (`apps/bff-service`):

- `APP_PORT`
- `APP_PREFIX`
- `CORS_ORIGIN`
- `AUTH_SERVICE_BASE_URL`
- `TASK_SERVICE_BASE_URL`
- `INTERNAL_PROXY_SECRET`

Auth (`apps/auth-service`):

- `APP_PORT`
- `APP_PREFIX`
- `CORS_ORIGIN`
- `DATABASE_URL`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `JWT_ACTIVE_KID`
- `JWT_ACCESS_PRIVATE_KEY`
- `JWT_ACCESS_PUBLIC_KEY`
- `INTERNAL_PROXY_SECRET`
- `WEB_APP_URL`
- `WEB_APP_OAUTH_CALLBACK_URL`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`

Task (`apps/task-service`):

- `APP_PORT`
- `APP_PREFIX`
- `CORS_ORIGIN`
- `DATABASE_URL`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `AUTH_SERVICE_BASE_URL`
- `AUTH_JWKS_URL`
- `INTERNAL_PROXY_SECRET`

## 7. Local Development, Cloudflared Tunnel, and Google OAuth

Recommended local setup flow:

1. `docker compose up -d postgres`
2. `npm run env:sync`
3. `npm run install:all`
4. `npm run db:generate`
5. `npm run db:migrate`

Run services in separate terminals:

- `npm run dev:auth`
- `npm run dev:task`
- `npm run dev:bff`
- `npm run dev:web`

Local verification:

- `npm run verify:stack`
- `npm run verify:local`

Cloudflared tunnel rules:

- Cloudflared tunnel may be used for demo, testing, or temporary external access.
- Do not use it as a replacement for production deployment.
- Do not hardcode temporary tunnel URLs in source code.
- If a tunnel URL is needed, place it in environment configuration only.

Cloudflared quick examples:

- expose BFF public endpoint: `cloudflared tunnel --url http://localhost:3001`
- expose frontend for remote demo (optional): `cloudflared tunnel --url http://localhost:5173`

Google OAuth with local tunnel:

1. Create Google OAuth Web Application credentials.
2. In Google Cloud Console, set Authorized redirect URI exactly to:
   `https://<your-bff-tunnel-domain>/api/v1/auth/google/callback`
3. Set root `.env` values (then sync):
   - `GOOGLE_OAUTH_CLIENT_ID=<from_google>`
   - `GOOGLE_OAUTH_CLIENT_SECRET=<from_google>`
   - `GOOGLE_OAUTH_REDIRECT_URI_LOCAL=https://<your-bff-tunnel-domain>/api/v1/auth/google/callback`
   - `WEB_APP_URL_LOCAL=<frontend_origin>`
   - `WEB_APP_OAUTH_CALLBACK_URL_LOCAL=<frontend_origin>/auth/callback/`
4. Run `npm run env:sync` to regenerate service env files.
5. Restart `auth-service`, `bff-service`, and `web`.

OAuth notes:

- Redirect URI must match exactly between Google Console and backend env.
- For local browser testing, frontend origin can stay `http://localhost:5173`.
- For remote demo, use a tunneled frontend origin and update callback env accordingly.

## 8. Deployment Rules (Vercel + Backend)

Deployment split:

- Deploy frontend (`apps/web`) to Vercel.
- Deploy backend services to server/container platform.
- Public API should point to BFF domain (recommended: `https://api.nhanctm.site`).

Vercel project setup:

- Root Directory: `apps/web`
- Build Command: `npm run build`
- Output Directory: `dist`

Vercel environment variables:

- `VITE_APP_BASE_PATH=/`
- `VITE_API_BASE_URL=https://api.nhanctm.site/api/v1`
- `VITE_FRONTEND_URL=https://nhanctm.site`
- `VITE_OAUTH_CALLBACK_PATH=/auth/callback/`

Backend production requirements:

- `bff-service` must expose `/api/v1/*` on HTTPS.
- `auth-service` and `task-service` can stay private/internal.
- `INTERNAL_PROXY_SECRET` must be identical across backend services.
- `CORS_ORIGIN` must include `https://nhanctm.site` and `https://www.nhanctm.site`.

Google OAuth production settings:

- `GOOGLE_OAUTH_REDIRECT_URI=https://api.nhanctm.site/api/v1/auth/google/callback`
- `WEB_APP_URL=https://nhanctm.site`
- `WEB_APP_OAUTH_CALLBACK_URL=https://nhanctm.site/auth/callback/`
- Add production redirect URI in Google Cloud Console.

Deployment checklist:

1. Deploy backend (`auth-service`, `task-service`, `bff-service`) and confirm health endpoints.
2. Set Vercel env variables and deploy frontend.
3. Attach custom domains (`nhanctm.site`, `www.nhanctm.site`) in Vercel.
4. Verify end-to-end:
   - frontend loads
   - login/signup works
   - Google OAuth redirects back to frontend callback
   - create workspace/project/task works through BFF

## 9. Build, Test, and Agent Behavior

Before pushing code, make sure:

- frontend builds successfully
- backend builds successfully
- APIs are reachable
- database connection works
- main user flows are tested at a basic level

Build command:

- `npm run build`

Verification commands:

- `npm run verify:stack`
- `npm run verify:local`

Recommended minimum checks:

- frontend can load
- auth-service can start
- task-service can start
- bff-service can start
- PostgreSQL can connect
- main API endpoints respond correctly

Agent behavior rules:

- preserve existing project structure
- keep code simple and easy to understand
- follow service boundaries
- avoid unnecessary dependencies
- avoid unnecessary abstraction
- respect environment-based configuration
- do not hardcode temporary values
- generate code that students can read and maintain

Agents should:

- prefer practical solutions
- keep files organized
- avoid rewriting unrelated code
- avoid changing architecture without clear reason
- generate code that works for local and deployment

Agents should not:

- add advanced enterprise patterns without need
- hardcode secrets, domains, or DB credentials
- mix frontend and backend responsibilities
- create confusing abstractions for small features

## 10. Final Important Rules

- Keep frontend, backend, and database responsibilities clearly separated.
- Frontend handles UI and API calls only.
- Backend handles logic, validation, and database access.
- Frontend browser traffic should go to `bff-service`, not directly to auth/task.
- PostgreSQL must run in Docker with a persistent volume in local development.
- Do not commit `.env`.
- Do not push secrets, tokens, or passwords to GitHub.
- Do not hardcode API URLs in multiple places.
- Do not put business logic inside controllers.
- Do not expose raw database errors to clients.
- Keep code readable, simple, and suitable for a student project.
- Prefer consistency over cleverness.
- Prefer maintainability over unnecessary complexity.
- Do not introduce enterprise-level patterns unless clearly needed.

## 11. Current Repository Structure (Scanned Baseline)

Use this as the practical structure reference (exclude `.git`, `node_modules`, `dist`, `.tmp`):

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
|     |- auth/callback
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
|- README.md
\- Agents.md
```
## 12. Database Source of Truth (Detailed)

Database runtime:
- PostgreSQL in Docker (`postgres:16-alpine`)
- Persistent volume: `ctm_postgres_data`
- Connection config comes from env (`POSTGRES_*`, generated `DATABASE_URL`)

Auth schema (`public`) source:
- `apps/auth-service/prisma/schema.prisma`
- migrations:
  - `20260226093000_init`
  - `20260303110000_auth_2fa_sessions_google`
  - `20260305050000_requirements_core_alignment`

Auth enums:
- `user_status`: `ACTIVE`, `LOCKED`, `DISABLED`
- `session_revoke_reason`: `NEW_LOGIN`, `LOGOUT`, `REFRESH_REUSE`, `ADMIN`, `SECURITY`
- `audit_action`: `REGISTER`, `LOGIN_OK`, `LOGIN_FAIL`, `REFRESH_OK`, `REFRESH_FAIL`, `LOGOUT`, `SESSION_REVOKED`, `SECURITY_EVENT`

Auth tables/columns:
- `users`: `id`, `email`, `password_hash`, `status`, `email_verified_at`, `last_login_at`, `full_name`, `google_id`, `two_factor_enabled`, `two_factor_secret`, `two_factor_temp_secret`, `two_factor_backup_codes`, `created_at`, `updated_at`
- `sessions`: `id`, `user_id`, `ip`, `user_agent`, `device_id`, `created_at`, `last_seen_at`, `revoked_at`, `revoke_reason`
- `refresh_tokens`: `id`, `session_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at`, `replaced_by_token_id`, `created_by_ip`, `created_by_user_agent`, `last_used_at`, `updated_at`
- `audit_logs`: `id`, `user_id`, `email`, `ip`, `user_agent`, `action`, `detail`, `created_at`

Auth FK/index essentials:
- `sessions.user_id -> users.id` (`ON DELETE CASCADE`)
- `refresh_tokens.session_id -> sessions.id` (`ON DELETE CASCADE`)
- `audit_logs.user_id -> users.id` (`ON DELETE SET NULL`)
- unique: `users.email`, `users.google_id`
- active-session invariant with partial unique index on `sessions(user_id)` where not revoked

Task schema (`task`) source:
- `apps/task-service/prisma/schema.prisma`
- migration: `20260306090000_init`

Task enums:
- `workspace_role`: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
- `project_status`: `ACTIVE`, `ARCHIVED`
- `task_priority`: `LOW`, `MEDIUM`, `HIGH`, `URGENT`
- `task_status`: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`

Task tables/columns:
- `workspaces`: `id`, `name`, `owner_id`, `created_at`, `updated_at`
- `workspace_members`: `workspace_id`, `user_id`, `role`, `joined_at`
- `projects`: `id`, `workspace_id`, `name`, `description`, `status`, `created_by`, `created_at`, `updated_at`
- `project_members`: `project_id`, `user_id`, `role`, `joined_at`
- `columns`: `id`, `project_id`, `name`, `position`, `created_at`, `updated_at`
- `tasks`: `id`, `project_id`, `column_id`, `title`, `description`, `priority`, `status`, `due_at`, `assignee_id`, `order_index`, `created_by`, `archived_at`, `created_at`, `updated_at`
- `comments`: `id`, `task_id`, `author_id`, `content`, `created_at`, `updated_at`
- `labels`: `id`, `workspace_id`, `name`, `color`, `created_at`, `updated_at`
- `task_labels`: `task_id`, `label_id`, `created_at`
- `activities`: `id`, `workspace_id`, `project_id`, `task_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `payload`, `created_at`
- `idempotency_records`: `id`, `key`, `user_id`, `action`, `request_hash`, `response`, `created_at`

Task FK/index essentials:
- cascading relations: workspace -> projects/labels/members/activities -> columns/tasks/comments/task_labels/activities
- `activities.project_id` and `activities.task_id` use `ON DELETE SET NULL`
- unique:
  - `labels(workspace_id, name)`
  - `idempotency_records(key, user_id, action)`
- board query indexes:
  - `tasks(project_id, column_id, order_index)`
  - `tasks(status)`, `tasks(due_at)`, `tasks(assignee_id)`

DB operation commands (standard):
1. `docker compose up -d postgres`
2. `npm run env:sync`
3. `npm run db:generate`
4. `npm run db:migrate`
5. `npm run verify:stack` or `npm run verify:local`

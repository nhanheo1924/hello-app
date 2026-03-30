# Task Service (Local)

NestJS + Prisma task/workspace API.

## Local Run

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run start:dev
```

Default local URL: `http://localhost:3102/api`

## Local Requirements

- `DATABASE_URL` should point to local PostgreSQL schema `task`.
- In non-production, service blocks Docker-internal DB hosts and non-`5432` port.
- `AUTH_JWKS_URL` should be `http://localhost:3000/.well-known/jwks.json`.

## API Scope

- `GET/POST /workspaces`
- `GET/PATCH /workspaces/:workspaceId`
- `GET/POST /workspaces/:workspaceId/projects`
- `PATCH/DELETE /projects/:projectId`
- `GET /projects/:projectId/board`
- `POST /projects/:projectId/tasks`
- `PATCH/DELETE /tasks/:taskId`
- `POST /tasks/:taskId/move`
- `GET/POST /tasks/:taskId/comments`

## Security

- Browser clients should call `bff-service` (`/api/v1/*`) instead of task-service directly.
- Trusted proxy mode: `x-proxy-secret: <INTERNAL_PROXY_SECRET>`
- Token is validated by JWKS (`RS256`, required claims: `sub`, `sid`, valid `iss`/`aud`).

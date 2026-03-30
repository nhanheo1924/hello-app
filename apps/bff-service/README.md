# BFF Service (Local)

NestJS gateway that exposes frontend-facing API under `/api/v1/*`.

## Local Run

```bash
cp .env.example .env
npm install
npm run start:dev
```

Default local URL: `http://localhost:3001/api/v1`

## Public Routes

- `/api/v1/auth/*` -> auth-service `/api/auth/*`
- `/api/v1/workspaces/*` -> task-service `/api/workspaces/*`
- `/api/v1/projects/*` -> task-service `/api/projects/*`
- `/api/v1/tasks/*` -> task-service `/api/tasks/*`
- `/api/v1/health`
- `/api/v1/health/ready`

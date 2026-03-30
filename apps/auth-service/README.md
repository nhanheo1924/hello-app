# Auth Service (Local)

NestJS + Prisma auth API.

## Local Run

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run start:dev
```

Default local URL: `http://localhost:3000/api`

## Local Requirements

- `DATABASE_URL` must point to direct local PostgreSQL (`localhost:5432` by default).
- In non-production, service blocks Docker-internal DB hosts and non-`5432` port.
- JWT keys are optional in development (ephemeral key pair is generated if empty).

## Core Endpoints

- `POST /api/auth/register`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /.well-known/jwks.json`
- `GET /api/health`
- `GET /api/health/ready`

## Notes

- In BFF mode, browser clients should use `bff-service` (`/api/v1/auth/*`) instead of calling auth-service directly.
- Business endpoints are protected by `x-proxy-secret`; only health/JWKS are public.
- Access-token-only session model (no refresh endpoint).
- `GET /api/auth/me` returns `user` with `id`, `email`, `fullName`.

# Huong Dan Chay Du An CTM Tren May Moi (Local)

Tai lieu nay de gui cho ban cua ban, chi dung cho local (khong deploy production).

## 1) Cai cac ung dung can thiet

- Git
- Node.js 20 LTS (kem npm)
- PostgreSQL 14+ (khuyen dung 16)

Kiem tra nhanh sau khi cai:

```bash
node -v
npm -v
```

## 2) Lay source code

```bash
git clone <repo-url>
cd ctm
```

Neu nhan source qua zip thi giai nen va mo terminal tai thu muc `ctm`.

## 3) Tao database PostgreSQL

Can co 1 database local, mac dinh:
- Host: `localhost`
- Port: `5432`
- DB name: `ctm-auth-service`

Neu dung psql, co the tao nhanh:

```sql
CREATE DATABASE "ctm-auth-service";
```

## 4) Tao file cau hinh goc

```bash
copy .env.example .env
```

Mo file `.env` va sua cac bien cho dung may:
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

Luu y:
- Neu PostgreSQL cua ban khong o cong `5432`, chi can doi `POSTGRES_PORT`.
- Script sync env se tu dong set `DB_REQUIRED_PORT` dung theo cong ban da chon.

## 5) Dong bo env cho tung app

```bash
npm run env:sync
```

Script nay tao:
- `apps/auth-service/.env`
- `apps/task-service/.env`
- `apps/web/.env.local`

## 6) Cai dependencies

```bash
npm run install:all
```

## 7) Generate + migrate database

```bash
npm run db:migrate
```

Script se:
- sync schema cho `auth-service`
- apply migration cho `task-service`

## 8) Chay he thong (3 terminal)

Terminal 1:

```bash
npm run dev:auth
```

Terminal 2:

```bash
npm run dev:task
```

Terminal 3:

```bash
npm run dev:web
```

## 9) Mo ung dung

- Frontend: `http://localhost:5173`
- Auth health: `http://localhost:3000/api/health/ready`
- Task health: `http://localhost:3002/api/health/ready`

## 10) Kiem tra full luong FE -> BE -> DB

Cach 1 (auth/task da chay san):

```bash
npm run verify:stack
```

Cach 2 (tu bat auth + task + verify):

```bash
npm run verify:local
```

Neu thanh cong se co dong `Verification successful`.

---

## Loi thuong gap

1. `Port already in use`
- Kiem tra cac cong: `3000`, `3002`, `5173`, `5432`.

2. `DATABASE_URL ... blocked` hoac khong ket noi DB
- Kiem tra lai `.env` goc.
- Chay lai:

```bash
npm run env:sync
npm run db:migrate
```

3. Chay duoc app nhung khong thay data trong DB
- Auth data nam o schema `public`.
- Task data nam o schema `task`.
- Can dang nhap truoc khi tao task/project de dong bo len DB.
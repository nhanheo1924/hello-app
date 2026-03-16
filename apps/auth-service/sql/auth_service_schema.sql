-- Auth Service database schema (direct PostgreSQL SQL)
-- Source of truth: prisma/schema.prisma + migrations in prisma/migrations
-- Safe to re-run (idempotent)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_revoke_reason') THEN
    CREATE TYPE session_revoke_reason AS ENUM (
      'NEW_LOGIN',
      'LOGOUT',
      'REFRESH_REUSE',
      'ADMIN',
      'SECURITY'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
    CREATE TYPE audit_action AS ENUM (
      'REGISTER',
      'LOGIN_OK',
      'LOGIN_FAIL',
      'REFRESH_OK',
      'REFRESH_FAIL',
      'LOGOUT',
      'SESSION_REVOKED',
      'SECURITY_EVENT'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  email_verified_at TIMESTAMP(3),
  last_login_at TIMESTAMP(3),
  full_name TEXT,
  google_id TEXT,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_temp_secret TEXT,
  two_factor_backup_codes JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  ip TEXT,
  user_agent TEXT,
  device_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP(3),
  revoked_at TIMESTAMP(3),
  revoke_reason session_revoke_reason,
  CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP(3) NOT NULL,
  revoked_at TIMESTAMP(3),
  replaced_by_token_id UUID,
  created_by_ip TEXT,
  created_by_user_agent TEXT,
  last_used_at TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT refresh_tokens_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions(id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email TEXT,
  ip TEXT,
  user_agent TEXT,
  action audit_action NOT NULL,
  detail JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key
  ON users(email);

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key
  ON users(google_id);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS sessions_revoked_at_idx
  ON sessions(revoked_at);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_user_idx
  ON sessions(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS refresh_tokens_session_id_idx
  ON refresh_tokens(session_id);

CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
  ON refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx
  ON refresh_tokens(token_hash);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx
  ON audit_logs(user_id);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON audit_logs(action);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON audit_logs(created_at);

COMMIT;

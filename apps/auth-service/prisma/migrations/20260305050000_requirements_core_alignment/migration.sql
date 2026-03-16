DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_revoke_reason') THEN
    CREATE TYPE session_revoke_reason AS ENUM ('NEW_LOGIN', 'LOGOUT', 'REFRESH_REUSE', 'ADMIN', 'SECURITY');
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

ALTER TABLE "User" RENAME TO users;
ALTER TABLE "RefreshToken" RENAME TO refresh_tokens;

ALTER TABLE users RENAME COLUMN "passwordHash" TO password_hash;
ALTER TABLE users RENAME COLUMN "fullName" TO full_name;
ALTER TABLE users RENAME COLUMN "googleId" TO google_id;
ALTER TABLE users RENAME COLUMN "twoFactorEnabled" TO two_factor_enabled;
ALTER TABLE users RENAME COLUMN "twoFactorSecret" TO two_factor_secret;
ALTER TABLE users RENAME COLUMN "twoFactorTempSecret" TO two_factor_temp_secret;
ALTER TABLE users RENAME COLUMN "twoFactorBackupCodes" TO two_factor_backup_codes;
ALTER TABLE users RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE users RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE users
  ADD COLUMN status user_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN email_verified_at TIMESTAMP(3),
  ADD COLUMN last_login_at TIMESTAMP(3);

ALTER TABLE refresh_tokens
  DROP CONSTRAINT IF EXISTS "RefreshToken_userId_fkey";

ALTER TABLE users
  ALTER COLUMN id TYPE UUID USING id::uuid;

ALTER TABLE refresh_tokens RENAME COLUMN "userId" TO user_id;
ALTER TABLE refresh_tokens RENAME COLUMN "tokenHash" TO token_hash;
ALTER TABLE refresh_tokens RENAME COLUMN "expiresAt" TO expires_at;
ALTER TABLE refresh_tokens RENAME COLUMN "revokedAt" TO revoked_at;
ALTER TABLE refresh_tokens RENAME COLUMN "replacedByTokenId" TO replaced_by_token_id;
ALTER TABLE refresh_tokens RENAME COLUMN "createdByIp" TO created_by_ip;
ALTER TABLE refresh_tokens RENAME COLUMN "createdByUserAgent" TO created_by_user_agent;
ALTER TABLE refresh_tokens RENAME COLUMN "lastUsedAt" TO last_used_at;
ALTER TABLE refresh_tokens RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE refresh_tokens RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE refresh_tokens
  ALTER COLUMN id TYPE UUID USING id::uuid,
  ALTER COLUMN user_id TYPE UUID USING user_id::uuid,
  ALTER COLUMN replaced_by_token_id TYPE UUID USING CASE
    WHEN replaced_by_token_id IS NULL THEN NULL
    ELSE replaced_by_token_id::uuid
  END;

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  device_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP(3),
  revoked_at TIMESTAMP(3),
  revoke_reason session_revoke_reason
);

ALTER TABLE refresh_tokens ADD COLUMN session_id UUID;

INSERT INTO sessions (
  id,
  user_id,
  ip,
  user_agent,
  created_at,
  last_seen_at,
  revoked_at,
  revoke_reason
)
SELECT
  id,
  user_id,
  created_by_ip,
  created_by_user_agent,
  created_at,
  COALESCE(last_used_at, created_at),
  revoked_at,
  CASE
    WHEN revoked_at IS NULL THEN NULL
    ELSE 'ADMIN'::session_revoke_reason
  END
FROM refresh_tokens
ON CONFLICT (id) DO NOTHING;

UPDATE refresh_tokens
SET session_id = id
WHERE session_id IS NULL;

ALTER TABLE refresh_tokens
  ALTER COLUMN session_id SET NOT NULL;

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE refresh_tokens DROP COLUMN user_id;

DROP INDEX IF EXISTS "RefreshToken_userId_idx";
DROP INDEX IF EXISTS "RefreshToken_expiresAt_idx";

CREATE INDEX refresh_tokens_session_id_idx ON refresh_tokens(session_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);
CREATE INDEX refresh_tokens_token_hash_idx ON refresh_tokens(token_hash);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_revoked_at_idx ON sessions(revoked_at);

WITH ranked_active_sessions AS (
  SELECT
    id,
    user_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS rank
  FROM sessions
  WHERE revoked_at IS NULL
),
revoked_duplicates AS (
  UPDATE sessions s
  SET
    revoked_at = CURRENT_TIMESTAMP,
    revoke_reason = 'NEW_LOGIN'::session_revoke_reason
  FROM ranked_active_sessions r
  WHERE s.id = r.id
    AND r.rank > 1
  RETURNING s.id
)
UPDATE refresh_tokens rt
SET revoked_at = CURRENT_TIMESTAMP
WHERE rt.session_id IN (SELECT id FROM revoked_duplicates)
  AND rt.revoked_at IS NULL;

CREATE UNIQUE INDEX sessions_one_active_per_user_idx
  ON sessions(user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  ip TEXT,
  user_agent TEXT,
  action audit_action NOT NULL,
  detail JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX audit_logs_action_idx ON audit_logs(action);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);

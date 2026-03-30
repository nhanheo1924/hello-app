DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'system_role') THEN
    CREATE TYPE system_role AS ENUM ('SUPER_ADMIN', 'SYSTEM_ADMIN', 'USER');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS system_role system_role NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS dob DATE,
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS locale VARCHAR(16);

UPDATE users
SET display_name = COALESCE(
  NULLIF(TRIM(display_name), ''),
  NULLIF(TRIM(full_name), ''),
  split_part(email, '@', 1)
);

CREATE INDEX IF NOT EXISTS users_status_system_role_idx
  ON users(status, system_role);

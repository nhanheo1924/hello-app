-- WARNING: destructive reset for auth-service schema
-- Run only when you want to recreate auth DB from scratch.

BEGIN;

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Legacy tables from early migrations (if still present)
DROP TABLE IF EXISTS "RefreshToken" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

DROP TYPE IF EXISTS audit_action CASCADE;
DROP TYPE IF EXISTS session_revoke_reason CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;

COMMIT;

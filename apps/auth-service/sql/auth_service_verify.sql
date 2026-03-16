-- Verify auth-service schema objects

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'sessions', 'refresh_tokens', 'audit_logs')
ORDER BY table_name;

SELECT typname AS enum_name
FROM pg_type
WHERE typname IN ('user_status', 'session_revoke_reason', 'audit_action')
ORDER BY typname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('users', 'sessions', 'refresh_tokens', 'audit_logs')
ORDER BY tablename, indexname;

SELECT
  (SELECT COUNT(*) FROM users) AS users_count,
  (SELECT COUNT(*) FROM sessions) AS sessions_count,
  (SELECT COUNT(*) FROM refresh_tokens) AS refresh_tokens_count,
  (SELECT COUNT(*) FROM audit_logs) AS audit_logs_count;

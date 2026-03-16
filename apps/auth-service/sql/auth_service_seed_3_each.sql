-- Seed data: 3 sample rows for each auth-service table
-- Plain password for all seeded users: Password123!

BEGIN;

INSERT INTO users (
  id,
  email,
  password_hash,
  status,
  email_verified_at,
  last_login_at,
  full_name,
  google_id,
  two_factor_enabled,
  two_factor_secret,
  two_factor_temp_secret,
  two_factor_backup_codes,
  created_at,
  updated_at
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'seed.user1@auth.local',
    '$argon2id$v=19$m=65536,t=3,p=4$zxYsV//RgkxbJ7gabTfF0A$gGIp3T4KTBLmAz+NJd0kxvkzDyAUQJu3YVIoePoM/WI',
    'ACTIVE'::user_status,
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 hours',
    'Seed User One',
    NULL,
    FALSE,
    NULL,
    NULL,
    NULL,
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 hours'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'seed.user2@auth.local',
    '$argon2id$v=19$m=65536,t=3,p=4$zxYsV//RgkxbJ7gabTfF0A$gGIp3T4KTBLmAz+NJd0kxvkzDyAUQJu3YVIoePoM/WI',
    'ACTIVE'::user_status,
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '30 minutes',
    'Seed User Two',
    NULL,
    FALSE,
    NULL,
    NULL,
    NULL,
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '30 minutes'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'seed.user3@auth.local',
    '$argon2id$v=19$m=65536,t=3,p=4$zxYsV//RgkxbJ7gabTfF0A$gGIp3T4KTBLmAz+NJd0kxvkzDyAUQJu3YVIoePoM/WI',
    'LOCKED'::user_status,
    NULL,
    NOW() - INTERVAL '10 days',
    'Seed User Three',
    NULL,
    FALSE,
    NULL,
    NULL,
    NULL,
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '10 days'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (
  id,
  user_id,
  ip,
  user_agent,
  device_id,
  created_at,
  last_seen_at,
  revoked_at,
  revoke_reason
)
VALUES
  (
    'a1111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '127.0.0.1',
    'Seed Browser 1',
    'seed-device-1',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 hours',
    NULL,
    NULL
  ),
  (
    'b2222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    '127.0.0.2',
    'Seed Browser 2',
    'seed-device-2',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '30 minutes',
    NULL,
    NULL
  ),
  (
    'c3333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333333',
    '127.0.0.3',
    'Seed Browser 3',
    'seed-device-3',
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '9 days',
    NOW() - INTERVAL '8 days',
    'LOGOUT'::session_revoke_reason
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO refresh_tokens (
  id,
  session_id,
  token_hash,
  created_at,
  expires_at,
  revoked_at,
  replaced_by_token_id,
  created_by_ip,
  created_by_user_agent,
  last_used_at,
  updated_at
)
VALUES
  (
    'd1111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111111',
    'seed_hash_token_1',
    NOW() - INTERVAL '2 days',
    NOW() + INTERVAL '5 days',
    NOW() - INTERVAL '1 day',
    'e2222222-2222-4222-8222-222222222222',
    '127.0.0.1',
    'Seed Browser 1',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  ),
  (
    'e2222222-2222-4222-8222-222222222222',
    'b2222222-2222-4222-8222-222222222222',
    'seed_hash_token_2',
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '6 days',
    NULL,
    NULL,
    '127.0.0.2',
    'Seed Browser 2',
    NOW() - INTERVAL '30 minutes',
    NOW() - INTERVAL '30 minutes'
  ),
  (
    'f3333333-3333-4333-8333-333333333333',
    'c3333333-3333-4333-8333-333333333333',
    'seed_hash_token_3',
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '8 days',
    NULL,
    '127.0.0.3',
    'Seed Browser 3',
    NOW() - INTERVAL '9 days',
    NOW() - INTERVAL '8 days'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_logs (
  id,
  user_id,
  email,
  ip,
  user_agent,
  action,
  detail,
  created_at
)
VALUES
  (
    '90000001-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'seed.user1@auth.local',
    '127.0.0.1',
    'Seed Browser 1',
    'REGISTER'::audit_action,
    '{"source":"seed_script","note":"sample register log"}'::jsonb,
    NOW() - INTERVAL '2 days'
  ),
  (
    '90000002-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'seed.user2@auth.local',
    '127.0.0.2',
    'Seed Browser 2',
    'LOGIN_OK'::audit_action,
    '{"source":"seed_script","provider":"password"}'::jsonb,
    NOW() - INTERVAL '1 day'
  ),
  (
    '90000003-0000-4000-8000-000000000003',
    '33333333-3333-4333-8333-333333333333',
    'seed.user3@auth.local',
    '127.0.0.3',
    'Seed Browser 3',
    'SECURITY_EVENT'::audit_action,
    '{"source":"seed_script","type":"REFRESH_REUSE_DETECTED"}'::jsonb,
    NOW() - INTERVAL '8 days'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

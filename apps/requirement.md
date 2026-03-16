AUTH SERVICE REQUIREMENTS (CTM / nhanctm.site)
Version: 1.0 (MVP Production-minded)

Scope
1.1. Hệ thống là Auth Service độc lập trong kiến trúc microservices.
1.2. MVP chỉ hỗ trợ đăng ký/đăng nhập bằng Email + Password.
1.3. Có Refresh Token bắt buộc (đồ án) + rotation + reuse detection.
1.4. JWT ký bằng RS256. Auth service giữ private key, publish public keys qua JWKS.
1.5. Rule: 1 user = 1 session active. Đăng nhập mới phải revoke session cũ ngay.
1.6. Backend chạy server riêng, public qua Cloudflared tunnel domain api.nhanctm.site. (ZTA layer đã làm xong, không nằm trong scope code.)

Non-functional requirements (NFR)
2.1. Security-first:

Không lưu refresh token dạng plain trong DB, chỉ lưu hash.

Password hash dùng argon2id.

Access token short-lived (10–15 phút).

Refresh token long-lived (7–30 ngày) và bắt buộc rotate mỗi lần refresh.

Phát hiện refresh token reuse → revoke toàn bộ session ngay.
2.2. Reliability:

LOGIN và REFRESH phải chạy trong DB transaction để tránh trạng thái nửa vời.

Nếu lỗi giữa chừng, rollback đảm bảo dữ liệu không lệch.
2.3. Observability:

Có audit logs cho các hành động auth nhạy cảm (login fail/success, refresh fail/success, logout, session revoked).
2.4. Compatibility:

Service khác phải verify access token mà không gọi Auth (bằng JWKS + RS256).
2.5. Performance:

JWKS endpoint public, có thể cache phía service khác 5–15 phút.

Data model requirements (Postgres)
3.1. USERS

id (uuid, PK)

email (unique, normalized lowercase)

password_hash (argon2id)

status (ACTIVE|LOCKED|DISABLED)

email_verified_at (nullable)

last_login_at (nullable)

created_at, updated_at
3.2. SESSIONS

id (uuid, PK) = sid

user_id (FK)

ip (nullable)

user_agent (nullable)

device_id (nullable)

created_at, last_seen_at

revoked_at (nullable)

revoke_reason (NEW_LOGIN|LOGOUT|REFRESH_REUSE|ADMIN|SECURITY)
3.3. REFRESH_TOKENS

id (uuid, PK) = jti

session_id (FK)

token_hash (string)

created_at, expires_at

revoked_at (nullable)

replaced_by_token_id (nullable)
3.4. AUDIT_LOGS

id (uuid, PK)

user_id (nullable)

email (nullable)

ip (nullable)

user_agent (nullable)

action (REGISTER|LOGIN_OK|LOGIN_FAIL|REFRESH_OK|REFRESH_FAIL|LOGOUT|SESSION_REVOKED|SECURITY_EVENT)

detail (nullable)

created_at

Token requirements
4.1. Access Token (RS256 JWT)

TTL: 10–15 minutes

Required claims:

iss = "https://api.nhanctm.site
"

aud = "ctm-web" (hoặc ctm-hello tùy service)

sub = userId

sid = sessionId

iat, exp

Must verify: signature, iss, aud, exp.
4.2. Refresh Token

TTL: 7–30 days

Must be rotated every refresh.

Server stores only token_hash.

Must be bound to session_id.

Must support reuse detection:

Nếu token đã bị revoke mà vẫn được gửi lại → coi như compromised.

API requirements (contract)
5.1. POST /auth/register
Input:

email, password (+ optional profile fields)
Rules:

normalize email

email unique

password policy (min length >= 8; recommended >= 10)

store argon2id hash
Output:

201 + user basic (id, email)
Errors:

409 EMAIL_EXISTS

400 VALIDATION_ERROR

5.2. POST /auth/login
Input:

email, password

optional: deviceId
Rules:

rate limit per IP + email

verify password

MUST enforce 1-session rule:

revoke all active sessions of user before creating new session

MUST issue:

accessToken (RS256) with sid

refreshToken (new) stored hashed in DB
Output:

200 + { accessToken, refreshToken, expiresIn, session: { sid } }
Errors:

401 INVALID_CREDENTIALS

423 LOCKED (optional)
Audit:

LOGIN_FAIL on fail

LOGIN_OK on success

SESSION_REVOKED with reason NEW_LOGIN if any old session existed

5.3. POST /auth/refresh
Input:

refreshToken
Rules:

rate limit

find refresh token record by token_hash and revoked_at is null

check expires_at

check session is active (revoked_at is null)

MUST rotate:

revoke old refresh token, set replaced_by_token_id

insert new refresh token record

issue new access token + new refresh token
Reuse detection (mandatory):

if refresh token record exists but revoked_at not null OR token maps to already replaced token:

revoke session immediately (reason REFRESH_REUSE)

revoke all refresh_tokens of session

return 401 SESSION_COMPROMISED
Output:

200 + { accessToken, refreshToken, expiresIn }
Errors:

401 REFRESH_INVALID / REFRESH_EXPIRED / SESSION_REVOKED / SESSION_COMPROMISED
Audit:

REFRESH_OK / REFRESH_FAIL / SECURITY_EVENT

5.4. POST /auth/logout
Input:

accessToken (preferred) OR refreshToken
Rules:

revoke session by sid

revoke all refresh tokens of session
Output:

204
Audit:

LOGOUT

5.5. GET /auth/me
Input:

accessToken
Rules:

verify JWT signature RS256 + iss/aud/exp

OPTIONAL: check session active by sid (strict mode). Nếu strict thì call DB sessions.
Output:

200 + user safe fields (id, email, status, createdAt)

5.6. GET /.well-known/jwks.json
Rules:

public endpoint

returns current public key(s) with kid

must support key rotation (multiple keys in JWKS, one active for signing)
Output:

200 JWK Set

Service-to-service requirements (Microservices)
6.1. Downstream services (Task Service) MUST:

Fetch JWKS, cache by kid

Verify RS256 tokens locally

Reject tokens with invalid iss/aud/exp/signature
6.2. Auth service MUST keep signing key private and never expose it.

Validation & error format requirements
7.1. All endpoints must validate input (DTO + class-validator).
7.2. Error response format consistent:

{ code: string, message: string, details?: any }
7.3. No sensitive info in errors (không nói “email tồn tại hay không” ở login; chỉ INVALID_CREDENTIALS).

Testing requirements (minimum)
8.1. Unit tests:

Password hashing/verify

Token signing & verify

Refresh rotation logic

Reuse detection triggers session revoke
8.2. Integration tests:

login → access ok → refresh ok (token rotated)

login lần 2 → session cũ bị revoke → refresh token cũ fail

reuse refresh token cũ → session compromised

Done criteria (Definition of Done)

Deploy được qua api.nhanctm.site, endpoints hoạt động theo contract.

1-session rule hoạt động đúng: login mới đá login cũ.

Refresh rotation đúng và reuse detection có hiệu lực.

JWKS endpoint dùng được, Task service verify token được.

Audit logs ghi đầy đủ các action chính.
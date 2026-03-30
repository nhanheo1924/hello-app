CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
  id UUID NOT NULL,
  code_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  consumed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT oauth_exchange_codes_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS oauth_exchange_codes_code_hash_key
  ON oauth_exchange_codes(code_hash);

CREATE INDEX IF NOT EXISTS oauth_exchange_codes_expires_at_idx
  ON oauth_exchange_codes(expires_at);

-- Enable UUID generator (works on most Postgres installs)
-- If your Postgres doesn't allow extensions, replace gen_random_uuid() usage
-- with uuid_generate_v4() and enable uuid-ossp extension instead.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- OTP codes stored hashed (never store plaintext OTP)
CREATE TABLE IF NOT EXISTS otps (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otps_email_idx ON otps(email);

-- Session token stored hashed too
CREATE TABLE IF NOT EXISTS sessions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Basecamp tokens per user (1 row per user)
CREATE TABLE IF NOT EXISTS basecamp_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  default_account_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful cleanup indexes
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS otps_expires_idx ON otps(expires_at);

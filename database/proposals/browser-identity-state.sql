-- Standalone deployment proposal; NOT included in production migrations or preview bootstrap.
-- Run as a dedicated migration owner only after staging account/secret/runtime-role review.
-- The application encrypts every payload with AES-256-GCM and binds it to its scoped key.
-- Runtime must not own this table or schema. Grant only USAGE on identity and
-- SELECT, INSERT, UPDATE, DELETE on identity.browser_state to a dedicated identity runtime login.
-- Never grant these permissions to the ordinary tenant API/browser database login.
CREATE SCHEMA identity;
CREATE TABLE identity.browser_state (
  key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}:(login|session):[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('login', 'session')),
  sealed text NOT NULL CHECK (length(sealed) BETWEEN 39 AND 32768),
  expires_at bigint NOT NULL CHECK (expires_at > 0),
  claimed boolean NOT NULL DEFAULT false,
  issued_session_key text,
  state_hash text,
  CHECK ((kind='login' AND state_hash IS NOT NULL AND state_hash ~ '^[0-9a-f]{64}$') OR (kind='session' AND state_hash IS NULL)),
  CHECK (issued_session_key IS NULL OR (kind='login' AND claimed AND
    issued_session_key ~ '^[0-9a-f]{64}:session:[0-9a-f]{64}$' AND
    split_part(issued_session_key, ':', 1)=split_part(key, ':', 1))),
  CHECK (split_part(key, ':', 2) = kind)
);
CREATE INDEX browser_state_expiry ON identity.browser_state (expires_at);
CREATE UNIQUE INDEX browser_state_issued_session ON identity.browser_state (issued_session_key)
  WHERE issued_session_key IS NOT NULL;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
REVOKE ALL ON identity.browser_state FROM PUBLIC;

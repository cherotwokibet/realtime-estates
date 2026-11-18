-- Standalone deployment proposal; NOT included in production migrations or preview bootstrap.
-- Run as a dedicated migration owner only after staging account/secret/runtime-role review.
-- The application encrypts every payload with AES-256-GCM and binds it to its scoped key.
-- Runtime must not own this table or schema. Grant only USAGE on identity and
-- SELECT, INSERT, DELETE on identity.browser_state to a dedicated identity runtime login.
-- Never grant these permissions to the ordinary tenant API/browser database login.
CREATE SCHEMA identity;
CREATE TABLE identity.browser_state (
  key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}:(login|session):[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('login', 'session')),
  sealed text NOT NULL CHECK (length(sealed) BETWEEN 39 AND 32768),
  expires_at bigint NOT NULL CHECK (expires_at > 0),
  CHECK (split_part(key, ':', 2) = kind)
);
CREATE INDEX browser_state_expiry ON identity.browser_state (expires_at);
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
REVOKE ALL ON identity.browser_state FROM PUBLIC;

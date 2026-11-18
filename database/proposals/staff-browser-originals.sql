-- Standalone staging proposal; not an accepted production migration.
-- Apply after browser-identity-state.sql. Dedicated identity runtime, not ordinary API runtime.
-- Branch commands only; no invitation secrets, bearer tokens or role-granting payloads.
CREATE TABLE identity.staff_browser_originals (
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  sealed text NOT NULL CHECK (length(sealed) BETWEEN 39 AND 16384),
  recovery_missing boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, actor_id)
);
REVOKE ALL ON identity.staff_browser_originals FROM PUBLIC;
-- Grant SELECT/INSERT/UPDATE/DELETE to the reviewed dedicated identity runtime only.

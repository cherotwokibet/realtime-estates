-- Standalone staging proposal, not an accepted production migration.
-- Apply after browser-identity-state.sql as migration owner. Dedicated identity runtime only.
-- One outstanding original per actor/company, retained across browser sessions and server restarts.
CREATE TABLE identity.customer_browser_originals (
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  sealed text NOT NULL CHECK (length(sealed) BETWEEN 39 AND 4096),
  recovery_missing boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, actor_id)
);
REVOKE ALL ON identity.customer_browser_originals FROM PUBLIC;
-- Grant SELECT/INSERT/UPDATE/DELETE to the dedicated identity runtime after role review.

-- Standalone staging proposal, outside the accepted migration sequence.
-- Requires the dedicated identity schema from browser-identity-state.sql.
-- Runtime receives SELECT only; a separately reviewed enrollment role writes bindings.
-- Binding an actor does not grant membership in any realtor company.
CREATE TABLE identity.firebase_actor_bindings (
  project_id text NOT NULL CHECK (project_id ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'),
  auth_tenant_id text NOT NULL DEFAULT '' CHECK (auth_tenant_id ~ '^[A-Za-z0-9_-]{0,128}$'),
  firebase_uid text NOT NULL CHECK (length(firebase_uid) BETWEEN 1 AND 128),
  actor_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (project_id,auth_tenant_id,firebase_uid)
);
REVOKE ALL ON identity.firebase_actor_bindings FROM PUBLIC;

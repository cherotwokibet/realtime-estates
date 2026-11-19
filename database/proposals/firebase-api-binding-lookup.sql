-- Standalone staging proposal; not a normal migration or an enrollment API.
-- Apply after firebase-actor-bindings.sql. Ordinary API role gets only this scoped lookup.
BEGIN;
GRANT USAGE ON SCHEMA identity TO realtor_owner;
GRANT SELECT ON identity.firebase_actor_bindings TO realtor_owner;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.resolve_firebase_actor(p_project text,p_auth_tenant text,p_uid text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.actor_id FROM identity.firebase_actor_bindings b
 JOIN app_private.memberships m ON m.user_id=b.actor_id
 WHERE b.project_id=p_project AND b.auth_tenant_id=COALESCE(p_auth_tenant,'')
 AND b.firebase_uid=p_uid AND b.active
 AND m.tenant_id=app_private.context_tenant() AND m.active AND m.revoked_at IS NULL
$$;
REVOKE ALL ON FUNCTION app_api.resolve_firebase_actor(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.resolve_firebase_actor(text,text,text) TO api_runtime;
COMMIT;

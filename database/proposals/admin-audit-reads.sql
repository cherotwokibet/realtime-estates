-- Isolated synthetic candidate. Not installed by the normal migration runner.
-- Metadata only: summaries, reasons, contact details and arbitrary correlation text
-- are deliberately excluded. No mutation or impersonation entrypoint is added.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE INDEX audit_tenant_id_desc ON app_private.audit_events(tenant_id,id DESC);
CREATE FUNCTION app_api.list_admin_audit_events(
 p_limit integer, p_before bigint, p_actor uuid, p_object uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows_json jsonb; more boolean; next_id bigint;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
  OR (p_before IS NOT NULL AND p_before<=0) THEN
  RAISE EXCEPTION 'Invalid audit page' USING ERRCODE='23514';
 END IF;
 WITH bounded AS (
  SELECT id,actor_id,action,object_type,object_id,object_version,occurred_at
  FROM app_private.audit_events
  WHERE tenant_id=app_private.context_tenant()
   AND (p_before IS NULL OR id<p_before)
   AND (p_actor IS NULL OR actor_id=p_actor)
   AND (p_object IS NULL OR object_id=p_object)
  ORDER BY id DESC LIMIT p_limit+1
 ), page AS (SELECT * FROM bounded ORDER BY id DESC LIMIT p_limit)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id::text,'actorId',actor_id,'action',action,'objectType',object_type,
   'objectId',object_id,'objectVersion',object_version::text,
   'occurredAt',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) ORDER BY id DESC) FROM page),'[]'::jsonb),
  (SELECT count(*)>p_limit FROM bounded),
  (SELECT min(id) FROM page)
 INTO rows_json,more,next_id;
 RETURN jsonb_build_object('policy','admin-audit-page-v1',
  'tenantId',app_private.context_tenant(),'items',rows_json,
  'nextBefore',CASE WHEN more THEN next_id::text ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION app_api.list_admin_audit_events(integer,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_admin_audit_events(integer,bigint,uuid,uuid) TO api_runtime;
COMMIT;

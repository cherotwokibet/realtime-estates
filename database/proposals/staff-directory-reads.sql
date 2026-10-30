-- Isolated bounded private staff directory reads. Requires both staff candidates.
-- Not a normal migration, preview bootstrap or production entrypoint.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.list_staff_branches(p_limit integer, p_after uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows_json jsonb; more boolean; next_id uuid;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514';
 END IF;
 WITH latest AS (
  SELECT DISTINCT ON (branch_id) * FROM app_private.staff_branch_operations
  WHERE tenant_id=app_private.context_tenant() AND outcome='applied'
   AND (p_after IS NULL OR branch_id>p_after)
  ORDER BY branch_id,observed_version DESC
 ), bounded AS (SELECT * FROM latest ORDER BY branch_id LIMIT p_limit+1),
 page AS (SELECT * FROM bounded ORDER BY branch_id LIMIT p_limit)
 SELECT coalesce((SELECT jsonb_agg(
  (app_private.staff_branch_record_json(p)-'reason'-'actorId'-'operationId'-'expectedVersion'-'outcome')
   || jsonb_build_object('policy','staff-branch-current-v1') ORDER BY p.branch_id)
  FROM page p),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM bounded),
 (SELECT branch_id FROM page ORDER BY branch_id DESC LIMIT 1)
 INTO rows_json,more,next_id;
 RETURN jsonb_build_object('policy','staff-branch-page-v1','items',rows_json,
  'nextAfter',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
CREATE FUNCTION app_api.list_staff_invitation_requests(p_limit integer, p_after uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows_json jsonb; more boolean; next_id uuid;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514';
 END IF;
 WITH bounded AS (
  SELECT operation_id FROM app_private.staff_invitation_requests
  WHERE tenant_id=app_private.context_tenant() AND (p_after IS NULL OR operation_id>p_after)
  ORDER BY operation_id LIMIT p_limit+1
 ), page AS (SELECT operation_id FROM bounded ORDER BY operation_id LIMIT p_limit)
 SELECT coalesce((SELECT jsonb_agg(app_api.read_staff_invitation_state(operation_id)
  ORDER BY operation_id) FROM page),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM bounded),
 (SELECT operation_id FROM page ORDER BY operation_id DESC LIMIT 1)
 INTO rows_json,more,next_id;
 RETURN jsonb_build_object('policy','staff-invitation-page-v1','items',rows_json,
  'nextAfter',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION app_api.list_staff_branches(integer,uuid),app_api.list_staff_invitation_requests(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_staff_branches(integer,uuid),app_api.list_staff_invitation_requests(integer,uuid) TO api_runtime;
COMMIT;

BEGIN;
SET LOCAL ROLE realtor_owner;

-- Saved projections come from the existing immutable ledger, not a second mutable copy.
CREATE FUNCTION app_api.read_viewing_history(p_enquiry uuid,p_viewing uuid,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_enquiry app_private.enquiries;v_viewing app_private.viewings;
 v_items jsonb;v_count integer;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_viewing IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25
  THEN RAISE EXCEPTION 'Invalid viewing history request' USING ERRCODE='23514';END IF;
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v_viewing FROM app_private.viewings WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND id=p_viewing;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY saved_version DESC) FILTER(WHERE position<=p_limit),'[]'::jsonb),count(*) INTO v_items,v_count FROM (
  SELECT jsonb_build_object('kind',operation.kind,'actorId',operation.requester_id,
   'recordedAt',app_private.enquiry_utc(operation.created_at),'schedule',operation.receipt->'result') item,
   (operation.receipt->'result'->>'version')::bigint saved_version,
   row_number() OVER(ORDER BY (operation.receipt->'result'->>'version')::bigint DESC) position
  FROM app_private.viewing_operations operation
  WHERE operation.tenant_id=v_tenant AND operation.enquiry_id=p_enquiry AND operation.viewing_id=p_viewing
   AND operation.receipt->>'outcome'='applied'
 ) saved;
 RETURN jsonb_build_object('items',v_items,'limit',p_limit,'truncated',v_count>p_limit,'currentVersion',v_viewing.version::text);
END $$;
REVOKE ALL ON FUNCTION app_api.read_viewing_history(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_viewing_history(uuid,uuid,integer) TO api_runtime;
COMMIT;

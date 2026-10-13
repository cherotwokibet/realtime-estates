BEGIN;
-- Minimal team-visible activity, separate from requester-private command receipts.
CREATE INDEX enquiry_activity_lookup ON app_private.enquiry_operations(tenant_id,enquiry_id,created_at DESC,operation_id);
CREATE FUNCTION app_api.list_enquiry_activity(p_enquiry uuid,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_enquiry app_private.enquiries;v_items jsonb;v_count integer;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='23514';END IF;
  SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
  IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY version DESC,event_id) FILTER(WHERE position<=p_limit),'[]'::jsonb),count(*)
    INTO v_items,v_count FROM (
      SELECT *,row_number() OVER(ORDER BY version DESC,event_id) AS position FROM (
        SELECT *,jsonb_build_object('eventId',event_id,'kind',kind,'actorId',actor_id,
          'occurredAt',app_private.enquiry_utc(occurred_at),'version',version::text,
          'status',status,'assignedAgentId',assigned_agent_id,'nextActionAt',next_action_at) AS item
        FROM (
          SELECT v_enquiry.id AS event_id,'received'::text AS kind,v_enquiry.requested_by_id AS actor_id,
            v_enquiry.created_at AS occurred_at,1::bigint AS version,'new'::text AS status,
            NULL::uuid AS assigned_agent_id,NULL::text AS next_action_at
          UNION ALL
          SELECT operation_id,kind,requester_id,created_at,(receipt->'result'->>'version')::bigint,
            receipt->'result'->>'status',(receipt->'result'->>'assignedAgentId')::uuid,
            receipt->'result'->>'nextActionAt'
          FROM app_private.enquiry_operations WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND receipt->>'outcome'='applied'
        ) events ORDER BY version DESC,event_id LIMIT p_limit+1
      ) bounded
    ) numbered;
  RETURN jsonb_build_object('items',v_items,'limit',p_limit,'truncated',v_count>p_limit,
    'coverage','capture-and-v2-operations','currentVersion',v_enquiry.version::text);
END $$;
REVOKE ALL ON FUNCTION app_api.list_enquiry_activity(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_enquiry_activity(uuid,integer) TO api_runtime;
COMMIT;

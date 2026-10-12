-- Additive authenticated enquiry commands and original-command recovery.
-- Legacy RPCs remain unchanged; only these new commands promise durable receipts.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE FUNCTION app_private.enquiry_utc(p_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION app_private.enquiry_time_valid(p_time timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(isfinite(p_time) AND extract(year FROM p_time AT TIME ZONE 'UTC') BETWEEN 1 AND 9999
    AND p_time=(date_trunc('milliseconds',p_time AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),false)
$$;
CREATE FUNCTION app_private.enquiry_reason_valid(p_reason text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(char_length(p_reason) BETWEEN 1 AND 1000
    AND p_reason=btrim(p_reason,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    AND p_reason !~ '[[:cntrl:]]' AND p_reason !~ U&'[\007f-\009f]',false)
$$;
CREATE FUNCTION app_private.enquiry_request_valid(p_kind text,p_assigned uuid,p_status text,p_next timestamptz,p_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(CASE p_kind
    WHEN 'assign' THEN p_assigned IS NOT NULL AND p_status IS NULL AND p_next IS NULL AND p_reason IS NULL
    WHEN 'reschedule' THEN p_assigned IS NULL AND p_status IS NULL AND app_private.enquiry_time_valid(p_next) AND p_reason IS NULL
    WHEN 'transition' THEN p_assigned IS NULL
      AND p_status IN ('new','assigned','contacted','qualified','closed_won','closed_lost','spam')
      AND CASE WHEN p_status IN ('contacted','qualified') THEN app_private.enquiry_time_valid(p_next) ELSE p_next IS NULL END
      AND CASE WHEN p_status IN ('new','assigned','closed_lost','spam') THEN app_private.enquiry_reason_valid(p_reason) ELSE p_reason IS NULL END
    ELSE false END,false)
$$;

CREATE TABLE app_private.enquiry_operations (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL, enquiry_id uuid NOT NULL, requester_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('assign','transition','reschedule')),
  expected_version bigint NOT NULL CHECK (expected_version BETWEEN 1 AND 9007199254740990),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object' AND octet_length(request_payload::text)<=8192),
  request_sha256 text NOT NULL CHECK (request_sha256=encode(sha256(convert_to(request_payload::text,'UTF8')),'hex')),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384),
  created_at timestamptz NOT NULL CHECK (app_private.enquiry_time_valid(created_at)),
  PRIMARY KEY (tenant_id,operation_id),
  FOREIGN KEY (tenant_id,enquiry_id) REFERENCES app_private.enquiries(tenant_id,id),
  FOREIGN KEY (tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE FUNCTION app_private.validate_enquiry_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_request jsonb;v_result jsonb;v_payload jsonb;v_receipt jsonb;
  v_assigned uuid;v_status text;v_next timestamptz;v_text text;
  v_version bigint;v_result_status text;v_result_assigned uuid;v_result_next timestamptz;v_closure text;
  v_outcome text;v_reason text;
BEGIN
  v_request:=NEW.request_payload->'request';v_result:=NEW.receipt->'result';
  v_assigned:=(v_request->>'assignedAgentId')::uuid;v_status:=v_request->>'status';
  v_next:=(v_request->>'nextActionAt')::timestamptz;v_text:=v_request->>'reason';
  IF NOT app_private.enquiry_request_valid(NEW.kind,v_assigned,v_status,v_next,v_text) THEN
    RAISE EXCEPTION 'Invalid enquiry operation request' USING ERRCODE='23514';END IF;
  v_request:=jsonb_build_object('assignedAgentId',v_assigned,'status',v_status,
    'nextActionAt',app_private.enquiry_utc(v_next),'reason',v_text);
  v_payload:=jsonb_build_object('kind',NEW.kind,'tenantId',NEW.tenant_id,'actorId',NEW.requester_id,
    'enquiryId',NEW.enquiry_id,'operationId',NEW.operation_id,'expectedVersion',NEW.expected_version::text,'request',v_request);
  IF jsonb_typeof(v_result->'version') IS DISTINCT FROM 'string' OR (v_result->>'version') !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'Invalid enquiry result version' USING ERRCODE='23514';END IF;
  v_version:=(v_result->>'version')::bigint;v_result_status:=v_result->>'status';
  v_result_assigned:=(v_result->>'assignedAgentId')::uuid;v_result_next:=(v_result->>'nextActionAt')::timestamptz;
  v_closure:=v_result->>'closureReason';v_outcome:=NEW.receipt->>'outcome';v_reason:=NEW.receipt->>'reason';
  IF v_version NOT BETWEEN 1 AND 9007199254740991
    OR v_result_status IS NULL OR v_result_status NOT IN ('new','assigned','contacted','qualified','closed_won','closed_lost','spam')
    OR (v_result_next IS NOT NULL AND NOT app_private.enquiry_time_valid(v_result_next))
    OR (v_result_status IN ('contacted','qualified') AND v_result_next IS NULL)
    OR (v_result_status IN ('closed_lost','spam') AND coalesce(length(btrim(v_closure)),0)=0) THEN
    RAISE EXCEPTION 'Invalid enquiry result' USING ERRCODE='23514';END IF;
  v_result:=jsonb_build_object('version',v_version::text,'status',v_result_status,'assignedAgentId',v_result_assigned,
    'nextActionAt',app_private.enquiry_utc(v_result_next),'closureReason',v_closure);
  v_receipt:=jsonb_build_object('operationId',NEW.operation_id,'enquiryId',NEW.enquiry_id,'kind',NEW.kind,
    'expectedVersion',NEW.expected_version::text,'request',v_request,'outcome',v_outcome,'reason',v_reason,
    'result',v_result,'completedAt',app_private.enquiry_utc(NEW.created_at));
  IF NEW.request_payload IS DISTINCT FROM v_payload OR NEW.receipt IS DISTINCT FROM v_receipt OR NOT coalesce(
    (v_outcome='applied' AND v_reason IS NULL AND v_version=NEW.expected_version+1)
    OR (v_outcome='noop' AND NEW.kind IN ('assign','reschedule') AND v_reason IS NULL AND v_version=NEW.expected_version)
    OR (v_outcome='conflict' AND v_reason='VERSION_CONFLICT' AND v_version<>NEW.expected_version)
    OR (v_outcome='rejected' AND v_version=NEW.expected_version AND
      ((NEW.kind='assign' AND v_reason='ASSIGNEE_UNAVAILABLE') OR
       (NEW.kind IN ('transition','reschedule') AND v_reason='INVALID_TRANSITION'))),false)
    OR (v_outcome IN ('applied','noop') AND NOT coalesce(CASE NEW.kind
      WHEN 'assign' THEN v_result_assigned=v_assigned AND v_result_status<>'new'
      WHEN 'transition' THEN v_result_status=v_status AND v_result_next IS NOT DISTINCT FROM v_next AND v_closure IS NOT DISTINCT FROM v_text
      WHEN 'reschedule' THEN v_result_status IN ('contacted','qualified') AND v_result_next=v_next ELSE false END,false)) THEN
    RAISE EXCEPTION 'Invalid enquiry operation' USING ERRCODE='23514';END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_enquiry_operation BEFORE INSERT ON app_private.enquiry_operations
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_enquiry_operation();
CREATE FUNCTION app_private.immutable_enquiry_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Enquiry operation receipts are immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER immutable_enquiry_operation BEFORE UPDATE OR DELETE ON app_private.enquiry_operations
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
ALTER TABLE app_private.enquiry_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.enquiry_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.enquiry_operations TO realtor_owner USING (true) WITH CHECK (true);

CREATE FUNCTION app_api.execute_enquiry_operation(p_enquiry uuid,p_operation uuid,p_expected bigint,p_kind text,
  p_assigned uuid,p_status text,p_next timestamptz,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
  v_enquiry app_private.enquiries;v_operation app_private.enquiry_operations;v_request jsonb;v_payload jsonb;v_digest text;
  v_outcome text:='applied';v_reason text;v_receipt jsonb;v_now timestamptz;v_allowed boolean;
BEGIN
  PERFORM app_private.assert_staff(CASE WHEN p_kind='assign' THEN ARRAY['admin'] ELSE ARRAY['agent','admin'] END);
  IF p_enquiry IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990
    OR NOT app_private.enquiry_request_valid(p_kind,p_assigned,p_status,p_next,p_reason) THEN
    RAISE EXCEPTION 'Invalid enquiry request' USING ERRCODE='23514';END IF;
  SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
  IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/enquiry/' || p_operation::text,0));
  v_request:=jsonb_build_object('assignedAgentId',p_assigned,'status',p_status,'nextActionAt',app_private.enquiry_utc(p_next),'reason',p_reason);
  v_payload:=jsonb_build_object('kind',p_kind,'tenantId',v_tenant,'actorId',v_actor,'enquiryId',p_enquiry,
    'operationId',p_operation,'expectedVersion',p_expected::text,'request',v_request);
  v_digest:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  SELECT * INTO v_operation FROM app_private.enquiry_operations WHERE tenant_id=v_tenant AND operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
    IF v_operation.enquiry_id<>p_enquiry OR v_operation.requester_id<>v_actor OR v_operation.kind<>p_kind
      OR v_operation.expected_version<>p_expected OR v_operation.request_payload IS DISTINCT FROM v_payload
      OR v_operation.request_sha256<>v_digest THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
    RETURN v_operation.receipt;
  END IF;
  IF v_enquiry.version NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Unsupported enquiry version' USING ERRCODE='23514';END IF;
  IF v_enquiry.version<>p_expected THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
  ELSIF p_kind='assign' THEN
    IF NOT EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=v_tenant AND user_id=p_assigned AND active AND role IN ('agent','admin')) THEN
      v_outcome:='rejected';v_reason:='ASSIGNEE_UNAVAILABLE';
    ELSIF v_enquiry.assigned_agent_id=p_assigned AND v_enquiry.status<>'new' THEN v_outcome:='noop';END IF;
  ELSIF p_kind='reschedule' THEN
    IF v_enquiry.status NOT IN ('contacted','qualified') THEN v_outcome:='rejected';v_reason:='INVALID_TRANSITION';
    ELSIF v_enquiry.next_action_at=p_next THEN v_outcome:='noop';END IF;
  ELSE
    v_allowed:=(v_enquiry.status='assigned' AND p_status='contacted')
      OR (v_enquiry.status='contacted' AND p_status='qualified')
      OR (v_enquiry.status IN ('new','assigned','contacted','qualified') AND p_status IN ('closed_lost','spam'))
      OR (v_enquiry.status='qualified' AND p_status='closed_won')
      OR (v_enquiry.status IN ('closed_won','closed_lost','spam') AND
        p_status=CASE WHEN v_enquiry.assigned_agent_id IS NULL THEN 'new' ELSE 'assigned' END);
    IF NOT v_allowed THEN v_outcome:='rejected';v_reason:='INVALID_TRANSITION';END IF;
  END IF;
  IF v_outcome='applied' THEN
    IF p_kind='assign' THEN UPDATE app_private.enquiries SET assigned_agent_id=p_assigned,
      status=CASE WHEN status='new' THEN 'assigned' ELSE status END WHERE tenant_id=v_tenant AND id=p_enquiry RETURNING * INTO v_enquiry;
    ELSIF p_kind='reschedule' THEN UPDATE app_private.enquiries SET next_action_at=p_next
      WHERE tenant_id=v_tenant AND id=p_enquiry RETURNING * INTO v_enquiry;
    ELSE UPDATE app_private.enquiries SET status=p_status,next_action_at=p_next,closure_reason=p_reason
      WHERE tenant_id=v_tenant AND id=p_enquiry RETURNING * INTO v_enquiry;END IF;
    PERFORM app_private.audit('enquiry.' || p_kind,'enquiry',p_enquiry,v_enquiry.version,
      jsonb_build_object('operationId',p_operation,'kind',p_kind,'status',v_enquiry.status,'assignedAgentId',v_enquiry.assigned_agent_id));
  END IF;
  v_now:=date_trunc('milliseconds',clock_timestamp());
  v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'kind',p_kind,'expectedVersion',p_expected::text,
    'request',v_request,'outcome',v_outcome,'reason',v_reason,'result',jsonb_build_object('version',v_enquiry.version::text,
      'status',v_enquiry.status,'assignedAgentId',v_enquiry.assigned_agent_id,'nextActionAt',app_private.enquiry_utc(v_enquiry.next_action_at),
      'closureReason',v_enquiry.closure_reason),'completedAt',app_private.enquiry_utc(v_now));
  INSERT INTO app_private.enquiry_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,expected_version,request_payload,request_sha256,receipt,created_at)
    VALUES(v_tenant,p_operation,p_enquiry,v_actor,p_kind,p_expected,v_payload,v_digest,v_receipt,v_now);
  RETURN v_receipt;
END $$;

CREATE FUNCTION app_api.read_enquiry_operation(p_enquiry uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
  v_enquiry app_private.enquiries;v_operation app_private.enquiry_operations;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
  IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/enquiry/' || p_operation::text,0));
  SELECT * INTO v_operation FROM app_private.enquiry_operations WHERE tenant_id=v_tenant AND operation_id=p_operation
    AND enquiry_id=p_enquiry AND requester_id=v_actor;
  IF NOT FOUND OR (v_operation.kind='assign' AND app_private.staff_role()<>'admin') THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
  RETURN v_operation.receipt;
END $$;

CREATE FUNCTION app_api.list_enquiry_assignees(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_items jsonb;v_count integer;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='23514';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role) ORDER BY user_id) FILTER (WHERE position<=p_limit),'[]'::jsonb),count(*)
    INTO v_items,v_count FROM (SELECT user_id,role,row_number() OVER(ORDER BY user_id) AS position FROM
      (SELECT user_id,role FROM app_private.memberships WHERE tenant_id=app_private.context_tenant()
        AND active AND role IN ('agent','admin') ORDER BY user_id LIMIT p_limit+1) bounded) numbered;
  RETURN jsonb_build_object('items',v_items,'limit',p_limit,'truncated',v_count>p_limit);
END $$;
REVOKE ALL ON FUNCTION app_private.enquiry_utc(timestamptz),app_private.enquiry_time_valid(timestamptz),
  app_private.enquiry_reason_valid(text),app_private.enquiry_request_valid(text,uuid,text,timestamptz,text),
  app_private.validate_enquiry_operation(),app_private.immutable_enquiry_operation() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_api.execute_enquiry_operation(uuid,uuid,bigint,text,uuid,text,timestamptz,text),
  app_api.read_enquiry_operation(uuid,uuid),app_api.list_enquiry_assignees(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.execute_enquiry_operation(uuid,uuid,bigint,text,uuid,text,timestamptz,text),
  app_api.read_enquiry_operation(uuid,uuid),app_api.list_enquiry_assignees(integer) TO api_runtime;
COMMIT;

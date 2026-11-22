BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.staff_capture_originals (
 tenant_id uuid NOT NULL, operation_id uuid NOT NULL, requester_id uuid NOT NULL, enquiry_id uuid NOT NULL,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=8192),
 recorded_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(recorded_at)),
 PRIMARY KEY(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,enquiry_id) REFERENCES app_private.enquiries(tenant_id,id),
 CHECK(request->>'policy'='staff-capture-command-v1' AND request->>'operationId'=operation_id::text)
);
ALTER TABLE app_private.staff_capture_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_capture_originals FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_command ON app_private.staff_capture_originals TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_staff_capture_originals BEFORE UPDATE OR DELETE ON app_private.staff_capture_originals FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.staff_capture_originals FROM PUBLIC,api_runtime,media_coordinator,media_maintenance;
CREATE FUNCTION app_private.staff_capture_receipt(r app_private.staff_capture_originals) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','staff-capture-receipt-v1','tenantId',r.tenant_id,'actorId',r.requester_id,'operationId',r.operation_id,'request',r.request,'enquiryId',r.enquiry_id,'recordedAt',app_private.enquiry_utc(r.recorded_at))
$$;
CREATE FUNCTION app_private.lock_staff_capture() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled FOR SHARE;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() FOR SHARE;
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
END $$;
CREATE FUNCTION app_api.record_staff_capture_original(p_id uuid,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op uuid;body jsonb;e app_private.enquiries;r app_private.staff_capture_originals;eid uuid;
BEGIN
 PERFORM app_private.lock_staff_capture();
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_request) key) IS DISTINCT FROM ARRAY['input','operationId','policy','role']::text[] OR p_request->>'policy' IS DISTINCT FROM 'staff-capture-command-v1' OR jsonb_typeof(p_request->'operationId') IS DISTINCT FROM 'string' OR (p_request->>'operationId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_request->>'role' IS DISTINCT FROM app_private.staff_role() THEN RAISE EXCEPTION 'Invalid capture original' USING ERRCODE='22023';END IF;
 body:=p_request->'input';
 IF body IS NULL OR jsonb_typeof(body)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(body) key) IS DISTINCT FROM ARRAY['email','listingId','message','name','noticeAcknowledged','noticeVersion','phone']::text[] OR body->'noticeAcknowledged' IS DISTINCT FROM 'true'::jsonb OR body->>'noticeVersion' IS DISTINCT FROM 'synthetic-staff-notice-v1' OR jsonb_typeof(body->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'message') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid capture input' USING ERRCODE='22023';END IF;
 op:=(p_request->>'operationId')::uuid;
 -- Use the existing tenant/idempotency lock order and exact creator/body checks.
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||op::text,0));
 SELECT * INTO r FROM app_private.staff_capture_originals WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 IF FOUND THEN
  IF r.requester_id IS DISTINCT FROM app_private.context_actor() OR r.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Capture original conflict' USING ERRCODE='23505';END IF;
  RETURN app_private.staff_capture_receipt(r);
 END IF;
 eid:=app_api.record_enquiry(p_id,op,(body->>'listingId')::uuid,body->>'name',body->>'phone',body->>'email',body->>'message','staff',body->>'noticeVersion');
 SELECT * INTO STRICT e FROM app_private.enquiries WHERE tenant_id=app_private.context_tenant() AND id=eid;
 IF e.requested_by_id IS DISTINCT FROM app_private.context_actor() OR e.origin<>'staff' OR body IS DISTINCT FROM jsonb_build_object('listingId',e.listing_id,'name',e.contact_name,'phone',e.phone_e164,'email',e.email,'message',e.message,'noticeVersion',e.notice_version,'noticeAcknowledged',true) THEN RAISE EXCEPTION 'Noncanonical capture original' USING ERRCODE='22023';END IF;
 INSERT INTO app_private.staff_capture_originals(tenant_id,operation_id,requester_id,enquiry_id,request,recorded_at) VALUES(app_private.context_tenant(),op,app_private.context_actor(),eid,p_request,date_trunc('milliseconds',clock_timestamp())) RETURNING * INTO r;
 RETURN app_private.staff_capture_receipt(r);
END $$;
CREATE FUNCTION app_api.read_staff_capture_original(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.staff_capture_originals;
BEGIN
 PERFORM app_private.lock_staff_capture();
 SELECT * INTO r FROM app_private.staff_capture_originals WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND requester_id=app_private.context_actor();
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN app_private.staff_capture_receipt(r);
END $$;
REVOKE ALL ON FUNCTION app_private.staff_capture_receipt(app_private.staff_capture_originals),app_private.lock_staff_capture(),app_api.record_staff_capture_original(uuid,jsonb),app_api.read_staff_capture_original(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.record_staff_capture_original(uuid,jsonb),app_api.read_staff_capture_original(uuid) TO api_runtime;
COMMIT;

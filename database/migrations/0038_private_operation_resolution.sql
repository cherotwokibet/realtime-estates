-- Rollout prerequisite: stop/drain replacement API writers and refresh connection pools.
-- Apply before enabling the synthetic resolution API. This is not a rolling-upgrade guarantee.
-- Explicit retirement of unapplied settings/report originals. No automatic cancellation or rollback.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.private_operation_cancellations (
 tenant_id uuid NOT NULL REFERENCES app_private.tenants(id), kind text NOT NULL CHECK(kind IN ('settings','report')),
 operation_id uuid NOT NULL, actor_id uuid NOT NULL, request jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,kind,operation_id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
ALTER TABLE app_private.private_operation_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.private_operation_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_command ON app_private.private_operation_cancellations TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_private_operation_cancellations BEFORE UPDATE OR DELETE ON app_private.private_operation_cancellations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.private_operation_cancellations FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.private_operation_original_valid(p_kind text,p_request jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE expected bigint;op uuid;
BEGIN
 IF p_kind='settings' THEN
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_request) key) IS DISTINCT FROM ARRAY['approval','content','expectedVersion','operationId','policy']::text[] OR p_request->>'policy' IS DISTINCT FROM 'company-settings-command-v1' OR p_request->>'approval' IS DISTINCT FROM 'approved-for-publication' OR jsonb_typeof(p_request->'expectedVersion') IS DISTINCT FROM 'string' OR (p_request->>'expectedVersion')!~'^(0|[1-9][0-9]{0,15})$' OR jsonb_typeof(p_request->'operationId') IS DISTINCT FROM 'string' OR (p_request->>'operationId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR NOT app_private.company_settings_content_valid(p_request->'content') THEN RETURN false;END IF;
 expected:=(p_request->>'expectedVersion')::bigint;op:=(p_request->>'operationId')::uuid;
 IF expected>=9007199254740991 THEN RETURN false;END IF;
 RETURN true;
 ELSIF p_kind='report' THEN
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR
 (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_request) key) IS DISTINCT FROM ARRAY['decision','expectedVersion','operationId','policy','reason','reportId']::text[]
 OR jsonb_typeof(p_request->'policy')<>'string' OR p_request->>'policy'<>'listing-report-decision-command-v1'
 OR jsonb_typeof(p_request->'operationId')<>'string' OR (p_request->>'operationId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_request->'reportId')<>'string' OR (p_request->>'reportId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_request->'expectedVersion')<>'string' OR (p_request->>'expectedVersion')!~'^[1-9][0-9]{0,15}$'
 OR (p_request->>'expectedVersion')::numeric>=9007199254740991
 OR jsonb_typeof(p_request->'decision')<>'string' OR p_request->>'decision' NOT IN ('reviewed','dismissed')
 OR jsonb_typeof(p_request->'reason')<>'string' OR NOT app_private.listing_report_text_valid(p_request->>'reason',500) THEN
  RETURN false;END IF;
 RETURN true;
 END IF;
 RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
ALTER TABLE app_private.private_operation_cancellations ADD CONSTRAINT exact_retired_original CHECK(app_private.private_operation_original_valid(kind,request) AND operation_id=(request->>'operationId')::uuid);
CREATE FUNCTION app_private.lock_private_operation() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 -- Every current settings/report writer takes this same lock before any operation/report lock.
 -- It deliberately serialises these low-volume admin commands per company.
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() FOR UPDATE;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() FOR SHARE;
 PERFORM app_private.assert_staff(ARRAY['admin']);
END $$;
ALTER FUNCTION app_api.approve_company_settings(jsonb) RENAME TO approve_company_settings_before_resolution;
ALTER FUNCTION app_api.decide_listing_report(jsonb) RENAME TO decide_listing_report_before_resolution;
REVOKE ALL ON FUNCTION app_api.approve_company_settings_before_resolution(jsonb),app_api.decide_listing_report_before_resolution(jsonb) FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_api.approve_company_settings(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF NOT app_private.private_operation_original_valid('settings',p_request) THEN RAISE EXCEPTION 'Invalid original' USING ERRCODE='23514';END IF;
 PERFORM app_private.lock_private_operation();
 IF EXISTS(SELECT 1 FROM app_private.private_operation_cancellations WHERE tenant_id=app_private.context_tenant() AND kind='settings' AND operation_id=(p_request->>'operationId')::uuid) THEN
  RAISE EXCEPTION 'Original permanently retired' USING ERRCODE='40001';
 END IF;
 RETURN app_api.approve_company_settings_before_resolution(p_request);
END $$;
CREATE FUNCTION app_api.decide_listing_report(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF NOT app_private.private_operation_original_valid('report',p_request) THEN RAISE EXCEPTION 'Invalid original' USING ERRCODE='23514';END IF;
 PERFORM app_private.lock_private_operation();
 IF EXISTS(SELECT 1 FROM app_private.private_operation_cancellations WHERE tenant_id=app_private.context_tenant() AND kind='report' AND operation_id=(p_request->>'operationId')::uuid) THEN
  RAISE EXCEPTION 'Original permanently retired' USING ERRCODE='40001';
 END IF;
 RETURN app_api.decide_listing_report_before_resolution(p_request);
END $$;
CREATE FUNCTION app_api.resolve_private_operation(p_kind text,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app_private.private_operation_cancellations; original jsonb; receipt jsonb; saved_actor uuid; recorded timestamptz; outcome text;op uuid;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF NOT app_private.private_operation_original_valid(p_kind,p_request) THEN RAISE EXCEPTION 'Invalid original' USING ERRCODE='23514';END IF;
 op:=(p_request->>'operationId')::uuid;
 PERFORM app_private.lock_private_operation();
 IF p_kind='report' THEN PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':report-decision:'||op::text,0));END IF;
 IF p_kind='settings' THEN
  SELECT request,actor_id,recorded_at,app_private.company_settings_record_json(r) INTO original,saved_actor,recorded,receipt
   FROM app_private.company_settings_records r WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 ELSE
  SELECT request,actor_id,recorded_at,app_private.listing_report_decision_receipt(r) INTO original,saved_actor,recorded,receipt
   FROM app_private.listing_report_decisions r WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 END IF;
 IF FOUND THEN
  IF saved_actor IS DISTINCT FROM app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
  IF original IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Original conflicts' USING ERRCODE='40001';END IF;
  outcome:='completed';
 ELSE
  SELECT * INTO c FROM app_private.private_operation_cancellations WHERE tenant_id=app_private.context_tenant() AND kind=p_kind AND operation_id=op;
  IF FOUND THEN
   IF c.actor_id IS DISTINCT FROM app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
   IF c.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Original conflicts' USING ERRCODE='40001';END IF;
  ELSE
   INSERT INTO app_private.private_operation_cancellations(tenant_id,kind,operation_id,actor_id,request)
    VALUES(app_private.context_tenant(),p_kind,op,app_private.context_actor(),p_request) RETURNING * INTO c;
  END IF;
  outcome:='cancelled';recorded:=c.recorded_at;receipt:=NULL;
 END IF;
 RETURN jsonb_build_object('policy','private-operation-resolution-v1','tenantId',app_private.context_tenant(),'actorId',app_private.context_actor(),
  'kind',p_kind,'operationId',op,'request',p_request,'outcome',outcome,'receipt',receipt,'recordedAt',recorded);
END $$;
REVOKE ALL ON FUNCTION app_private.private_operation_original_valid(text,jsonb),app_private.lock_private_operation(),app_api.approve_company_settings(jsonb),app_api.decide_listing_report(jsonb),app_api.resolve_private_operation(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.approve_company_settings(jsonb),app_api.decide_listing_report(jsonb),app_api.resolve_private_operation(text,jsonb) TO api_runtime;
COMMIT;

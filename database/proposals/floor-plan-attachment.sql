-- Isolated current-authority floor-plan attachment and private gallery metadata.
-- Explicitly install after floor-plan registration, processing and output proposals.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.synthetic_floor_plan_attachment_command_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& ARRAY['policy','operationId','listingId','revision','expectedVersion','requestId'])
  OR v-ARRAY['policy','operationId','listingId','revision','expectedVersion','requestId']<>'{}'::jsonb THEN RETURN false; END IF;
 RETURN coalesce(v->'policy'='"synthetic-floor-plan-attachment-command-v1"'::jsonb
  AND jsonb_typeof(v->'operationId')='string' AND v->>'operationId'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(v->'listingId')='string' AND v->>'listingId'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(v->'revision')='number' AND v->>'revision'~'^[1-9][0-9]{0,9}$' AND (v->>'revision')::numeric<=2147483647
  AND jsonb_typeof(v->'expectedVersion')='string' AND v->>'expectedVersion'~'^[1-9][0-9]{0,15}$' AND (v->>'expectedVersion')::numeric<9007199254740991
  AND (v->'requestId'='null'::jsonb OR (jsonb_typeof(v->'requestId')='string' AND v->>'requestId'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
CREATE TABLE app_private.synthetic_floor_plan_attachments (
 tenant_id uuid NOT NULL, operation_id uuid NOT NULL, listing_id uuid NOT NULL, revision_no integer NOT NULL,
 actor_id uuid NOT NULL, request_id uuid,
 command jsonb NOT NULL CHECK(app_private.synthetic_floor_plan_attachment_command_valid(command)),
 result_version bigint NOT NULL CHECK(result_version BETWEEN 2 AND 9007199254740991),
 output_receipt jsonb NOT NULL,
 PRIMARY KEY(tenant_id,operation_id), UNIQUE(tenant_id,listing_id,revision_no,result_version),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,request_id) REFERENCES app_private.synthetic_floor_plan_outputs(tenant_id,request_id),
 CHECK(operation_id=(command->>'operationId')::uuid AND listing_id=(command->>'listingId')::uuid
  AND revision_no=(command->>'revision')::integer AND result_version=(command->>'expectedVersion')::bigint+1
  AND request_id IS NOT DISTINCT FROM (command->>'requestId')::uuid),
 CHECK(coalesce((request_id IS NULL AND output_receipt='null'::jsonb) OR (request_id IS NOT NULL
  AND output_receipt->'policy'='"synthetic-floor-plan-output-v1"'::jsonb
  AND (output_receipt#>>'{lease,registration,binding,requestId}')::uuid=request_id
  AND (output_receipt#>>'{lease,registration,binding,companyId}')::uuid=tenant_id
  AND (output_receipt#>>'{lease,registration,binding,listingId}')::uuid=listing_id
  AND (output_receipt#>>'{lease,registration,binding,revision}')::integer=revision_no),false))
);
ALTER TABLE app_private.synthetic_floor_plan_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_floor_plan_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_floor_plan_attachments TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_floor_plan_attachment BEFORE UPDATE OR DELETE ON app_private.synthetic_floor_plan_attachments
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_floor_plan_attachments FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.synthetic_floor_plan_attachment_record(r app_private.synthetic_floor_plan_attachments)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','synthetic-floor-plan-attachment-record-v1','command',r.command,
  'actorId',r.actor_id,'resultVersion',r.result_version::text,'output',r.output_receipt)
$$;
CREATE FUNCTION app_api.save_synthetic_floor_plan_attachment(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; r app_private.listing_revisions;
 prior app_private.synthetic_floor_plan_attachments; registration app_private.synthetic_floor_plan_registrations;
 lease app_private.synthetic_floor_plan_leases; sealed app_private.synthetic_floor_plan_outputs;
 op uuid; listing uuid; revision integer; expected bigint; request uuid; version bigint; receipt jsonb:='null'::jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF NOT app_private.synthetic_floor_plan_attachment_command_valid(p_command)
 THEN RAISE EXCEPTION 'Invalid floor plan command' USING ERRCODE='23514'; END IF;
 op:=(p_command->>'operationId')::uuid; listing:=(p_command->>'listingId')::uuid;
 revision:=(p_command->>'revision')::integer; expected:=(p_command->>'expectedVersion')::bigint; request:=(p_command->>'requestId')::uuid;
 l:=app_private.lock_listing(listing);
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':floor-plan-attachment:'||op::text,0));
 -- Lock current membership/company through the commit; a historical original is not new write authority.
 PERFORM 1 FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=l.tenant_id AND m.user_id=app_private.context_actor() AND m.active AND t.enabled
   AND (m.role='admin' OR (m.role='agent' AND l.assigned_agent_id=m.user_id)) FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM app_private.synthetic_floor_plan_attachments WHERE tenant_id=l.tenant_id AND operation_id=op;
 IF FOUND THEN
  IF prior.actor_id<>app_private.context_actor() OR prior.command IS DISTINCT FROM p_command
  THEN RAISE EXCEPTION 'Original differs' USING ERRCODE='40001'; END IF;
  RETURN app_private.synthetic_floor_plan_attachment_record(prior);
 END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=listing AND revision_no=revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 IF l.publication_status='archived' OR r.state<>'draft' OR EXISTS(SELECT 1 FROM app_private.listing_revisions
  WHERE tenant_id=l.tenant_id AND listing_id=listing AND revision_no>revision)
 THEN RAISE EXCEPTION 'Current draft required' USING ERRCODE='23514'; END IF;
 IF r.version<>expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
 IF request IS NOT NULL THEN
  SELECT * INTO registration FROM app_private.synthetic_floor_plan_registrations
   WHERE tenant_id=l.tenant_id AND operation_id=request AND listing_id=listing AND revision_no=revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Floor plan unavailable' USING ERRCODE='P0002'; END IF;
  IF registration.assigned_agent_id IS DISTINCT FROM l.assigned_agent_id
  THEN RAISE EXCEPTION 'Assignment conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO lease FROM app_private.synthetic_floor_plan_leases WHERE tenant_id=l.tenant_id AND request_id=request FOR UPDATE;
  SELECT * INTO sealed FROM app_private.synthetic_floor_plan_outputs WHERE tenant_id=l.tenant_id AND request_id=request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sealed floor plan required' USING ERRCODE='23514'; END IF;
  receipt:=app_private.synthetic_floor_plan_output_record(sealed,lease,registration);
 END IF;
 UPDATE app_private.listing_revisions SET description=description WHERE tenant_id=l.tenant_id AND listing_id=listing AND revision_no=revision RETURNING listing_revisions.version INTO version;
 INSERT INTO app_private.synthetic_floor_plan_attachments(tenant_id,operation_id,listing_id,revision_no,actor_id,request_id,command,result_version,output_receipt)
 VALUES(l.tenant_id,op,listing,revision,app_private.context_actor(),request,p_command,version,receipt) RETURNING * INTO prior;
 PERFORM app_private.audit(CASE WHEN request IS NULL THEN 'listing.floor_plan_removed' ELSE 'listing.floor_plan_attached' END,
  'listing',listing,version,jsonb_build_object('revision',revision,'operationId',op,'requestId',request));
 RETURN app_private.synthetic_floor_plan_attachment_record(prior);
END $$;
CREATE FUNCTION app_api.read_synthetic_floor_plan_attachment_original(p_listing uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; original app_private.synthetic_floor_plan_attachments;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO original FROM app_private.synthetic_floor_plan_attachments
  WHERE tenant_id=l.tenant_id AND operation_id=p_operation AND listing_id=p_listing AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.synthetic_floor_plan_attachment_record(original);
END $$;
CREATE FUNCTION app_api.read_synthetic_floor_plan_gallery(p_listing uuid,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; r app_private.listing_revisions; current_plan app_private.synthetic_floor_plan_attachments;
 plan jsonb:='null'::jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=p_listing AND revision_no=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO current_plan FROM app_private.synthetic_floor_plan_attachments
  WHERE tenant_id=l.tenant_id AND listing_id=p_listing AND revision_no=p_revision ORDER BY result_version DESC LIMIT 1;
 IF FOUND AND current_plan.request_id IS NOT NULL THEN plan:=app_private.synthetic_floor_plan_attachment_record(current_plan); END IF;
 RETURN jsonb_build_object('policy','synthetic-floor-plan-gallery-v1','companyId',l.tenant_id,'actorId',app_private.context_actor(),
  'listingId',p_listing,'revision',p_revision,'version',r.version::text,'state',r.state,'floorPlan',plan);
END $$;
REVOKE ALL ON FUNCTION app_private.synthetic_floor_plan_attachment_command_valid(jsonb),
 app_private.synthetic_floor_plan_attachment_record(app_private.synthetic_floor_plan_attachments) FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_api.save_synthetic_floor_plan_attachment(jsonb),
 app_api.read_synthetic_floor_plan_attachment_original(uuid,uuid),app_api.read_synthetic_floor_plan_gallery(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.save_synthetic_floor_plan_attachment(jsonb),
 app_api.read_synthetic_floor_plan_attachment_original(uuid,uuid),app_api.read_synthetic_floor_plan_gallery(uuid,integer) TO api_runtime;
COMMIT;

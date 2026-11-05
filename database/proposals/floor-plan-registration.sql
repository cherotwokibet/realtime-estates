-- Isolated synthetic candidate, installed explicitly by tests and future opt-in composition.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.synthetic_floor_plan_registrations (
 tenant_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 listing_id uuid NOT NULL,
 revision_no integer NOT NULL CHECK(revision_no>0),
 actor_id uuid NOT NULL,
 assigned_agent_id uuid,
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),
 job_id uuid NOT NULL DEFAULT gen_random_uuid(),
 generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 input_object_id uuid NOT NULL DEFAULT gen_random_uuid(),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_bytes integer NOT NULL CHECK(source_bytes BETWEEN 1 AND 10485760),
 source_format text NOT NULL CHECK(source_format IN ('jpeg','png','webp')),
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,operation_id),
 UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,assigned_agent_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
ALTER TABLE app_private.synthetic_floor_plan_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_floor_plan_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_floor_plan_registrations TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_floor_plan_registration BEFORE UPDATE OR DELETE ON app_private.synthetic_floor_plan_registrations
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_floor_plan_registrations FROM PUBLIC,api_runtime,media_coordinator;

CREATE FUNCTION app_private.synthetic_floor_plan_registration_record(r app_private.synthetic_floor_plan_registrations)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'policy','synthetic-floor-plan-registration-v1','role','floor_plan',
  'pipeline','synthetic-floor-plan-codec-v1','countsAsPhoto',false,
  'binding',jsonb_build_object(
   'companyId',r.tenant_id,'actorId',r.actor_id,'listingId',r.listing_id,
   'revision',r.revision_no,'expectedVersion',r.expected_version,
   'requestId',r.operation_id,'jobId',r.job_id,'generationId',r.generation_id,'inputObjectId',r.input_object_id),
  'source',jsonb_build_object('sha256',r.source_sha256,'bytes',r.source_bytes,'format',r.source_format),
  'registeredAt',to_char(r.registered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expiresAt',to_char((r.registered_at+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

CREATE FUNCTION app_api.register_synthetic_floor_plan(
 p_listing uuid,p_revision integer,p_expected bigint,p_operation uuid,
 p_sha256 text,p_bytes integer,p_format text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; r app_private.listing_revisions;
 original app_private.synthetic_floor_plan_registrations;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1 OR p_expected IS NULL
  OR p_expected NOT BETWEEN 1 AND 9007199254740991 OR p_operation IS NULL
  OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_bytes IS NULL
  OR p_bytes NOT BETWEEN 1 AND 10485760 OR p_format IS NULL OR p_format NOT IN ('jpeg','png','webp')
 THEN RAISE EXCEPTION 'Invalid floor plan registration' USING ERRCODE='23514'; END IF;
 l:=app_private.lock_listing(p_listing);
 SELECT * INTO r FROM app_private.listing_revisions
  WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(l.tenant_id::text||':floor-plan:'||p_operation::text,0));
 -- Recheck after serialization and hold the current authority through commit.
 PERFORM 1 FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=l.tenant_id AND m.user_id=app_private.context_actor() AND m.active AND t.enabled
   AND (m.role='admin' OR (m.role='agent' AND l.assigned_agent_id=m.user_id))
  FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO original FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=l.tenant_id AND operation_id=p_operation;
 IF FOUND THEN
  IF original.actor_id<>app_private.context_actor() OR original.listing_id<>p_listing
   OR original.revision_no<>p_revision OR original.expected_version<>p_expected
   OR original.source_sha256<>p_sha256 OR original.source_bytes<>p_bytes OR original.source_format<>p_format
  THEN RAISE EXCEPTION 'Original differs' USING ERRCODE='40001'; END IF;
  RETURN app_private.synthetic_floor_plan_registration_record(original);
 END IF;
 IF l.publication_status='archived' OR r.state<>'draft' OR EXISTS(
  SELECT 1 FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no>p_revision)
 THEN RAISE EXCEPTION 'Current draft required' USING ERRCODE='23514'; END IF;
 IF r.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
 INSERT INTO app_private.synthetic_floor_plan_registrations(
  tenant_id,operation_id,listing_id,revision_no,actor_id,assigned_agent_id,expected_version,source_sha256,source_bytes,source_format)
 VALUES(l.tenant_id,p_operation,l.id,p_revision,app_private.context_actor(),l.assigned_agent_id,p_expected,p_sha256,p_bytes,p_format)
 RETURNING * INTO original;
 PERFORM app_private.audit('floor_plan.registered','listing',l.id,p_expected,
  jsonb_build_object('revision',p_revision,'operationId',p_operation,'jobId',original.job_id));
 RETURN app_private.synthetic_floor_plan_registration_record(original);
END $$;

CREATE FUNCTION app_api.read_synthetic_floor_plan_registration(p_listing uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; original app_private.synthetic_floor_plan_registrations;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id)
 THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO original FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=l.tenant_id AND listing_id=l.id AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.synthetic_floor_plan_registration_record(original);
END $$;

CREATE FUNCTION app_api.preflight_synthetic_floor_plan(p_listing uuid,p_revision integer,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; r app_private.listing_revisions;
 original app_private.synthetic_floor_plan_registrations; decision_time timestamptz;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1 OR p_operation IS NULL
 THEN RAISE EXCEPTION 'Invalid floor plan target' USING ERRCODE='23514'; END IF;
 l:=app_private.lock_listing(p_listing);
 SELECT * INTO r FROM app_private.listing_revisions
  WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO original FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision
   AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=l.tenant_id AND m.user_id=app_private.context_actor() AND m.active AND t.enabled
   AND (m.role='admin' OR (m.role='agent' AND l.assigned_agent_id=m.user_id))
  FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF l.assigned_agent_id IS DISTINCT FROM original.assigned_agent_id
 THEN RAISE EXCEPTION 'Assignment conflict' USING ERRCODE='40001'; END IF;
 decision_time:=clock_timestamp();
 IF l.publication_status='archived' OR r.state<>'draft'
  OR original.registered_at>decision_time OR original.registered_at+interval '24 hours'<=decision_time
  OR EXISTS(SELECT 1 FROM app_private.listing_revisions
   WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no>p_revision)
 THEN RAISE EXCEPTION 'Floor plan unavailable' USING ERRCODE='23514'; END IF;
 IF r.version<>original.expected_version
 THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
 RETURN app_private.synthetic_floor_plan_registration_record(original);
END $$;

REVOKE ALL ON FUNCTION app_private.synthetic_floor_plan_registration_record(app_private.synthetic_floor_plan_registrations)
 FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_api.register_synthetic_floor_plan(uuid,integer,bigint,uuid,text,integer,text),
 app_api.read_synthetic_floor_plan_registration(uuid,uuid),
 app_api.preflight_synthetic_floor_plan(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.register_synthetic_floor_plan(uuid,integer,bigint,uuid,text,integer,text),
 app_api.read_synthetic_floor_plan_registration(uuid,uuid),
 app_api.preflight_synthetic_floor_plan(uuid,integer,uuid) TO api_runtime;
COMMIT;

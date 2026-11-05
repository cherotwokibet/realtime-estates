-- Isolated synthetic floor-plan processing authority. Install after floor-plan-registration.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.synthetic_floor_plan_leases (
 tenant_id uuid NOT NULL,
 request_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 lease_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
 output_object_id uuid NOT NULL DEFAULT gen_random_uuid(),
 claimed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>claimed_at AND expires_at<=claimed_at+interval '5 minutes'),
 PRIMARY KEY(tenant_id,request_id),
 UNIQUE(tenant_id,claim_id),
 UNIQUE(tenant_id,lease_nonce),
 FOREIGN KEY(tenant_id,request_id) REFERENCES app_private.synthetic_floor_plan_registrations(tenant_id,operation_id)
);
ALTER TABLE app_private.synthetic_floor_plan_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_floor_plan_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_floor_plan_leases TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_floor_plan_lease BEFORE UPDATE OR DELETE ON app_private.synthetic_floor_plan_leases
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_floor_plan_leases FROM PUBLIC,api_runtime,media_coordinator;

CREATE FUNCTION app_private.synthetic_floor_plan_lease_record(
 lease app_private.synthetic_floor_plan_leases, registration app_private.synthetic_floor_plan_registrations
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','synthetic-floor-plan-lease-v1',
  'registration',app_private.synthetic_floor_plan_registration_record(registration),
  'claimId',lease.claim_id,'leaseNonce',lease.lease_nonce,'outputObjectId',lease.output_object_id,
  'claimedAt',to_char(lease.claimed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expiresAt',to_char(lease.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

CREATE FUNCTION app_media.claim_synthetic_floor_plan(p_listing uuid,p_revision integer,p_request uuid,p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration app_private.synthetic_floor_plan_registrations;
 lease app_private.synthetic_floor_plan_leases; decision_time timestamptz;
BEGIN
 PERFORM app_api.read_synthetic_floor_plan_registration(p_listing,p_request);
 IF p_revision IS NULL OR p_revision<1 OR p_claim IS NULL
  OR p_claim::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Invalid floor plan claim' USING ERRCODE='23514'; END IF;
 -- Match listing -> revision -> registration order used by fresh-work admission.
 PERFORM app_private.lock_listing(p_listing);
 PERFORM 1 FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant()
  AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
 SELECT * INTO registration FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=app_private.context_tenant() AND operation_id=p_request
   AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 -- Authorization may have changed while this operation waited for serialization.
 PERFORM app_api.read_synthetic_floor_plan_registration(p_listing,p_request);
 SELECT * INTO lease FROM app_private.synthetic_floor_plan_leases
  WHERE tenant_id=registration.tenant_id AND request_id=p_request;
 IF FOUND THEN
  IF lease.claim_id<>p_claim THEN RAISE EXCEPTION 'Claim conflict' USING ERRCODE='40001'; END IF;
  RETURN app_private.synthetic_floor_plan_lease_record(lease,registration);
 END IF;
 PERFORM app_api.preflight_synthetic_floor_plan(p_listing,p_revision,p_request);
 decision_time:=clock_timestamp();
 IF decision_time>=registration.registered_at+interval '24 hours'
 THEN RAISE EXCEPTION 'Floor plan expired' USING ERRCODE='23514'; END IF;
 INSERT INTO app_private.synthetic_floor_plan_leases(tenant_id,request_id,claim_id,claimed_at,expires_at)
 VALUES(registration.tenant_id,p_request,p_claim,decision_time,
  least(decision_time+interval '5 minutes',registration.registered_at+interval '24 hours'))
 RETURNING * INTO lease;
 PERFORM app_private.audit('floor_plan.processing_claimed','listing',p_listing,registration.expected_version,
  jsonb_build_object('revision',p_revision,'requestId',p_request,'claimId',p_claim,'jobId',registration.job_id));
 RETURN app_private.synthetic_floor_plan_lease_record(lease,registration);
END $$;

CREATE FUNCTION app_media.read_synthetic_floor_plan_lease(p_listing uuid,p_revision integer,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration app_private.synthetic_floor_plan_registrations; lease app_private.synthetic_floor_plan_leases;
BEGIN
 PERFORM app_api.read_synthetic_floor_plan_registration(p_listing,p_request);
 SELECT * INTO registration FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=app_private.context_tenant() AND operation_id=p_request
   AND listing_id=p_listing AND revision_no=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO lease FROM app_private.synthetic_floor_plan_leases
  WHERE tenant_id=registration.tenant_id AND request_id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.synthetic_floor_plan_lease_record(lease,registration);
END $$;

CREATE FUNCTION app_media.preflight_synthetic_floor_plan_worker(
 p_listing uuid,p_revision integer,p_request uuid,p_claim uuid,p_nonce uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration app_private.synthetic_floor_plan_registrations; lease app_private.synthetic_floor_plan_leases;
BEGIN
 PERFORM app_api.preflight_synthetic_floor_plan(p_listing,p_revision,p_request);
 SELECT * INTO registration FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=app_private.context_tenant() AND operation_id=p_request;
 SELECT * INTO lease FROM app_private.synthetic_floor_plan_leases
  WHERE tenant_id=registration.tenant_id AND request_id=p_request
   AND claim_id=p_claim AND lease_nonce=p_nonce;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='P0002'; END IF;
 IF lease.claimed_at>clock_timestamp() OR lease.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='23514'; END IF;
 RETURN app_private.synthetic_floor_plan_lease_record(lease,registration);
END $$;

REVOKE ALL ON FUNCTION app_private.synthetic_floor_plan_lease_record(
 app_private.synthetic_floor_plan_leases,app_private.synthetic_floor_plan_registrations)
 FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_media.claim_synthetic_floor_plan(uuid,integer,uuid,uuid),
 app_media.read_synthetic_floor_plan_lease(uuid,integer,uuid),
 app_media.preflight_synthetic_floor_plan_worker(uuid,integer,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_media.claim_synthetic_floor_plan(uuid,integer,uuid,uuid),
 app_media.read_synthetic_floor_plan_lease(uuid,integer,uuid),
 app_media.preflight_synthetic_floor_plan_worker(uuid,integer,uuid,uuid,uuid) TO media_coordinator;
COMMIT;

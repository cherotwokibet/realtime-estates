-- Isolated floor-plan output ledger. Install explicitly after registration and processing proposals.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.synthetic_floor_plan_manifest_valid(p_manifest jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN coalesce(
  p_manifest->'role'='"floor_plan"'::jsonb AND p_manifest->'countsAsPhoto'='false'::jsonb
  AND p_manifest->'pipeline'='"synthetic-floor-plan-codec-v1"'::jsonb
  AND p_manifest->'operations'='["auto-orient","resize-inside-1920-without-enlargement","strip-metadata","webp-lossless-effort-4"]'::jsonb
  -- Delegate common image facts only after requiring the separate lossless role and exact operations.
  AND app_private.synthetic_media_manifest_valid(
   (p_manifest-ARRAY['role','countsAsPhoto']) || jsonb_build_object('pipeline','synthetic-codec-v1',
    'operations','["auto-orient","resize-inside-1920-without-enlargement","strip-metadata","webp-quality-82-effort-4"]'::jsonb)),false);
END $$;
CREATE TABLE app_private.synthetic_floor_plan_outputs (
 tenant_id uuid NOT NULL,
 request_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 lease_nonce uuid NOT NULL,
 output_object_id uuid NOT NULL,
 manifest jsonb NOT NULL CHECK(app_private.synthetic_floor_plan_manifest_valid(manifest)),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256=encode(sha256(convert_to(manifest::text,'UTF8')),'hex')),
 verified_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,request_id),
 UNIQUE(tenant_id,output_object_id),
 FOREIGN KEY(tenant_id,request_id) REFERENCES app_private.synthetic_floor_plan_leases(tenant_id,request_id)
);
ALTER TABLE app_private.synthetic_floor_plan_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_floor_plan_outputs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_floor_plan_outputs TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_floor_plan_output BEFORE UPDATE OR DELETE ON app_private.synthetic_floor_plan_outputs
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_floor_plan_outputs FROM PUBLIC,api_runtime,media_coordinator;
CREATE OR REPLACE FUNCTION app_media.preflight_synthetic_floor_plan_worker(
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
 IF EXISTS (SELECT 1 FROM app_private.synthetic_floor_plan_outputs WHERE tenant_id=registration.tenant_id AND request_id=p_request)
 THEN RAISE EXCEPTION 'Floor plan already sealed' USING ERRCODE='23514'; END IF;
 IF lease.claimed_at>clock_timestamp() OR lease.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='23514'; END IF;
 RETURN app_private.synthetic_floor_plan_lease_record(lease,registration);
END $$;

CREATE FUNCTION app_private.synthetic_floor_plan_output_record(
 result app_private.synthetic_floor_plan_outputs,
 lease app_private.synthetic_floor_plan_leases, registration app_private.synthetic_floor_plan_registrations
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','synthetic-floor-plan-output-v1',
 'lease',app_private.synthetic_floor_plan_lease_record(lease,registration),
 'manifest',result.manifest,'manifestSha256',result.manifest_sha256,
 'verifiedAt',to_char(result.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
CREATE FUNCTION app_media.read_synthetic_floor_plan_output(p_listing uuid,p_revision integer,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration app_private.synthetic_floor_plan_registrations;
 lease app_private.synthetic_floor_plan_leases; result app_private.synthetic_floor_plan_outputs;
BEGIN
 PERFORM app_media.read_synthetic_floor_plan_lease(p_listing,p_revision,p_request);
 SELECT * INTO registration FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=app_private.context_tenant() AND operation_id=p_request;
 SELECT * INTO lease FROM app_private.synthetic_floor_plan_leases
  WHERE tenant_id=registration.tenant_id AND request_id=p_request;
 SELECT * INTO result FROM app_private.synthetic_floor_plan_outputs
  WHERE tenant_id=registration.tenant_id AND request_id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Output unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.synthetic_floor_plan_output_record(result,lease,registration);
END $$;
CREATE FUNCTION app_media.seal_synthetic_floor_plan(
 p_listing uuid,p_revision integer,p_request uuid,p_claim uuid,p_nonce uuid,p_output uuid,p_manifest jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration app_private.synthetic_floor_plan_registrations;
 lease app_private.synthetic_floor_plan_leases; result app_private.synthetic_floor_plan_outputs;
 decision_time timestamptz;
BEGIN
 PERFORM app_media.read_synthetic_floor_plan_lease(p_listing,p_revision,p_request);
 IF NOT app_private.synthetic_floor_plan_manifest_valid(p_manifest)
 THEN RAISE EXCEPTION 'Invalid floor plan manifest' USING ERRCODE='23514'; END IF;
 -- Preserve the existing listing -> revision -> registration -> lease lock order.
 PERFORM app_private.lock_listing(p_listing);
 PERFORM 1 FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant()
  AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
 SELECT * INTO registration FROM app_private.synthetic_floor_plan_registrations
  WHERE tenant_id=app_private.context_tenant() AND operation_id=p_request
   AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
 SELECT * INTO lease FROM app_private.synthetic_floor_plan_leases
  WHERE tenant_id=registration.tenant_id AND request_id=p_request FOR UPDATE;
 PERFORM app_media.read_synthetic_floor_plan_lease(p_listing,p_revision,p_request);
 IF p_claim IS DISTINCT FROM lease.claim_id OR p_nonce IS DISTINCT FROM lease.lease_nonce
  OR p_output IS DISTINCT FROM lease.output_object_id
 THEN RAISE EXCEPTION 'Lease conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO result FROM app_private.synthetic_floor_plan_outputs
  WHERE tenant_id=registration.tenant_id AND request_id=p_request;
 IF FOUND THEN
  IF result.manifest IS DISTINCT FROM p_manifest
  THEN RAISE EXCEPTION 'Output conflict' USING ERRCODE='40001'; END IF;
  RETURN app_private.synthetic_floor_plan_output_record(result,lease,registration);
 END IF;
 PERFORM app_media.preflight_synthetic_floor_plan_worker(p_listing,p_revision,p_request,p_claim,p_nonce);
 IF p_manifest->>'inputSha256' IS DISTINCT FROM registration.source_sha256
  OR (p_manifest->>'inputBytes')::integer IS DISTINCT FROM registration.source_bytes
  OR p_manifest->>'sourceFormat' IS DISTINCT FROM registration.source_format
 THEN RAISE EXCEPTION 'Source conflict' USING ERRCODE='23514'; END IF;
 decision_time:=clock_timestamp();
 IF decision_time<lease.claimed_at OR decision_time>=lease.expires_at
 THEN RAISE EXCEPTION 'Lease expired' USING ERRCODE='23514'; END IF;
 INSERT INTO app_private.synthetic_floor_plan_outputs(
  tenant_id,request_id,claim_id,lease_nonce,output_object_id,manifest,manifest_sha256,verified_at)
 VALUES(registration.tenant_id,p_request,p_claim,p_nonce,p_output,p_manifest,
  encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex'),decision_time) RETURNING * INTO result;
 PERFORM app_private.audit('floor_plan.output_sealed','listing',p_listing,registration.expected_version,
  jsonb_build_object('revision',p_revision,'requestId',p_request,'claimId',p_claim,
   'jobId',registration.job_id,'outputObjectId',p_output));
 RETURN app_private.synthetic_floor_plan_output_record(result,lease,registration);
END $$;
REVOKE ALL ON FUNCTION app_private.synthetic_floor_plan_manifest_valid(jsonb),
 app_private.synthetic_floor_plan_output_record(app_private.synthetic_floor_plan_outputs,app_private.synthetic_floor_plan_leases,app_private.synthetic_floor_plan_registrations)
 FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_media.read_synthetic_floor_plan_output(uuid,integer,uuid),
 app_media.seal_synthetic_floor_plan(uuid,integer,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_media.read_synthetic_floor_plan_output(uuid,integer,uuid),
 app_media.seal_synthetic_floor_plan(uuid,integer,uuid,uuid,uuid,uuid,jsonb) TO media_coordinator;
COMMIT;

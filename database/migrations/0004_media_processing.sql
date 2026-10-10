-- Synthetic processing attestation foundation only. SQL cannot prove actual decoding,
-- process termination, object immutability, filesystem isolation or media acceptance.
BEGIN;
CREATE ROLE media_coordinator NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA app_media AUTHORIZATION realtor_owner;
REVOKE ALL ON SCHEMA app_media FROM PUBLIC;
GRANT USAGE ON SCHEMA app_media TO media_coordinator;
SET LOCAL ROLE realtor_owner;

-- Job-only coordinator commands must never choose between ambiguous companies.
-- Existing collisions fail the migration; no first-match or historical row rewrite.
ALTER TABLE app_private.media_jobs ADD CONSTRAINT media_job_global_identity UNIQUE (id);
ALTER TABLE app_private.media_jobs ADD CONSTRAINT media_job_processing_context
  UNIQUE (tenant_id,id,listing_id,revision_no,requester_id);
ALTER TABLE app_private.media_jobs ADD CONSTRAINT media_job_generated_output UNIQUE (tenant_id,id,output_id);
ALTER TABLE app_private.media_jobs ADD CONSTRAINT media_job_expiry_identity UNIQUE (tenant_id,id,expires_at);

CREATE TABLE app_private.media_input_captures (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, listing_id uuid NOT NULL, revision_no integer NOT NULL,
  requester_id uuid NOT NULL, generation_id uuid NOT NULL,
  input_bytes bigint NOT NULL CHECK (input_bytes BETWEEN 1 AND 10485760),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'), captured_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,job_id),
  FOREIGN KEY (tenant_id,job_id,listing_id,revision_no,requester_id)
    REFERENCES app_private.media_jobs(tenant_id,id,listing_id,revision_no,requester_id)
);
CREATE TABLE app_private.media_processing_leases (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  claim_id uuid NOT NULL UNIQUE, lease_nonce uuid NOT NULL UNIQUE,
  claimed_at timestamptz NOT NULL, lease_expires_at timestamptz NOT NULL, job_expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,job_id,attempt), UNIQUE (tenant_id,job_id,attempt,lease_nonce),
  FOREIGN KEY (tenant_id,job_id) REFERENCES app_private.media_input_captures(tenant_id,job_id),
  FOREIGN KEY (tenant_id,job_id,job_expires_at) REFERENCES app_private.media_jobs(tenant_id,id,expires_at),
  CHECK (lease_expires_at>claimed_at AND lease_expires_at=least(claimed_at+interval '180 seconds',job_expires_at))
);

CREATE FUNCTION app_private.synthetic_media_manifest_valid(p_manifest jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v_key text; v_number numeric;
BEGIN
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' OR NOT (p_manifest ?& ARRAY[
    'pipeline','sourceFormat','inputSha256','inputBytes','format','mimeType','sha256','width','height','bytes','encoder','operations'])
    OR p_manifest-ARRAY['pipeline','sourceFormat','inputSha256','inputBytes','format','mimeType','sha256','width','height','bytes','encoder','operations']<>'{}'::jsonb THEN RETURN false; END IF;
  IF p_manifest->>'pipeline' IS DISTINCT FROM 'synthetic-codec-v1'
    OR p_manifest->>'sourceFormat' NOT IN ('jpeg','png','webp')
    OR jsonb_typeof(p_manifest->'sourceFormat') IS DISTINCT FROM 'string'
    OR p_manifest->>'format' IS DISTINCT FROM 'webp' OR p_manifest->>'mimeType' IS DISTINCT FROM 'image/webp'
    OR jsonb_typeof(p_manifest->'inputSha256') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_manifest->'sha256') IS DISTINCT FROM 'string'
    OR (p_manifest->>'inputSha256') !~ '^[a-f0-9]{64}$' OR (p_manifest->>'sha256') !~ '^[a-f0-9]{64}$'
    OR p_manifest->'encoder' IS DISTINCT FROM '{"sharp":"0.35.5","vips":"8.18.7"}'::jsonb
    OR p_manifest->'operations' IS DISTINCT FROM '["auto-orient","resize-inside-1920-without-enlargement","strip-metadata","webp-quality-82-effort-4"]'::jsonb THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['inputBytes','bytes','width','height'] LOOP
    IF jsonb_typeof(p_manifest->v_key) IS DISTINCT FROM 'number' OR (p_manifest->>v_key) !~ '^[0-9]+$' THEN RETURN false; END IF;
    v_number := (p_manifest->>v_key)::numeric;
    IF v_number<1 OR v_number>(CASE WHEN v_key IN ('width','height') THEN 1920 ELSE 10485760 END) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE app_private.media_verified_outputs (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, attempt integer NOT NULL, lease_nonce uuid NOT NULL,
  output_id uuid NOT NULL, manifest jsonb NOT NULL CHECK (app_private.synthetic_media_manifest_valid(manifest)),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256=encode(sha256(convert_to(manifest::text,'UTF8')),'hex')),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,job_id),
  FOREIGN KEY (tenant_id,job_id,attempt,lease_nonce)
    REFERENCES app_private.media_processing_leases(tenant_id,job_id,attempt,lease_nonce),
  FOREIGN KEY (tenant_id,job_id,output_id) REFERENCES app_private.media_jobs(tenant_id,id,output_id)
);
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['media_input_captures','media_processing_leases','media_verified_outputs'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY',v_table);
    EXECUTE format('CREATE POLICY owner_access ON app_private.%I TO realtor_owner USING (true) WITH CHECK (true)',v_table);
    EXECUTE format('CREATE TRIGGER immutable_processing_record BEFORE UPDATE OR DELETE ON app_private.%I FOR EACH ROW EXECUTE FUNCTION app_private.immutable_registered_media()',v_table);
  END LOOP;
END $$;

CREATE FUNCTION app_private.media_utc(p_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION app_private.lock_processing_job(p_job uuid,p_new_work boolean) RETURNS app_private.media_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_listing app_private.listings; v_revision app_private.listing_revisions; v_role text;
BEGIN
  SELECT * INTO v_job FROM app_private.media_jobs WHERE id=p_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_listing FROM app_private.listings WHERE tenant_id=v_job.tenant_id AND id=v_job.listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT m.role INTO v_role FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=v_job.tenant_id AND m.user_id=v_job.requester_id AND m.active AND t.enabled;
  IF NOT FOUND OR v_role NOT IN ('agent','admin') OR (v_role='agent' AND v_listing.assigned_agent_id<>v_job.requester_id) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_job.tenant_id
    AND listing_id=v_job.listing_id AND revision_no=v_job.revision_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_job FROM app_private.media_jobs WHERE id=p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF p_new_work THEN
    IF v_listing.assigned_agent_id<>v_job.registered_assigned_agent_id THEN RAISE EXCEPTION 'Assignment conflict' USING ERRCODE='40001'; END IF;
    IF v_revision.state<>'draft' OR v_job.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Processing unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  -- No context_actor/context_tenant/staff_role or caller GUC is consulted. Processing
  -- never adopts/increments a revision token; an eventual attach intent must supply it.
  RETURN v_job;
END $$;
CREATE FUNCTION app_private.media_capture_receipt(p_capture app_private.media_input_captures) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('jobId',p_capture.job_id,'generationId',p_capture.generation_id,
    'inputBytes',p_capture.input_bytes,'inputSha256',p_capture.input_sha256,'capturedAt',app_private.media_utc(p_capture.captured_at))
$$;
CREATE FUNCTION app_private.media_lease_receipt(p_lease app_private.media_processing_leases,p_job app_private.media_jobs,p_capture app_private.media_input_captures)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('jobId',p_job.id,'claimId',p_lease.claim_id,'attempt',p_lease.attempt,
    'leaseNonce',p_lease.lease_nonce,'leaseExpiresAt',app_private.media_utc(p_lease.lease_expires_at),
    'quarantineId',p_job.quarantine_id,'outputId',p_job.output_id,'pipeline','synthetic-codec-v1',
    'input',jsonb_build_object('generationId',p_capture.generation_id,'bytes',p_capture.input_bytes,'sha256',p_capture.input_sha256))
$$;
CREATE FUNCTION app_private.media_verified_receipt(p_verified app_private.media_verified_outputs) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('jobId',p_verified.job_id,'attempt',p_verified.attempt,'leaseNonce',p_verified.lease_nonce,
    'outputId',p_verified.output_id,'manifestSha256',p_verified.manifest_sha256,'manifest',p_verified.manifest,
    'verifiedAt',app_private.media_utc(p_verified.verified_at),'outcome','verified')
$$;

CREATE FUNCTION app_media.capture_input(p_job uuid,p_generation uuid,p_bytes bigint,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_capture app_private.media_input_captures;
BEGIN
  v_job := app_private.lock_processing_job(p_job,false);
  IF p_generation IS NULL OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 10485760 OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid captured input' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_capture FROM app_private.media_input_captures WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
  IF FOUND THEN
    IF v_capture.generation_id<>p_generation OR v_capture.input_bytes<>p_bytes OR v_capture.input_sha256<>p_sha256 THEN
      RAISE EXCEPTION 'Captured input conflict' USING ERRCODE='40001'; END IF;
    RETURN app_private.media_capture_receipt(v_capture);
  END IF;
  v_job := app_private.lock_processing_job(p_job,true);
  INSERT INTO app_private.media_input_captures(tenant_id,job_id,listing_id,revision_no,requester_id,generation_id,input_bytes,input_sha256,captured_at)
    VALUES(v_job.tenant_id,v_job.id,v_job.listing_id,v_job.revision_no,v_job.requester_id,p_generation,p_bytes,p_sha256,clock_timestamp()) RETURNING * INTO v_capture;
  RETURN app_private.media_capture_receipt(v_capture);
END $$;

CREATE FUNCTION app_media.claim_processing(p_job uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_capture app_private.media_input_captures; v_lease app_private.media_processing_leases;
  v_latest app_private.media_processing_leases; v_now timestamptz;
BEGIN
  v_job := app_private.lock_processing_job(p_job,false);
  IF p_claim IS NULL THEN RAISE EXCEPTION 'Claim identity required' USING ERRCODE='23514'; END IF;
  -- A stable claim UUID is global and bound to one job; a lost response never
  -- silently becomes another attempt, even if the original lease is now expired.
  PERFORM pg_advisory_xact_lock(hashtextextended('media-claim/' || p_claim::text,0));
  SELECT * INTO v_lease FROM app_private.media_processing_leases WHERE claim_id=p_claim FOR UPDATE;
  IF FOUND THEN
    IF v_lease.tenant_id<>v_job.tenant_id OR v_lease.job_id<>v_job.id THEN RAISE EXCEPTION 'Claim conflict' USING ERRCODE='40001'; END IF;
    SELECT * INTO v_capture FROM app_private.media_input_captures WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
    RETURN app_private.media_lease_receipt(v_lease,v_job,v_capture);
  END IF;
  v_job := app_private.lock_processing_job(p_job,true);
  SELECT * INTO v_capture FROM app_private.media_input_captures WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Captured input required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM app_private.media_verified_outputs WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id) THEN
    RAISE EXCEPTION 'Output already verified' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_latest FROM app_private.media_processing_leases WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id ORDER BY attempt DESC LIMIT 1 FOR UPDATE;
  v_now := clock_timestamp();
  IF FOUND AND v_latest.lease_expires_at>v_now THEN RAISE EXCEPTION 'Lease already active' USING ERRCODE='40001'; END IF;
  IF coalesce(v_latest.attempt,0)>=3 THEN RAISE EXCEPTION 'Attempt limit reached' USING ERRCODE='23514'; END IF;
  INSERT INTO app_private.media_processing_leases(tenant_id,job_id,attempt,claim_id,lease_nonce,claimed_at,lease_expires_at,job_expires_at)
    VALUES(v_job.tenant_id,v_job.id,coalesce(v_latest.attempt,0)+1,p_claim,gen_random_uuid(),v_now,
      least(v_now+interval '180 seconds',v_job.expires_at),v_job.expires_at) RETURNING * INTO v_lease;
  RETURN app_private.media_lease_receipt(v_lease,v_job,v_capture);
END $$;

CREATE FUNCTION app_media.seal_output(p_job uuid,p_attempt integer,p_nonce uuid,p_manifest jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_capture app_private.media_input_captures;
  v_lease app_private.media_processing_leases; v_verified app_private.media_verified_outputs; v_digest text;
BEGIN
  v_job := app_private.lock_processing_job(p_job,false);
  IF p_attempt IS NULL OR p_attempt NOT BETWEEN 1 AND 3 OR p_nonce IS NULL OR NOT coalesce(app_private.synthetic_media_manifest_valid(p_manifest),false) THEN
    RAISE EXCEPTION 'Invalid verified output' USING ERRCODE='23514'; END IF;
  v_digest := encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex');
  SELECT * INTO v_verified FROM app_private.media_verified_outputs WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
  IF FOUND THEN
    IF v_verified.attempt<>p_attempt OR v_verified.lease_nonce<>p_nonce OR v_verified.manifest IS DISTINCT FROM p_manifest OR v_verified.manifest_sha256<>v_digest THEN
      RAISE EXCEPTION 'Verified output conflict' USING ERRCODE='40001'; END IF;
    -- Historical exact attestation replay skips old draft/token/lease/job expiry.
    -- This is not a renewable upload/attachment capability or SQL decoder proof.
    RETURN app_private.media_verified_receipt(v_verified);
  END IF;
  v_job := app_private.lock_processing_job(p_job,true);
  SELECT * INTO v_capture FROM app_private.media_input_captures WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Captured input required' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_lease FROM app_private.media_processing_leases WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id ORDER BY attempt DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_lease.attempt<>p_attempt OR v_lease.lease_nonce<>p_nonce OR v_lease.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Lease conflict' USING ERRCODE='40001'; END IF;
  IF (p_manifest->>'inputBytes')::bigint<>v_capture.input_bytes OR p_manifest->>'inputSha256'<>v_capture.input_sha256 THEN
    RAISE EXCEPTION 'Captured input conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO app_private.media_verified_outputs(tenant_id,job_id,attempt,lease_nonce,output_id,manifest,manifest_sha256,verified_at)
    VALUES(v_job.tenant_id,v_job.id,p_attempt,p_nonce,v_job.output_id,p_manifest,v_digest,clock_timestamp()) RETURNING * INTO v_verified;
  RETURN app_private.media_verified_receipt(v_verified);
END $$;

CREATE FUNCTION app_media.read_processing(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_capture app_private.media_input_captures; v_lease app_private.media_processing_leases;
  v_verified app_private.media_verified_outputs; v_state text; v_now timestamptz;
BEGIN
  v_job := app_private.lock_processing_job(p_job,false);
  SELECT * INTO v_capture FROM app_private.media_input_captures WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
  SELECT * INTO v_lease FROM app_private.media_processing_leases WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id ORDER BY attempt DESC LIMIT 1 FOR UPDATE;
  SELECT * INTO v_verified FROM app_private.media_verified_outputs WHERE tenant_id=v_job.tenant_id AND job_id=v_job.id FOR UPDATE;
  v_now := clock_timestamp();
  v_state := CASE WHEN v_verified.job_id IS NOT NULL THEN 'verified' WHEN v_job.expires_at<=v_now THEN 'expired'
    WHEN v_capture.job_id IS NULL THEN 'registered' WHEN v_lease.job_id IS NOT NULL AND v_lease.lease_expires_at>v_now THEN 'processing' ELSE 'captured' END;
  RETURN jsonb_build_object('jobId',v_job.id,'state',v_state,
    'capture',CASE WHEN v_capture.job_id IS NOT NULL THEN app_private.media_capture_receipt(v_capture) ELSE NULL END,
    'lease',CASE WHEN v_lease.job_id IS NOT NULL THEN app_private.media_lease_receipt(v_lease,v_job,v_capture) ELSE NULL END,
    'verified',CASE WHEN v_verified.job_id IS NOT NULL THEN app_private.media_verified_receipt(v_verified) ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION app_private.synthetic_media_manifest_valid(jsonb),app_private.media_utc(timestamptz),
  app_private.lock_processing_job(uuid,boolean),app_private.media_capture_receipt(app_private.media_input_captures),
  app_private.media_lease_receipt(app_private.media_processing_leases,app_private.media_jobs,app_private.media_input_captures),
  app_private.media_verified_receipt(app_private.media_verified_outputs),app_media.capture_input(uuid,uuid,bigint,text),
  app_media.claim_processing(uuid,uuid),app_media.seal_output(uuid,integer,uuid,jsonb),app_media.read_processing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_media.capture_input(uuid,uuid,bigint,text),app_media.claim_processing(uuid,uuid),
  app_media.seal_output(uuid,integer,uuid,jsonb),app_media.read_processing(uuid) TO media_coordinator;
-- No API schema usage, API role membership, direct table access or browser grant.
-- No GUC-based audit helper: immutable rows record the local transition evidence.
RESET ROLE;
COMMIT;

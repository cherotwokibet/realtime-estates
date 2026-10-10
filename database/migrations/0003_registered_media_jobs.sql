-- Authenticated registration and historical reconciliation only. No upload capability,
-- decoder attestation, media attachment, coordinator grant or legacy provenance backfill.
BEGIN;
SET LOCAL ROLE realtor_owner;

-- One tenant-scoped operation UUID namespace is shared by later media command kinds.
-- Only register_media_upload is executable in this migration. The generic record is
-- not permission to create another command: api_runtime has no table privileges.
CREATE TABLE app_private.media_operations (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{0,63}$'),
  listing_id uuid NOT NULL, revision_no integer NOT NULL CHECK (revision_no > 0),
  requester_id uuid NOT NULL, expected_version bigint NOT NULL CHECK (expected_version BETWEEN 1 AND 9007199254740991),
  resource_id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object' AND octet_length(request_payload::text)<=4096),
  request_sha256 text NOT NULL CHECK (request_sha256=encode(sha256(convert_to(request_payload::text,'UTF8')),'hex')),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=4096),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,operation_id),
  UNIQUE (tenant_id,operation_id,resource_id,listing_id,revision_no,requester_id,expected_version),
  FOREIGN KEY (tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
  FOREIGN KEY (tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id),
  CHECK (resource_id<>operation_id),
  CHECK (kind<>'register_media_upload' OR request_payload=jsonb_build_object(
    'kind',kind,'tenantId',tenant_id,'actorId',requester_id,'listingId',listing_id,
    'revision',revision_no,'expectedVersion',expected_version::text,'jobId',resource_id,'altText',request_payload->>'altText')),
  CHECK (kind<>'register_media_upload' OR app_private.disclosure_text_valid(request_payload->'altText',300)),
  CHECK (kind<>'register_media_upload' OR receipt=jsonb_build_object('kind',kind,'operationId',operation_id,
    'jobId',resource_id,'listingId',listing_id,'revision',revision_no,'expectedVersion',expected_version::text,
    'altText',request_payload->>'altText','outcome','registered',
    'registeredAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char((created_at+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
);

CREATE TABLE app_private.media_jobs (
  tenant_id uuid NOT NULL, id uuid NOT NULL, registration_id uuid NOT NULL,
  listing_id uuid NOT NULL, revision_no integer NOT NULL, requester_id uuid NOT NULL,
  registered_assigned_agent_id uuid NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version BETWEEN 1 AND 9007199254740991),
  alt_text text NOT NULL CHECK (app_private.disclosure_text_valid(to_jsonb(alt_text),300)),
  quarantine_id uuid NOT NULL, output_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'registered' CHECK (state='registered'),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,registration_id),
  UNIQUE (tenant_id,quarantine_id), UNIQUE (tenant_id,output_id),
  FOREIGN KEY (tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
  FOREIGN KEY (tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,registered_assigned_agent_id) REFERENCES app_private.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,registration_id,id,listing_id,revision_no,requester_id,expected_version)
    REFERENCES app_private.media_operations(tenant_id,operation_id,resource_id,listing_id,revision_no,requester_id,expected_version),
  CHECK (expires_at=created_at+interval '24 hours'),
  CHECK (id<>registration_id AND quarantine_id<>registration_id AND output_id<>registration_id
    AND id<>quarantine_id AND id<>output_id AND quarantine_id<>output_id)
);

-- No lifecycle mutation exists yet. A later reviewed processing migration must
-- explicitly replace this protection with fenced, bounded state transitions.
CREATE FUNCTION app_private.immutable_registered_media() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Registered media facts and receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_media_operation BEFORE UPDATE OR DELETE ON app_private.media_operations
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_registered_media();
CREATE TRIGGER immutable_media_job BEFORE UPDATE OR DELETE ON app_private.media_jobs
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_registered_media();

ALTER TABLE app_private.media_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.media_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.media_operations TO realtor_owner USING (true) WITH CHECK (true);
ALTER TABLE app_private.media_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.media_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.media_jobs TO realtor_owner USING (true) WITH CHECK (true);

CREATE FUNCTION app_api.register_media_upload(p_listing uuid,p_revision integer,p_expected bigint,p_registration uuid,p_alt_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_listing app_private.listings; v_revision app_private.listing_revisions;
  v_operation app_private.media_operations; v_job app_private.media_jobs;
  v_tenant uuid := app_private.context_tenant(); v_actor uuid := app_private.context_actor();
  v_job_id uuid; v_created timestamptz; v_payload jsonb; v_receipt jsonb; v_digest text;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  PERFORM app_private.require_version(p_expected);
  IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1 OR p_registration IS NULL
    OR p_expected>9007199254740991 OR NOT coalesce(app_private.disclosure_text_valid(to_jsonb(p_alt_text),300),false) THEN
    RAISE EXCEPTION 'Invalid registration fields' USING ERRCODE='23514'; END IF;
  v_listing := app_private.lock_listing(p_listing);
  SELECT * INTO v_revision FROM app_private.listing_revisions
    WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;

  -- The listing/revision locks precede operation serialization. The advisory key
  -- also serializes the same UUID aimed at two different permitted listings. It
  -- is private, transaction-scoped and has no externally callable grant.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/' || p_registration::text,0));
  SELECT * INTO v_operation FROM app_private.media_operations
    WHERE tenant_id=v_tenant AND operation_id=p_registration FOR UPDATE;
  IF FOUND THEN
    v_payload := jsonb_build_object('kind','register_media_upload','tenantId',v_tenant,'actorId',v_actor,
      'listingId',p_listing,'revision',p_revision,'expectedVersion',p_expected::text,
      'jobId',v_operation.resource_id,'altText',p_alt_text);
    v_digest := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
    IF v_operation.kind<>'register_media_upload' OR v_operation.requester_id<>v_actor
      OR v_operation.listing_id<>p_listing OR v_operation.revision_no<>p_revision
      OR v_operation.expected_version<>p_expected OR v_operation.request_payload IS DISTINCT FROM v_payload
      OR v_operation.request_sha256<>v_digest THEN
      RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
    SELECT * INTO v_job FROM app_private.media_jobs WHERE tenant_id=v_tenant AND id=v_operation.resource_id
      AND registration_id=p_registration FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
    -- Historical receipt recovery deliberately does not require the old token,
    -- draft state or unexpired job. Current read authorization was checked above.
    RETURN v_operation.receipt;
  END IF;

  IF v_revision.state<>'draft' THEN RAISE EXCEPTION 'Expected draft' USING ERRCODE='23514'; END IF;
  IF v_revision.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  v_job_id := gen_random_uuid(); v_created := clock_timestamp();
  v_payload := jsonb_build_object('kind','register_media_upload','tenantId',v_tenant,'actorId',v_actor,
    'listingId',p_listing,'revision',p_revision,'expectedVersion',p_expected::text,'jobId',v_job_id,'altText',p_alt_text);
  v_digest := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_receipt := jsonb_build_object('kind','register_media_upload','operationId',p_registration,
    'jobId',v_job_id,'listingId',p_listing,'revision',p_revision,'expectedVersion',p_expected::text,
    'altText',p_alt_text,'outcome','registered',
    'registeredAt',to_char(v_created AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char((v_created+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
    expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    VALUES(v_tenant,p_registration,'register_media_upload',p_listing,p_revision,v_actor,p_expected,v_job_id,
      v_payload,v_digest,v_receipt,v_created);
  INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,
    registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    VALUES(v_tenant,v_job_id,p_registration,p_listing,p_revision,v_actor,v_listing.assigned_agent_id,p_expected,
      p_alt_text,gen_random_uuid(),gen_random_uuid(),v_created,v_created+interval '24 hours');
  PERFORM app_private.audit('media.registered','listing',p_listing,p_expected,
    jsonb_build_object('revision',p_revision,'operationId',p_registration,'jobId',v_job_id));
  RETURN v_receipt;
END $$;

CREATE FUNCTION app_api.read_media_registration(p_registration uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_operation app_private.media_operations; v_revision app_private.listing_revisions;
  v_tenant uuid := app_private.context_tenant(); v_actor uuid := app_private.context_actor();
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  SELECT * INTO v_operation FROM app_private.media_operations
    WHERE tenant_id=v_tenant AND operation_id=p_registration AND requester_id=v_actor AND kind='register_media_upload';
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM app_private.lock_listing(v_operation.listing_id);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_tenant
    AND listing_id=v_operation.listing_id AND revision_no=v_operation.revision_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_operation FROM app_private.media_operations WHERE tenant_id=v_tenant
    AND operation_id=p_registration AND requester_id=v_actor AND kind='register_media_upload' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  RETURN v_operation.receipt;
END $$;

CREATE FUNCTION app_api.read_media_job(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_operation app_private.media_operations; v_revision app_private.listing_revisions;
  v_tenant uuid := app_private.context_tenant(); v_actor uuid := app_private.context_actor();
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  SELECT * INTO v_job FROM app_private.media_jobs WHERE tenant_id=v_tenant AND id=p_job AND requester_id=v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM app_private.lock_listing(v_job.listing_id);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_tenant
    AND listing_id=v_job.listing_id AND revision_no=v_job.revision_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_operation FROM app_private.media_operations WHERE tenant_id=v_tenant
    AND operation_id=v_job.registration_id AND requester_id=v_actor AND kind='register_media_upload' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_job FROM app_private.media_jobs WHERE tenant_id=v_tenant AND id=p_job AND requester_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  RETURN (v_operation.receipt-'outcome') || jsonb_build_object('state',
    CASE WHEN v_job.expires_at<=clock_timestamp() THEN 'expired' ELSE 'registered' END);
END $$;

REVOKE ALL ON FUNCTION app_private.immutable_registered_media(),
  app_api.register_media_upload(uuid,integer,bigint,uuid,text),app_api.read_media_registration(uuid),app_api.read_media_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.register_media_upload(uuid,integer,bigint,uuid,text),
  app_api.read_media_registration(uuid),app_api.read_media_job(uuid) TO api_runtime;
-- Deliberately no SELECT/DML table grants, new role or broad function grant.
RESET ROLE;
COMMIT;

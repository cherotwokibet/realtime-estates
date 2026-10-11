-- Synthetic one-photo association only. Sealed SQL facts are trusted coordinator
-- attestations, not decoder/storage/public-delivery proof. Legacy rows are retained
-- without verification backfill and cannot satisfy the new submission gate.
BEGIN;
SET LOCAL ROLE realtor_owner;

ALTER TABLE app_private.media_operations ADD CONSTRAINT media_operation_payload_identity
  UNIQUE (tenant_id,operation_id,request_payload,request_sha256);
ALTER TABLE app_private.media_operations ADD CONSTRAINT media_operation_kind_identity UNIQUE (tenant_id,operation_id,kind);
ALTER TABLE app_private.media_verified_outputs ADD CONSTRAINT media_verified_identity
  UNIQUE (tenant_id,job_id,output_id,manifest_sha256);
ALTER TABLE app_private.media_verified_outputs ADD CONSTRAINT media_verified_manifest_identity
  UNIQUE (tenant_id,job_id,output_id,manifest_sha256,manifest);

CREATE TABLE app_private.media_attach_intents (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL UNIQUE, job_id uuid NOT NULL,
  listing_id uuid NOT NULL, revision_no integer NOT NULL, requester_id uuid NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version BETWEEN 1 AND 9007199254740990),
  alt_text text NOT NULL CHECK (app_private.disclosure_text_valid(to_jsonb(alt_text),300)),
  output_id uuid NOT NULL, manifest_sha256 text NOT NULL, media_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'attach_media' CHECK (kind='attach_media'),
  created_at timestamptz NOT NULL, request_payload jsonb NOT NULL, request_sha256 text NOT NULL,
  PRIMARY KEY (tenant_id,operation_id), UNIQUE (tenant_id,operation_id,job_id),
  UNIQUE (tenant_id,operation_id,job_id,listing_id,revision_no,requester_id,expected_version,media_id,output_id,manifest_sha256,alt_text),
  CHECK (operation_id<>job_id AND operation_id<>media_id AND media_id<>job_id AND media_id<>output_id),
  CHECK (request_payload=jsonb_build_object('kind','attach_media','tenantId',tenant_id,'actorId',requester_id,
    'listingId',listing_id,'revision',revision_no,'expectedVersion',expected_version::text,'jobId',job_id,
    'altText',alt_text,'manifestSha256',manifest_sha256,'outputId',output_id,'mediaId',media_id)),
  CHECK (request_sha256=encode(sha256(convert_to(request_payload::text,'UTF8')),'hex')),
  FOREIGN KEY (tenant_id,operation_id,media_id,listing_id,revision_no,requester_id,expected_version)
    REFERENCES app_private.media_operations(tenant_id,operation_id,resource_id,listing_id,revision_no,requester_id,expected_version),
  FOREIGN KEY (tenant_id,operation_id,request_payload,request_sha256)
    REFERENCES app_private.media_operations(tenant_id,operation_id,request_payload,request_sha256),
  FOREIGN KEY (tenant_id,operation_id,kind) REFERENCES app_private.media_operations(tenant_id,operation_id,kind),
  FOREIGN KEY (tenant_id,job_id,listing_id,revision_no,requester_id)
    REFERENCES app_private.media_jobs(tenant_id,id,listing_id,revision_no,requester_id),
  FOREIGN KEY (tenant_id,job_id,output_id,manifest_sha256)
    REFERENCES app_private.media_verified_outputs(tenant_id,job_id,output_id,manifest_sha256)
);
CREATE TABLE app_private.media_attach_results (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL, job_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied','conflict','rejected','expired')),
  reason text, result_version bigint NOT NULL CHECK (result_version BETWEEN 1 AND 9007199254740991),
  media_id uuid, position integer CHECK (position BETWEEN 0 AND 11), completed_at timestamptz NOT NULL,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=4096),
  PRIMARY KEY (tenant_id,operation_id),
  FOREIGN KEY (tenant_id,operation_id,job_id) REFERENCES app_private.media_attach_intents(tenant_id,operation_id,job_id),
  CHECK ((outcome='applied' AND reason IS NULL AND media_id IS NOT NULL AND position IS NOT NULL)
    OR (outcome='conflict' AND reason IN ('VERSION_CONFLICT','ASSIGNMENT_CHANGED') AND media_id IS NULL AND position IS NULL)
    OR (outcome='expired' AND reason='JOB_EXPIRED' AND media_id IS NULL AND position IS NULL)
    OR (outcome='rejected' AND reason IN ('REVISION_NOT_DRAFT','DUPLICATE_OUTPUT','CAPACITY_REACHED','JOB_ALREADY_ATTACHED','PROVENANCE_CHANGED')
      AND media_id IS NULL AND position IS NULL)),
  CHECK (outcome='applied' OR reason IS NOT NULL)
);
CREATE TABLE app_private.media_attachments (
  tenant_id uuid NOT NULL, media_id uuid NOT NULL, operation_id uuid NOT NULL, job_id uuid NOT NULL,
  listing_id uuid NOT NULL, revision_no integer NOT NULL, requester_id uuid NOT NULL, expected_version bigint NOT NULL,
  output_id uuid NOT NULL, manifest_sha256 text NOT NULL, manifest jsonb NOT NULL,
  public_object_key text NOT NULL, sha256 text NOT NULL, content_type text NOT NULL,
  bytes bigint NOT NULL, width integer NOT NULL, height integer NOT NULL, alt_text text NOT NULL,
  accepted boolean NOT NULL CHECK (accepted),
  PRIMARY KEY (tenant_id,media_id), UNIQUE (tenant_id,job_id), UNIQUE (tenant_id,operation_id),
  UNIQUE (tenant_id,media_id,listing_id,revision_no,job_id,operation_id,manifest_sha256,
    public_object_key,sha256,content_type,bytes,width,height,alt_text,accepted),
  FOREIGN KEY (tenant_id,operation_id,job_id,listing_id,revision_no,requester_id,expected_version,media_id,output_id,manifest_sha256,alt_text)
    REFERENCES app_private.media_attach_intents(tenant_id,operation_id,job_id,listing_id,revision_no,requester_id,expected_version,media_id,output_id,manifest_sha256,alt_text),
  FOREIGN KEY (tenant_id,job_id,output_id,manifest_sha256,manifest)
    REFERENCES app_private.media_verified_outputs(tenant_id,job_id,output_id,manifest_sha256,manifest),
  CHECK (public_object_key='synthetic/' || tenant_id::text || '/' || job_id::text || '/' || output_id::text || '.webp'),
  CHECK (sha256=manifest->>'sha256' AND content_type=manifest->>'mimeType'
    AND bytes=(manifest->>'bytes')::bigint AND width=(manifest->>'width')::integer AND height=(manifest->>'height')::integer)
);
ALTER TABLE app_private.revision_media ADD COLUMN sealed_job_id uuid;
ALTER TABLE app_private.revision_media ADD COLUMN attach_operation_id uuid;
ALTER TABLE app_private.revision_media ADD COLUMN sealed_manifest_sha256 text;
ALTER TABLE app_private.revision_media ADD CONSTRAINT media_provenance_complete CHECK (
  (sealed_job_id IS NULL AND attach_operation_id IS NULL AND sealed_manifest_sha256 IS NULL)
  OR (sealed_job_id IS NOT NULL AND attach_operation_id IS NOT NULL AND sealed_manifest_sha256 IS NOT NULL AND accepted));
ALTER TABLE app_private.revision_media ADD CONSTRAINT media_sealed_provenance FOREIGN KEY
  (tenant_id,id,listing_id,revision_no,sealed_job_id,attach_operation_id,sealed_manifest_sha256,
    public_object_key,sha256,content_type,bytes,width,height,alt_text,accepted)
  REFERENCES app_private.media_attachments(tenant_id,media_id,listing_id,revision_no,job_id,operation_id,manifest_sha256,
    public_object_key,sha256,content_type,bytes,width,height,alt_text,accepted);
CREATE UNIQUE INDEX current_sealed_media_key ON app_private.revision_media(tenant_id,listing_id,revision_no,public_object_key)
  WHERE sealed_job_id IS NOT NULL;
CREATE UNIQUE INDEX current_sealed_media_checksum ON app_private.revision_media(tenant_id,listing_id,revision_no,sha256)
  WHERE sealed_job_id IS NOT NULL;

CREATE FUNCTION app_private.validate_media_attach_result() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_intent app_private.media_attach_intents;v_receipt jsonb;
BEGIN
  SELECT * INTO v_intent FROM app_private.media_attach_intents WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id;
  v_receipt:=jsonb_build_object('kind','attach_media','operationId',NEW.operation_id,'jobId',NEW.job_id,
    'listingId',v_intent.listing_id,'revision',v_intent.revision_no,'expectedVersion',v_intent.expected_version::text,
    'version',NEW.result_version::text,'outcome',NEW.outcome,'reason',NEW.reason,'mediaId',NEW.media_id,'position',NEW.position,
    'completedAt',app_private.media_utc(NEW.completed_at));
  IF NEW.receipt IS DISTINCT FROM v_receipt OR (NEW.outcome='applied' AND
    (NEW.media_id<>v_intent.media_id OR NEW.result_version<>v_intent.expected_version+1 OR NOT EXISTS(
      SELECT 1 FROM app_private.media_attachments a WHERE a.tenant_id=NEW.tenant_id AND a.operation_id=NEW.operation_id
        AND a.job_id=NEW.job_id AND a.media_id=NEW.media_id))) THEN
    RAISE EXCEPTION 'Invalid attachment result' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_attachment_result BEFORE INSERT ON app_private.media_attach_results
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_media_attach_result();

DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['media_attach_intents','media_attach_results','media_attachments'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY',v_table);
    EXECUTE format('CREATE POLICY owner_access ON app_private.%I TO realtor_owner USING (true) WITH CHECK (true)',v_table);
    EXECUTE format('CREATE TRIGGER immutable_attachment_record BEFORE UPDATE OR DELETE ON app_private.%I FOR EACH ROW EXECUTE FUNCTION app_private.immutable_registered_media()',v_table);
  END LOOP;
END $$;

CREATE FUNCTION app_private.media_attach_projection(p_intent app_private.media_attach_intents) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('kind','attach_media','operationId',p_intent.operation_id,'jobId',p_intent.job_id,
    'listingId',p_intent.listing_id,'revision',p_intent.revision_no,'expectedVersion',p_intent.expected_version::text,
    'altText',p_intent.alt_text,'status',coalesce(r.outcome,'ready'),'receipt',r.receipt)
  FROM (SELECT 1) singleton LEFT JOIN app_private.media_attach_results r
    ON r.tenant_id=p_intent.tenant_id AND r.operation_id=p_intent.operation_id
$$;
CREATE FUNCTION app_private.lock_media_attach_intent(p_operation uuid) RETURNS app_private.media_attach_intents
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_intent app_private.media_attach_intents; v_listing app_private.listings; v_role text;
BEGIN
  SELECT * INTO v_intent FROM app_private.media_attach_intents WHERE operation_id=p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_listing FROM app_private.listings WHERE tenant_id=v_intent.tenant_id AND id=v_intent.listing_id FOR UPDATE;
  SELECT m.role INTO v_role FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=v_intent.tenant_id AND m.user_id=v_intent.requester_id AND m.active AND t.enabled;
  IF NOT FOUND OR v_role NOT IN ('agent','admin') OR (v_role='agent' AND v_listing.assigned_agent_id<>v_intent.requester_id) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM app_private.listing_revisions WHERE tenant_id=v_intent.tenant_id
    AND listing_id=v_intent.listing_id AND revision_no=v_intent.revision_no FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_intent.tenant_id::text || '/' || p_operation::text,0));
  SELECT * INTO v_intent FROM app_private.media_attach_intents WHERE operation_id=p_operation FOR UPDATE;
  PERFORM 1 FROM app_private.media_jobs WHERE tenant_id=v_intent.tenant_id AND id=v_intent.job_id FOR UPDATE;
  RETURN v_intent;
END $$;

CREATE FUNCTION app_api.create_media_attach_intent(p_listing uuid,p_revision integer,p_expected bigint,p_operation uuid,p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs; v_listing app_private.listings; v_revision app_private.listing_revisions;
  v_intent app_private.media_attach_intents; v_operation app_private.media_operations; v_verified app_private.media_verified_outputs;
  v_tenant uuid:=app_private.context_tenant(); v_actor uuid:=app_private.context_actor();
  v_media uuid; v_payload jsonb; v_digest text; v_ack jsonb; v_now timestamptz;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  IF p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990 OR p_operation IS NULL THEN
    RAISE EXCEPTION 'Invalid attachment request' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_job FROM app_private.media_jobs WHERE tenant_id=v_tenant AND id=p_job;
  IF NOT FOUND OR v_job.listing_id IS DISTINCT FROM p_listing OR v_job.revision_no IS DISTINCT FROM p_revision
    OR v_job.requester_id<>v_actor THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  v_listing:=app_private.lock_listing(p_listing);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_tenant
    AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/' || p_operation::text,0));
  SELECT * INTO v_operation FROM app_private.media_operations WHERE tenant_id=v_tenant AND operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
    IF v_operation.kind<>'attach_media' OR v_operation.requester_id<>v_actor OR v_operation.listing_id<>p_listing
      OR v_operation.revision_no<>p_revision OR v_operation.expected_version<>p_expected THEN
      RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
    SELECT * INTO v_intent FROM app_private.media_attach_intents WHERE tenant_id=v_tenant AND operation_id=p_operation FOR UPDATE;
    IF NOT FOUND OR v_intent.job_id<>p_job THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
    v_payload:=jsonb_build_object('kind','attach_media','tenantId',v_tenant,'actorId',v_actor,'listingId',p_listing,
      'revision',p_revision,'expectedVersion',p_expected::text,'jobId',p_job,'altText',v_job.alt_text,
      'manifestSha256',v_intent.manifest_sha256,'outputId',v_job.output_id,'mediaId',v_intent.media_id);
    IF v_operation.request_payload IS DISTINCT FROM v_payload
      OR v_operation.request_sha256<>encode(sha256(convert_to(v_payload::text,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
    RETURN app_private.media_attach_projection(v_intent);
  END IF;
  -- A global attachment UUID collision is generic and never discloses its tuple.
  PERFORM pg_advisory_xact_lock(hashtextextended('media-attach/' || p_operation::text,0));
  IF EXISTS(SELECT 1 FROM app_private.media_attach_intents WHERE operation_id=p_operation) THEN
    RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_job FROM app_private.media_jobs WHERE tenant_id=v_tenant AND id=p_job FOR UPDATE;
  v_now:=clock_timestamp();
  IF v_listing.assigned_agent_id<>v_job.registered_assigned_agent_id THEN RAISE EXCEPTION 'Assignment conflict' USING ERRCODE='40001'; END IF;
  IF v_revision.state<>'draft' OR v_job.expires_at<=v_now THEN RAISE EXCEPTION 'Attachment unavailable' USING ERRCODE='23514'; END IF;
  IF v_revision.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF p_operation IN (v_job.id,v_job.quarantine_id,v_job.output_id) THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM app_private.media_input_captures WHERE tenant_id=v_tenant AND job_id=p_job AND generation_id=p_operation)
    OR EXISTS(SELECT 1 FROM app_private.media_processing_leases WHERE tenant_id=v_tenant AND job_id=p_job
      AND (claim_id=p_operation OR lease_nonce=p_operation)) THEN
    RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_verified FROM app_private.media_verified_outputs WHERE tenant_id=v_tenant AND job_id=p_job FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM app_private.media_attachments WHERE tenant_id=v_tenant AND job_id=p_job) THEN
    RAISE EXCEPTION 'Attachment unavailable' USING ERRCODE='23514'; END IF;
  v_media:=gen_random_uuid();
  v_payload:=jsonb_build_object('kind','attach_media','tenantId',v_tenant,'actorId',v_actor,'listingId',p_listing,
    'revision',p_revision,'expectedVersion',p_expected::text,'jobId',p_job,'altText',v_job.alt_text,
    'manifestSha256',v_verified.manifest_sha256,'outputId',v_job.output_id,'mediaId',v_media);
  v_digest:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_ack:=jsonb_build_object('kind','attach_media','operationId',p_operation,'jobId',p_job,'listingId',p_listing,
    'revision',p_revision,'expectedVersion',p_expected::text,'altText',v_job.alt_text,'status','ready','receipt',NULL);
  INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
    expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    VALUES(v_tenant,p_operation,'attach_media',p_listing,p_revision,v_actor,p_expected,v_media,v_payload,v_digest,v_ack,v_now);
  INSERT INTO app_private.media_attach_intents(tenant_id,operation_id,job_id,listing_id,revision_no,requester_id,
    expected_version,alt_text,output_id,manifest_sha256,media_id,created_at,request_payload,request_sha256)
    VALUES(v_tenant,p_operation,p_job,p_listing,p_revision,v_actor,p_expected,v_job.alt_text,v_job.output_id,
      v_verified.manifest_sha256,v_media,v_now,v_payload,v_digest) RETURNING * INTO v_intent;
  RETURN app_private.media_attach_projection(v_intent);
END $$;
CREATE FUNCTION app_api.read_media_attach_intent(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_intent app_private.media_attach_intents;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  SELECT * INTO v_intent FROM app_private.media_attach_intents WHERE tenant_id=app_private.context_tenant()
    AND operation_id=p_operation AND requester_id=app_private.context_actor();
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  v_intent:=app_private.lock_media_attach_intent(p_operation);
  RETURN app_private.media_attach_projection(v_intent);
END $$;
CREATE FUNCTION app_media.read_media_attach_intent(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_intent app_private.media_attach_intents;
BEGIN
  v_intent:=app_private.lock_media_attach_intent(p_operation);
  RETURN app_private.media_attach_projection(v_intent);
END $$;

CREATE FUNCTION app_media.finalize_media(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_intent app_private.media_attach_intents; v_job app_private.media_jobs; v_listing app_private.listings;
  v_revision app_private.listing_revisions; v_verified app_private.media_verified_outputs;
  v_outcome text:='applied'; v_reason text; v_count integer; v_min integer; v_max integer;
  v_key text; v_version bigint; v_position integer; v_media uuid; v_now timestamptz; v_receipt jsonb;
BEGIN
  v_intent:=app_private.lock_media_attach_intent(p_operation);
  IF EXISTS(SELECT 1 FROM app_private.media_attach_results WHERE tenant_id=v_intent.tenant_id AND operation_id=p_operation) THEN
    RETURN app_private.media_attach_projection(v_intent); END IF;
  SELECT * INTO v_job FROM app_private.media_jobs WHERE tenant_id=v_intent.tenant_id AND id=v_intent.job_id FOR UPDATE;
  SELECT * INTO v_listing FROM app_private.listings WHERE tenant_id=v_intent.tenant_id AND id=v_intent.listing_id;
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_intent.tenant_id
    AND listing_id=v_intent.listing_id AND revision_no=v_intent.revision_no;
  SELECT * INTO v_verified FROM app_private.media_verified_outputs WHERE tenant_id=v_intent.tenant_id AND job_id=v_intent.job_id FOR UPDATE;
  v_now:=clock_timestamp(); v_version:=v_revision.version;
  v_key:='synthetic/' || v_intent.tenant_id::text || '/' || v_job.id::text || '/' || v_job.output_id::text || '.webp';
  IF v_listing.assigned_agent_id<>v_job.registered_assigned_agent_id THEN v_outcome:='conflict';v_reason:='ASSIGNMENT_CHANGED';
  ELSIF v_revision.state<>'draft' THEN v_outcome:='rejected';v_reason:='REVISION_NOT_DRAFT';
  ELSIF v_revision.version<>v_intent.expected_version OR v_revision.version>=9007199254740991 THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
  ELSIF v_job.expires_at<=v_now THEN v_outcome:='expired';v_reason:='JOB_EXPIRED';
  ELSIF v_verified.manifest_sha256 IS DISTINCT FROM v_intent.manifest_sha256 OR v_verified.output_id IS DISTINCT FROM v_intent.output_id
    OR v_job.alt_text IS DISTINCT FROM v_intent.alt_text THEN v_outcome:='rejected';v_reason:='PROVENANCE_CHANGED';
  ELSIF EXISTS(SELECT 1 FROM app_private.media_attachments WHERE tenant_id=v_intent.tenant_id AND job_id=v_intent.job_id) THEN
    v_outcome:='rejected';v_reason:='JOB_ALREADY_ATTACHED';
  ELSE
    -- All legacy/unaccepted associations consume capacity and position slots.
    PERFORM 1 FROM app_private.revision_media WHERE tenant_id=v_intent.tenant_id AND listing_id=v_intent.listing_id
      AND revision_no=v_intent.revision_no ORDER BY position FOR UPDATE;
    SELECT count(*),min(position),max(position) INTO v_count,v_min,v_max FROM app_private.revision_media
      WHERE tenant_id=v_intent.tenant_id AND listing_id=v_intent.listing_id AND revision_no=v_intent.revision_no;
    IF v_count>=12 THEN v_outcome:='rejected';v_reason:='CAPACITY_REACHED';
    ELSIF v_count>0 AND (v_min<>0 OR v_max<>v_count-1) THEN v_outcome:='rejected';v_reason:='PROVENANCE_CHANGED';
    ELSIF EXISTS(SELECT 1 FROM app_private.revision_media WHERE tenant_id=v_intent.tenant_id AND listing_id=v_intent.listing_id
      AND revision_no=v_intent.revision_no AND (public_object_key=v_key OR sha256=v_verified.manifest->>'sha256')) THEN
      v_outcome:='rejected';v_reason:='DUPLICATE_OUTPUT';
    END IF;
  END IF;
  IF v_outcome='applied' THEN
    v_position:=v_count;v_media:=v_intent.media_id;
    INSERT INTO app_private.media_attachments(tenant_id,media_id,operation_id,job_id,listing_id,revision_no,requester_id,
      expected_version,output_id,manifest_sha256,manifest,public_object_key,sha256,content_type,bytes,width,height,alt_text,accepted)
      VALUES(v_intent.tenant_id,v_media,p_operation,v_job.id,v_intent.listing_id,v_intent.revision_no,v_intent.requester_id,
        v_intent.expected_version,v_job.output_id,v_verified.manifest_sha256,v_verified.manifest,v_key,v_verified.manifest->>'sha256',
        v_verified.manifest->>'mimeType',(v_verified.manifest->>'bytes')::bigint,(v_verified.manifest->>'width')::integer,
        (v_verified.manifest->>'height')::integer,v_intent.alt_text,true);
    INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,
      alt_text,position,accepted,sealed_job_id,attach_operation_id,sealed_manifest_sha256)
      VALUES(v_intent.tenant_id,v_intent.listing_id,v_intent.revision_no,v_media,v_key,v_verified.manifest->>'mimeType',
        (v_verified.manifest->>'bytes')::bigint,(v_verified.manifest->>'width')::integer,(v_verified.manifest->>'height')::integer,
        v_verified.manifest->>'sha256',v_intent.alt_text,v_position,true,v_job.id,p_operation,v_verified.manifest_sha256);
    UPDATE app_private.listing_revisions SET updated_at=v_now WHERE tenant_id=v_intent.tenant_id
      AND listing_id=v_intent.listing_id AND revision_no=v_intent.revision_no RETURNING version INTO v_version;
    INSERT INTO app_private.audit_events(tenant_id,actor_id,action,object_type,object_id,object_version,correlation_id,summary)
      VALUES(v_intent.tenant_id,v_intent.requester_id,'media.attached','listing',v_intent.listing_id,v_version,
        'media-attach/' || p_operation::text,jsonb_build_object('revision',v_intent.revision_no,'operationId',p_operation,'mediaId',v_media));
  END IF;
  -- Typed failures return normally and therefore persist; exception/unknown commit
  -- outcomes are never inferred into terminal failure or automatically retried.
  v_receipt:=jsonb_build_object('kind','attach_media','operationId',p_operation,'jobId',v_intent.job_id,
    'listingId',v_intent.listing_id,'revision',v_intent.revision_no,'expectedVersion',v_intent.expected_version::text,
    'version',v_version::text,'outcome',v_outcome,'reason',v_reason,'mediaId',v_media,'position',v_position,
    'completedAt',app_private.media_utc(v_now));
  INSERT INTO app_private.media_attach_results(tenant_id,operation_id,job_id,outcome,reason,result_version,media_id,position,completed_at,receipt)
    VALUES(v_intent.tenant_id,p_operation,v_intent.job_id,v_outcome,v_reason,v_version,v_media,v_position,v_now,v_receipt);
  RETURN app_private.media_attach_projection(v_intent);
END $$;

CREATE FUNCTION app_private.require_sealed_revision_media(p_tenant uuid,p_listing uuid,p_revision integer) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_count integer;v_keys integer;v_hashes integer;v_verified integer;
BEGIN
  SELECT count(*),count(DISTINCT public_object_key),count(DISTINCT sha256),count(*) FILTER
    (WHERE accepted AND sealed_job_id IS NOT NULL AND attach_operation_id IS NOT NULL AND sealed_manifest_sha256 IS NOT NULL)
    INTO v_count,v_keys,v_hashes,v_verified FROM app_private.revision_media
    WHERE tenant_id=p_tenant AND listing_id=p_listing AND revision_no=p_revision;
  IF v_count NOT BETWEEN 4 AND 12 OR v_keys<>v_count OR v_hashes<>v_count OR v_verified<>v_count THEN
    RAISE EXCEPTION 'Require 4 to 12 distinct sealed photos' USING ERRCODE='23514'; END IF;
END $$;
CREATE OR REPLACE FUNCTION app_api.submit_revision(p_id uuid,p_revision integer,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_revision app_private.listing_revisions;v_version bigint;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);PERFORM app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant()
    AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF v_revision.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF v_revision.state<>'draft' THEN RAISE EXCEPTION 'Expected draft' USING ERRCODE='23514'; END IF;
  PERFORM app_private.require_sealed_revision_media(v_revision.tenant_id,p_id,p_revision);
  UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=app_private.context_actor()
    WHERE tenant_id=v_revision.tenant_id AND listing_id=p_id AND revision_no=p_revision RETURNING version INTO v_version;
  PERFORM app_private.audit('revision.submitted','listing',p_id,v_version,jsonb_build_object('revision',p_revision));RETURN v_version;
END $$;
CREATE FUNCTION app_private.require_sealed_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.state='approved' AND OLD.state IS DISTINCT FROM 'approved' THEN
    PERFORM app_private.require_sealed_revision_media(NEW.tenant_id,NEW.listing_id,NEW.revision_no); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sealed_approval BEFORE UPDATE OF state ON app_private.listing_revisions
  FOR EACH ROW EXECUTE FUNCTION app_private.require_sealed_approval();

REVOKE ALL ON FUNCTION app_private.media_attach_projection(app_private.media_attach_intents),
  app_private.lock_media_attach_intent(uuid),app_private.require_sealed_revision_media(uuid,uuid,integer),
  app_private.require_sealed_approval(),app_private.validate_media_attach_result() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_api.create_media_attach_intent(uuid,integer,bigint,uuid,uuid),app_api.read_media_attach_intent(uuid),
  app_media.finalize_media(uuid),app_media.read_media_attach_intent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.create_media_attach_intent(uuid,integer,bigint,uuid,uuid),app_api.read_media_attach_intent(uuid) TO api_runtime;
GRANT EXECUTE ON FUNCTION app_media.finalize_media(uuid),app_media.read_media_attach_intent(uuid) TO media_coordinator;
COMMIT;

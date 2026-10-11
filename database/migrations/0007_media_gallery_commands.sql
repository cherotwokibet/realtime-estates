-- Exact authenticated draft associations only; retained job/attachment/snapshot
-- facts and stored objects are never deleted by these gallery commands.
BEGIN;
SET LOCAL ROLE realtor_owner;

ALTER TABLE app_private.revision_media DROP CONSTRAINT revision_media_tenant_id_listing_id_revision_no_position_key;
ALTER TABLE app_private.revision_media ADD CONSTRAINT revision_media_gallery_positions
  UNIQUE (tenant_id,listing_id,revision_no,position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION app_private.media_gallery_array_valid(p_ids uuid[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF p_ids IS NULL THEN RETURN false;END IF;
  IF p_ids='{}'::uuid[] THEN RETURN true;END IF;
  IF array_ndims(p_ids)<>1 OR array_lower(p_ids,1)<>1 OR cardinality(p_ids) NOT BETWEEN 1 AND 12 THEN RETURN false;END IF;
  RETURN array_position(p_ids,NULL) IS NULL AND (SELECT count(DISTINCT x) FROM unnest(p_ids) x)=cardinality(p_ids);
END
$$;
CREATE FUNCTION app_private.validate_gallery_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_payload jsonb;v_receipt jsonb;v_ids uuid[];v_media uuid;v_version bigint;v_outcome text;v_reason text;
BEGIN
  IF NEW.kind NOT IN ('remove_media','reorder_media') THEN RETURN NEW; END IF;
  IF NEW.expected_version NOT BETWEEN 1 AND 9007199254740990 THEN
    RAISE EXCEPTION 'Invalid gallery version' USING ERRCODE='23514'; END IF;
  v_outcome:=NEW.receipt->>'outcome';v_reason:=NEW.receipt->>'reason';
  IF jsonb_typeof(NEW.receipt->'version') IS DISTINCT FROM 'string' OR (NEW.receipt->>'version') !~ '^[1-9][0-9]{0,15}$'
    OR jsonb_typeof(NEW.receipt->'orderedIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid gallery receipt' USING ERRCODE='23514'; END IF;
  v_version:=(NEW.receipt->>'version')::bigint;
  IF v_version NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'Invalid gallery receipt' USING ERRCODE='23514'; END IF;
  SELECT coalesce(array_agg(value::uuid ORDER BY ordinality),'{}'::uuid[]) INTO v_ids
    FROM jsonb_array_elements_text(NEW.receipt->'orderedIds') WITH ORDINALITY AS x(value,ordinality);
  IF NOT app_private.media_gallery_array_valid(v_ids) THEN RAISE EXCEPTION 'Invalid gallery receipt' USING ERRCODE='23514'; END IF;
  IF NEW.kind='remove_media' THEN
    v_media:=(NEW.request_payload->>'mediaId')::uuid;
    IF v_media IS NULL THEN RAISE EXCEPTION 'Invalid gallery request' USING ERRCODE='23514'; END IF;
    v_payload:=jsonb_build_object('kind',NEW.kind,'tenantId',NEW.tenant_id,'actorId',NEW.requester_id,
      'listingId',NEW.listing_id,'revision',NEW.revision_no,'expectedVersion',NEW.expected_version::text,'mediaId',v_media);
    IF (v_outcome='applied' OR v_reason='MEDIA_NOT_FOUND') AND v_media=ANY(v_ids) THEN
      RAISE EXCEPTION 'Invalid removal result' USING ERRCODE='23514'; END IF;
  ELSE
    v_payload:=jsonb_build_object('kind',NEW.kind,'tenantId',NEW.tenant_id,'actorId',NEW.requester_id,
      'listingId',NEW.listing_id,'revision',NEW.revision_no,'expectedVersion',NEW.expected_version::text,'orderedIds',to_jsonb(v_ids));
  END IF;
  v_receipt:=jsonb_build_object('kind',NEW.kind,'operationId',NEW.operation_id,'listingId',NEW.listing_id,
    'revision',NEW.revision_no,'expectedVersion',NEW.expected_version::text,'version',v_version::text,
    'outcome',v_outcome,'reason',v_reason,'mediaId',v_media,'orderedIds',to_jsonb(v_ids),
    'completedAt',app_private.media_utc(NEW.created_at));
  IF NEW.request_payload IS DISTINCT FROM v_payload OR NEW.receipt IS DISTINCT FROM v_receipt OR NOT coalesce(
    (v_outcome='applied' AND v_reason IS NULL AND v_version=NEW.expected_version+1)
    OR (NEW.kind='reorder_media' AND v_outcome='noop' AND v_reason IS NULL AND v_version=NEW.expected_version)
    OR (v_outcome='conflict' AND v_reason='VERSION_CONFLICT' AND v_version<>NEW.expected_version)
    OR (v_outcome='rejected' AND (v_reason='REVISION_NOT_DRAFT' OR v_reason='MEDIA_SET_CHANGED'
      OR (NEW.kind='remove_media' AND v_reason='MEDIA_NOT_FOUND'))),false) THEN
    RAISE EXCEPTION 'Invalid gallery operation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_gallery_operation BEFORE INSERT ON app_private.media_operations
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_gallery_operation();

CREATE FUNCTION app_private.execute_media_gallery_command(p_kind text,p_listing uuid,p_revision integer,p_expected bigint,
  p_operation uuid,p_media uuid,p_ordered uuid[]) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
  v_revision app_private.listing_revisions;v_operation app_private.media_operations;v_payload jsonb;v_digest text;
  v_current uuid[];v_result uuid[];v_min integer;v_max integer;v_count integer;v_dense boolean;
  v_outcome text:='applied';v_reason text;v_version bigint;v_now timestamptz;v_receipt jsonb;v_resource uuid;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  IF p_kind NOT IN ('remove_media','reorder_media') OR p_listing IS NULL OR p_revision IS NULL OR p_revision<1
    OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990 OR p_operation IS NULL
    OR (p_kind='remove_media' AND (p_media IS NULL OR p_ordered IS NOT NULL))
    OR (p_kind='reorder_media' AND (p_media IS NOT NULL OR NOT coalesce(app_private.media_gallery_array_valid(p_ordered),false))) THEN
    RAISE EXCEPTION 'Invalid gallery request' USING ERRCODE='23514'; END IF;
  PERFORM app_private.lock_listing(p_listing);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/' || p_operation::text,0));
  v_payload:=jsonb_build_object('kind',p_kind,'tenantId',v_tenant,'actorId',v_actor,'listingId',p_listing,
    'revision',p_revision,'expectedVersion',p_expected::text) ||
    CASE WHEN p_kind='remove_media' THEN jsonb_build_object('mediaId',p_media) ELSE jsonb_build_object('orderedIds',to_jsonb(p_ordered)) END;
  v_digest:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  SELECT * INTO v_operation FROM app_private.media_operations WHERE tenant_id=v_tenant AND operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
    IF v_operation.kind<>p_kind OR v_operation.requester_id<>v_actor OR v_operation.listing_id<>p_listing
      OR v_operation.revision_no<>p_revision OR v_operation.expected_version<>p_expected
      OR v_operation.request_payload IS DISTINCT FROM v_payload OR v_operation.request_sha256<>v_digest THEN
      RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
    RETURN v_operation.receipt;
  END IF;
  -- No state/version/set check, UUID allocation or write occurs on exact replay.
  -- New UUIDs cannot repurpose known identities from this tuple's media pipeline.
  IF p_operation IS NOT DISTINCT FROM p_media OR p_operation=ANY(coalesce(p_ordered,'{}'::uuid[]))
    OR EXISTS(SELECT 1 FROM app_private.media_operations WHERE tenant_id=v_tenant AND resource_id=p_operation)
    OR EXISTS(SELECT 1 FROM app_private.revision_media WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision AND id=p_operation)
    OR EXISTS(SELECT 1 FROM app_private.media_jobs j LEFT JOIN app_private.media_input_captures c
      ON c.tenant_id=j.tenant_id AND c.job_id=j.id WHERE j.tenant_id=v_tenant AND j.listing_id=p_listing AND j.revision_no=p_revision
      AND p_operation IN (j.id,j.quarantine_id,j.output_id,c.generation_id))
    OR EXISTS(SELECT 1 FROM app_private.media_jobs j JOIN app_private.media_processing_leases l
      ON l.tenant_id=j.tenant_id AND l.job_id=j.id WHERE j.tenant_id=v_tenant AND j.listing_id=p_listing AND j.revision_no=p_revision
      AND p_operation IN (l.claim_id,l.lease_nonce)) THEN
    RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
  IF v_revision.version NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Unsupported revision version' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM app_private.revision_media WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision ORDER BY position FOR UPDATE;
  SELECT coalesce(array_agg(id ORDER BY position),'{}'::uuid[]),count(*),min(position),max(position)
    INTO v_current,v_count,v_min,v_max FROM app_private.revision_media WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision;
  v_dense:=v_count=0 OR (v_min=0 AND v_max=v_count-1);
  v_result:=CASE WHEN p_kind='remove_media' THEN v_current ELSE p_ordered END;v_version:=v_revision.version;
  IF v_revision.state<>'draft' THEN v_outcome:='rejected';v_reason:='REVISION_NOT_DRAFT';
  ELSIF v_revision.version<>p_expected THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
  ELSIF p_kind='remove_media' THEN
    IF NOT (p_media=ANY(v_current)) THEN v_outcome:='rejected';v_reason:='MEDIA_NOT_FOUND';
    ELSIF NOT v_dense THEN v_outcome:='rejected';v_reason:='MEDIA_SET_CHANGED';
    ELSE v_result:=array_remove(v_current,p_media);END IF;
  ELSE
    IF cardinality(p_ordered)<>v_count OR NOT (p_ordered @> v_current AND v_current @> p_ordered) THEN
      v_outcome:='rejected';v_reason:='MEDIA_SET_CHANGED';
    ELSIF p_ordered=v_current AND v_dense THEN v_outcome:='noop';END IF;
  END IF;
  IF v_outcome='applied' THEN
    SET CONSTRAINTS app_private.revision_media_gallery_positions DEFERRED;
    IF p_kind='remove_media' THEN DELETE FROM app_private.revision_media
      WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision AND id=p_media;END IF;
    UPDATE app_private.revision_media m SET position=(o.ordinality-1)::integer
      FROM unnest(v_result) WITH ORDINALITY o(id,ordinality)
      WHERE m.tenant_id=v_tenant AND m.listing_id=p_listing AND m.revision_no=p_revision AND m.id=o.id;
    SET CONSTRAINTS app_private.revision_media_gallery_positions IMMEDIATE;
    SELECT count(*),min(position),max(position) INTO v_count,v_min,v_max FROM app_private.revision_media
      WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision;
    IF v_count<>cardinality(v_result) OR (v_count>0 AND (v_min<>0 OR v_max<>v_count-1))
      OR (SELECT coalesce(array_agg(id ORDER BY position),'{}'::uuid[]) FROM app_private.revision_media
        WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision) IS DISTINCT FROM v_result THEN
      RAISE EXCEPTION 'Gallery invariant failed' USING ERRCODE='23514';END IF;
    UPDATE app_private.listing_revisions SET updated_at=clock_timestamp() WHERE tenant_id=v_tenant AND listing_id=p_listing
      AND revision_no=p_revision RETURNING version INTO v_version;
    PERFORM app_private.audit(CASE WHEN p_kind='remove_media' THEN 'media.removed' ELSE 'media.reordered' END,
      'listing',p_listing,v_version,jsonb_build_object('revision',p_revision,'operationId',p_operation,'mediaId',p_media,'orderedIds',to_jsonb(v_result)));
  END IF;
  v_now:=clock_timestamp();
  v_receipt:=jsonb_build_object('kind',p_kind,'operationId',p_operation,'listingId',p_listing,'revision',p_revision,
    'expectedVersion',p_expected::text,'version',v_version::text,'outcome',v_outcome,'reason',v_reason,
    'mediaId',p_media,'orderedIds',to_jsonb(v_result),'completedAt',app_private.media_utc(v_now));
  v_resource:=gen_random_uuid();
  INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,expected_version,
    resource_id,request_payload,request_sha256,receipt,created_at)
    VALUES(v_tenant,p_operation,p_kind,p_listing,p_revision,v_actor,p_expected,v_resource,v_payload,v_digest,v_receipt,v_now);
  RETURN v_receipt;
END $$;
CREATE FUNCTION app_api.remove_draft_media(p_listing uuid,p_revision integer,p_expected bigint,p_operation uuid,p_media uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT app_private.execute_media_gallery_command('remove_media',p_listing,p_revision,p_expected,p_operation,p_media,NULL)
$$;
CREATE FUNCTION app_api.reorder_draft_media(p_listing uuid,p_revision integer,p_expected bigint,p_operation uuid,p_ordered uuid[]) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT app_private.execute_media_gallery_command('reorder_media',p_listing,p_revision,p_expected,p_operation,NULL,p_ordered)
$$;
CREATE FUNCTION app_api.read_media_operation(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_operation app_private.media_operations;v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  SELECT * INTO v_operation FROM app_private.media_operations WHERE tenant_id=v_tenant AND operation_id=p_operation
    AND requester_id=v_actor AND kind IN ('remove_media','reorder_media');
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
  PERFORM app_private.lock_listing(v_operation.listing_id);
  PERFORM 1 FROM app_private.listing_revisions WHERE tenant_id=v_tenant AND listing_id=v_operation.listing_id
    AND revision_no=v_operation.revision_no FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/' || p_operation::text,0));
  SELECT * INTO v_operation FROM app_private.media_operations WHERE tenant_id=v_tenant AND operation_id=p_operation FOR UPDATE;
  RETURN v_operation.receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.media_gallery_array_valid(uuid[]),app_private.validate_gallery_operation(),
  app_private.execute_media_gallery_command(text,uuid,integer,bigint,uuid,uuid,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_api.remove_draft_media(uuid,integer,bigint,uuid,uuid),
  app_api.reorder_draft_media(uuid,integer,bigint,uuid,uuid[]),app_api.read_media_operation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.remove_draft_media(uuid,integer,bigint,uuid,uuid),
  app_api.reorder_draft_media(uuid,integer,bigint,uuid,uuid[]),app_api.read_media_operation(uuid) TO api_runtime;
COMMIT;

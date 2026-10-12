-- Current staff may inspect a saved draft photo's immutable SQL provenance. This
-- read does not prove stored bytes, confer processing authority, or deliver an
-- image. The trusted server must validate configured request/seal/output stores
-- and repeat this read after I/O before returning any bytes.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE FUNCTION app_api.read_private_media_preview(p_listing uuid,p_revision integer,p_media uuid,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_receipt jsonb;
BEGIN
  IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1 OR p_media IS NULL
    OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid preview request' USING ERRCODE='23514';
  END IF;

  -- A single read snapshot authorizes the current viewer and binds the current
  -- association to its applied immutable history. Do not call processing-job or
  -- attachment-intent locks: those intentionally authorize the original worker
  -- requester, whose later revocation/reassignment must not hide an otherwise
  -- eligible saved association from the current administrator/assigned agent.
  SELECT jsonb_build_object(
      'kind','private_media_preview','tenantId',r.tenant_id,'listingId',r.listing_id,
      'revision',r.revision_no,'version',r.version::text,'state','draft','mediaId',m.id,
      'operationId',a.operation_id,'assignedAgentId',l.assigned_agent_id,'actorRole',app_private.staff_role(),
      'context',jsonb_build_object('jobId',j.id,'quarantineId',j.quarantine_id,'outputId',j.output_id,
        'expiresAt',app_private.media_utc(j.expires_at),'pipeline','synthetic-codec-v1'),
      'capture',app_private.media_capture_receipt(c),
      'lease',app_private.media_lease_receipt(e,j,c),
      'verified',app_private.media_verified_receipt(v))
    INTO v_receipt
  FROM app_private.listings l
  JOIN app_private.listing_revisions r
    ON r.tenant_id=l.tenant_id AND r.listing_id=l.id AND r.revision_no=p_revision AND r.state='draft'
  JOIN app_private.revision_media m
    ON m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no
      AND m.id=p_media AND m.accepted
  JOIN app_private.media_attachments a
    ON a.tenant_id=m.tenant_id AND a.media_id=m.id AND a.listing_id=m.listing_id AND a.revision_no=m.revision_no
      AND a.job_id=m.sealed_job_id AND a.operation_id=m.attach_operation_id AND a.manifest_sha256=m.sealed_manifest_sha256
      AND a.public_object_key=m.public_object_key AND a.sha256=m.sha256 AND a.content_type=m.content_type
      AND a.bytes=m.bytes AND a.width=m.width AND a.height=m.height AND a.alt_text=m.alt_text AND a.accepted
  JOIN app_private.media_attach_intents i
    ON i.tenant_id=a.tenant_id AND i.operation_id=a.operation_id AND i.job_id=a.job_id AND i.media_id=a.media_id
      AND i.listing_id=a.listing_id AND i.revision_no=a.revision_no AND i.requester_id=a.requester_id
      AND i.expected_version=a.expected_version AND i.output_id=a.output_id AND i.manifest_sha256=a.manifest_sha256
      AND i.alt_text=a.alt_text AND i.kind='attach_media'
  JOIN app_private.media_attach_results s
    ON s.tenant_id=i.tenant_id AND s.operation_id=i.operation_id AND s.job_id=i.job_id
      AND s.media_id=i.media_id AND s.outcome='applied' AND s.reason IS NULL
      AND s.result_version=i.expected_version+1 AND s.result_version<=r.version
  JOIN app_private.media_jobs j
    ON j.tenant_id=a.tenant_id AND j.id=a.job_id AND j.listing_id=a.listing_id AND j.revision_no=a.revision_no
      AND j.requester_id=a.requester_id AND j.output_id=a.output_id
  JOIN app_private.media_input_captures c
    ON c.tenant_id=j.tenant_id AND c.job_id=j.id AND c.listing_id=j.listing_id AND c.revision_no=j.revision_no
      AND c.requester_id=j.requester_id
  JOIN app_private.media_verified_outputs v
    ON v.tenant_id=j.tenant_id AND v.job_id=j.id AND v.output_id=j.output_id
      AND v.manifest_sha256=a.manifest_sha256 AND v.manifest=a.manifest
  JOIN app_private.media_processing_leases e
    ON e.tenant_id=v.tenant_id AND e.job_id=v.job_id AND e.attempt=v.attempt AND e.lease_nonce=v.lease_nonce
      AND e.job_expires_at=j.expires_at
  WHERE l.tenant_id=app_private.context_tenant() AND l.id=p_listing
    AND app_private.may_work(l.tenant_id,l.assigned_agent_id)
    AND coalesce(app_private.synthetic_media_manifest_valid(v.manifest),false)
    AND v.manifest_sha256=encode(sha256(convert_to(v.manifest::text,'UTF8')),'hex')
    AND v.manifest->'inputBytes'=to_jsonb(c.input_bytes) AND v.manifest->>'inputSha256'=c.input_sha256
    AND v.manifest->'bytes'=to_jsonb(a.bytes) AND v.manifest->>'sha256'=a.sha256
    AND v.manifest->>'mimeType'=a.content_type AND v.manifest->'width'=to_jsonb(a.width)
    AND v.manifest->'height'=to_jsonb(a.height);

  -- Unauthorized, removed, non-draft, legacy and incomplete provenance all have
  -- the same result, even if the caller also supplied an old version. Only an
  -- otherwise eligible association may disclose a typed version conflict.
  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_receipt->>'version' IS DISTINCT FROM p_expected::text THEN
    RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';
  END IF;
  RETURN v_receipt;
END $$;

REVOKE ALL ON FUNCTION app_api.read_private_media_preview(uuid,integer,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_private_media_preview(uuid,integer,uuid,bigint) TO api_runtime;
COMMIT;

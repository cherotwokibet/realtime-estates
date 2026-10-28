-- Anonymous provenance only. Delivery must also verify native seals and repeat
-- this current-public eligibility check after I/O before returning image bytes.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.read_public_media_preview(p_listing uuid,p_revision integer,p_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_receipt jsonb;
BEGIN
  IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1 OR p_key IS NULL OR length(p_key)>200
    OR p_key !~ '^synthetic/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' THEN
    RAISE EXCEPTION 'Invalid public image request' USING ERRCODE='23514';
  END IF;
  -- The view checks company/enabled/current published pointer/available/fresh30days.
  SELECT jsonb_build_object(
      'kind','public_media_preview','tenantId',r.tenant_id,'listingId',r.listing_id,
      'revision',r.revision_no,'version',r.version::text,'state','approved','mediaId',m.id,
      'operationId',a.operation_id,'assignedAgentId',NULL,'actorRole','guest',
      'context',jsonb_build_object('jobId',j.id,'quarantineId',j.quarantine_id,'outputId',j.output_id,
        'expiresAt',app_private.media_utc(j.expires_at),'pipeline','synthetic-codec-v1'),
      'capture',app_private.media_capture_receipt(c),
      'lease',app_private.media_lease_receipt(e,j,c),
      'verified',app_private.media_verified_receipt(v)) INTO v_receipt
  FROM app_api.public_listings p
  JOIN app_private.listings l ON l.tenant_id=p.tenant_id AND l.id=p.listing_id
  JOIN app_private.listing_revisions r
    ON r.tenant_id=l.tenant_id AND r.listing_id=l.id AND r.revision_no=p_revision
      AND r.revision_no=p.revision_no AND r.state='approved'
  JOIN app_private.revision_media m
    ON m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no
      AND m.public_object_key=p_key AND m.accepted
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
    AND app_private.context_actor() IS NULL
    AND p.photo_refs @> jsonb_build_array(jsonb_build_object('key',m.public_object_key,'alt',m.alt_text))
    AND r.submitted_by IS NOT NULL AND r.submitted_at IS NOT NULL
    AND coalesce(app_private.synthetic_media_manifest_valid(v.manifest),false)
    AND v.manifest_sha256=encode(sha256(convert_to(v.manifest::text,'UTF8')),'hex')
    AND v.manifest->'inputBytes'=to_jsonb(c.input_bytes) AND v.manifest->>'inputSha256'=c.input_sha256
    AND v.manifest->'bytes'=to_jsonb(a.bytes) AND v.manifest->>'sha256'=a.sha256
    AND v.manifest->>'mimeType'=a.content_type AND v.manifest->'width'=to_jsonb(a.width)
    AND v.manifest->'height'=to_jsonb(a.height);
  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_api.read_public_media_preview(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_public_media_preview(uuid,integer,text) TO api_runtime;
COMMIT;

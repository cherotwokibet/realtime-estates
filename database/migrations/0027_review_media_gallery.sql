-- Reviewer identities only. Image delivery still repeats current authorization
-- and verifies actual native bytes; this projection grants no storage authority.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.read_review_media_gallery(p_listing uuid,p_revision integer,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_version bigint; v_media record; v_photos jsonb := '[]'::jsonb; v_count integer := 0;
BEGIN
  IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1
    OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid gallery request' USING ERRCODE='23514';
  END IF;
  SELECT r.version INTO v_version
  FROM app_private.listings l JOIN app_private.listing_revisions r
    ON r.tenant_id=l.tenant_id AND r.listing_id=l.id
  WHERE l.tenant_id=app_private.context_tenant() AND l.id=p_listing
    AND r.revision_no=p_revision AND r.state='pending'
    AND r.submitted_by IS NOT NULL AND r.submitted_at IS NOT NULL
    AND app_private.staff_role()='admin';
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  FOR v_media IN SELECT m.id,m.alt_text,m.position
    FROM app_private.revision_media m
    WHERE m.tenant_id=app_private.context_tenant() AND m.listing_id=p_listing
      AND m.revision_no=p_revision AND m.accepted ORDER BY m.position
  LOOP
    -- Use actual current version first: missing provenance is denied before
    -- stale currency can disclose that this gallery exists.
    PERFORM app_api.read_review_media_preview(p_listing,p_revision,v_media.id,v_version);
    v_photos := v_photos || jsonb_build_array(jsonb_build_object(
      'id',v_media.id,'alt',v_media.alt_text,'position',v_media.position));
    v_count := v_count+1;
  END LOOP;
  IF v_count NOT BETWEEN 4 AND 12 THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_version IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('kind','review_media_gallery','listingId',p_listing,
    'revision',p_revision,'version',v_version::text,'state','pending','photos',v_photos);
END $$;
REVOKE ALL ON FUNCTION app_api.read_review_media_gallery(uuid,integer,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_review_media_gallery(uuid,integer,bigint) TO api_runtime;
COMMIT;

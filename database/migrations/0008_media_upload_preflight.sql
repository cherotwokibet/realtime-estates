-- Current authenticated admission eligibility only. A successful read neither
-- reserves an upload nor grants a durable processing/storage capability.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.preflight_media_upload(p_listing uuid,p_revision integer,p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid := app_private.context_tenant(); v_actor uuid := app_private.context_actor();
  v_listing app_private.listings; v_revision app_private.listing_revisions; v_job app_private.media_jobs;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  IF p_listing IS NULL OR p_revision IS NULL OR p_revision<1 OR p_job IS NULL THEN
    RAISE EXCEPTION 'Invalid upload context' USING ERRCODE='23514'; END IF;
  -- Match the established listing -> revision -> job lock order. All locks end
  -- with this short transaction; the caller must not stream bytes inside it.
  v_listing := app_private.lock_listing(p_listing);
  SELECT * INTO v_revision FROM app_private.listing_revisions
    WHERE tenant_id=v_tenant AND listing_id=p_listing AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_job FROM app_private.media_jobs
    WHERE tenant_id=v_tenant AND id=p_job AND listing_id=p_listing AND revision_no=p_revision
      AND requester_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF v_listing.assigned_agent_id IS DISTINCT FROM v_job.registered_assigned_agent_id THEN
    RAISE EXCEPTION 'Assignment conflict' USING ERRCODE='40001'; END IF;
  IF v_revision.state<>'draft' OR v_job.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='23514'; END IF;
  -- No revision token is compared, adopted or changed. Processing and exact
  -- attachment retain their own current-authorization checks after this read.
  RETURN jsonb_build_object('jobId',v_job.id,'listingId',v_job.listing_id,'revision',v_job.revision_no);
END $$;
REVOKE ALL ON FUNCTION app_api.preflight_media_upload(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.preflight_media_upload(uuid,integer,uuid) TO api_runtime;
-- No existing function rewrite, table/schema grant, identity override or write.
RESET ROLE;
COMMIT;

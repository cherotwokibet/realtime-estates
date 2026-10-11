-- Narrow coordinator lookup before input capture. This is neither an upload
-- capability nor permission to overwrite a stored object or restart a worker.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_media.read_upload_context(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job app_private.media_jobs;
BEGIN
  v_job := app_private.lock_processing_job(p_job,true);
  RETURN jsonb_build_object('jobId',v_job.id,'quarantineId',v_job.quarantine_id,
    'outputId',v_job.output_id,'expiresAt',app_private.media_utc(v_job.expires_at),
    'pipeline','synthetic-codec-v1');
END $$;
REVOKE ALL ON FUNCTION app_media.read_upload_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_media.read_upload_context(uuid) TO media_coordinator;
-- No table grants, API grant, identity selector or existing function rewrite.
RESET ROLE;
COMMIT;

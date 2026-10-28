-- Offline maintenance admission only. Never grants deletion of verified bytes.
-- SQL metadata/receipts are retained; filesystem completion is a separate fact.
BEGIN;
CREATE ROLE media_maintenance NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA app_media TO media_maintenance;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.expired_media_cleanup (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, operation_id uuid NOT NULL UNIQUE,
  authorized_at timestamptz NOT NULL,
  receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
  PRIMARY KEY(tenant_id,job_id),
  FOREIGN KEY(tenant_id,job_id) REFERENCES app_private.media_jobs(tenant_id,id)
);
ALTER TABLE app_private.expired_media_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.expired_media_cleanup FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.expired_media_cleanup TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_expired_media_cleanup BEFORE UPDATE OR DELETE ON app_private.expired_media_cleanup
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_registered_media();

CREATE FUNCTION app_media.authorize_expired_cleanup(p_tenant uuid,p_job uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app_private.media_jobs; original app_private.expired_media_cleanup; now_at timestamptz; result jsonb;
BEGIN
 IF p_tenant IS NULL OR p_job IS NULL OR p_operation IS NULL OR p_operation=p_job THEN
  RAISE EXCEPTION 'Invalid cleanup identity' USING ERRCODE='23514'; END IF;
 -- Exact configured tenant; no context GUC or posted actor/membership is adopted.
 SELECT * INTO j FROM app_private.media_jobs WHERE tenant_id=p_tenant AND id=p_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup unavailable' USING ERRCODE='P0002';END IF;
 IF p_operation=j.quarantine_id OR p_operation=j.output_id THEN
  RAISE EXCEPTION 'Invalid cleanup identity' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('media-cleanup/'||p_operation::text,0));
 SELECT * INTO original FROM app_private.expired_media_cleanup WHERE operation_id=p_operation;
 IF FOUND THEN
  IF original.tenant_id<>p_tenant OR original.job_id<>p_job THEN
   RAISE EXCEPTION 'Cleanup operation conflict' USING ERRCODE='40001';END IF;
  RETURN original.receipt;
 END IF;
 SELECT * INTO original FROM app_private.expired_media_cleanup WHERE tenant_id=p_tenant AND job_id=p_job;
 IF FOUND THEN RAISE EXCEPTION 'Use original cleanup operation' USING ERRCODE='40001';END IF;
 now_at:=clock_timestamp();
 -- One additional hour after the job's24h lifetime. Every processing lease ends
 -- at or before job expiry. Offline caller must still drain/confirm all workers.
 IF now_at<j.expires_at+interval '1 hour' OR EXISTS(
  SELECT 1 FROM app_private.media_processing_leases WHERE tenant_id=p_tenant AND job_id=p_job AND lease_expires_at>now_at)
 THEN RAISE EXCEPTION 'Cleanup not due' USING ERRCODE='23514';END IF;
 -- Retain every verified job, including rejected/removed/unattached outputs.
 -- Existing attachment/intents have verified-output FKs; no public/history
 -- reference can be acquired after an unverified job's expiry.
 IF EXISTS(SELECT 1 FROM app_private.media_verified_outputs WHERE tenant_id=p_tenant AND job_id=p_job)
  OR EXISTS(SELECT 1 FROM app_private.media_attach_intents WHERE tenant_id=p_tenant AND job_id=p_job)
  OR EXISTS(SELECT 1 FROM app_private.media_attachments WHERE tenant_id=p_tenant AND job_id=p_job)
 THEN RAISE EXCEPTION 'Referenced media retained' USING ERRCODE='23514';END IF;
 result:=jsonb_build_object('kind','expire_unverified_media','tenantId',p_tenant,'jobId',p_job,'operationId',p_operation,
  'quarantineId',j.quarantine_id,'outputId',j.output_id,'expiredAt',app_private.media_utc(j.expires_at),
  'authorizedAt',app_private.media_utc(now_at),'outcome','authorized');
 INSERT INTO app_private.expired_media_cleanup(tenant_id,job_id,operation_id,authorized_at,receipt)
 VALUES(p_tenant,p_job,p_operation,now_at,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_media.authorize_expired_cleanup(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_media.authorize_expired_cleanup(uuid,uuid,uuid) TO media_maintenance;
CREATE FUNCTION app_media.expired_cleanup_candidates(p_tenant uuid,p_after uuid,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz:=clock_timestamp(); result jsonb;
BEGIN
 IF p_tenant IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
  RAISE EXCEPTION 'Invalid cleanup page' USING ERRCODE='23514';END IF;
 WITH candidates AS MATERIALIZED (
  SELECT j.id,c.operation_id FROM app_private.media_jobs j LEFT JOIN app_private.expired_media_cleanup c ON c.tenant_id=j.tenant_id AND c.job_id=j.id
  WHERE j.tenant_id=p_tenant AND (p_after IS NULL OR j.id>p_after) AND j.expires_at+interval '1 hour'<=at_time
   AND NOT EXISTS(SELECT 1 FROM app_private.media_verified_outputs v WHERE v.tenant_id=j.tenant_id AND v.job_id=j.id)
   AND NOT EXISTS(SELECT 1 FROM app_private.media_attach_intents i WHERE i.tenant_id=j.tenant_id AND i.job_id=j.id)
   AND NOT EXISTS(SELECT 1 FROM app_private.media_attachments a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id)
  ORDER BY j.id LIMIT p_limit+1
 ), page AS(SELECT * FROM candidates ORDER BY id LIMIT p_limit)
 SELECT jsonb_build_object('tenantId',p_tenant,'asOf',app_private.media_utc(at_time),
  'jobs',coalesce((SELECT jsonb_agg(jsonb_build_object('jobId',id,'operationId',operation_id) ORDER BY id) FROM page),'[]'::jsonb),
  'hasMore',(SELECT count(*)>p_limit FROM candidates)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_media.expired_cleanup_candidates(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_media.expired_cleanup_candidates(uuid,uuid,integer) TO media_maintenance;
COMMIT;

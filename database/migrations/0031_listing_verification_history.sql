-- Stable older-history navigation; never interpret the first page as all history.
BEGIN;
SET LOCAL ROLE realtor_owner;
DROP FUNCTION app_api.read_listing_verification_history(uuid,integer);
CREATE FUNCTION app_api.read_listing_verification_history(p_listing uuid,p_limit integer DEFAULT 20,p_before bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE records jsonb;more boolean;v bigint;
BEGIN
 IF app_private.staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 OR (p_before IS NOT NULL AND p_before NOT BETWEEN 1 AND 9007199254740991) THEN RAISE EXCEPTION 'Invalid history window' USING ERRCODE='23514';END IF;
 SELECT version INTO v FROM app_private.listing_verification_state WHERE tenant_id=app_private.context_tenant() AND listing_id=p_listing;
 WITH page AS (SELECT x.*,row_number() OVER(ORDER BY x.version DESC) AS n FROM app_private.listing_verification_records x WHERE tenant_id=app_private.context_tenant() AND listing_id=p_listing AND (p_before IS NULL OR version<p_before) ORDER BY version DESC LIMIT p_limit+1)
 SELECT coalesce(jsonb_agg(app_private.listing_verification_record_json(ROW(p.tenant_id,p.listing_id,p.version,p.operation_id,p.actor_id,p.listing_version,p.revision_no,p.revision_version,p.subject,p.outcome,p.evidence_reference,p.note,p.observed_at,p.recorded_at)::app_private.listing_verification_records) ORDER BY p.version DESC) FILTER(WHERE p.n<=p_limit),'[]'::jsonb),coalesce(bool_or(p.n>p_limit),false) INTO records,more FROM page p;
 RETURN jsonb_build_object('kind','listing_verification_history','listingId',p_listing,'verificationVersion',coalesce(v,0)::text,'beforeVersion',p_before::text,'records',records,'hasMore',more);
END $$;
REVOKE ALL ON FUNCTION app_api.read_listing_verification_history(uuid,integer,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_verification_history(uuid,integer,bigint) TO api_runtime;
COMMIT;

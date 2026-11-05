-- Isolated server-only delivery capability, after floor-plan-publication.sql.
-- Raw storage provenance is for trusted delivery composition, never a JSON API response.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.read_synthetic_published_floor_plan_output(p_listing uuid,p_revision integer,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE published jsonb;selected app_private.synthetic_floor_plan_attachments;
BEGIN
 IF app_private.context_actor() IS NOT NULL THEN RAISE EXCEPTION 'Anonymous delivery required' USING ERRCODE='42501';END IF;
 published:=app_api.read_synthetic_published_floor_plan(p_listing,p_revision);
 IF p_expected IS NULL OR p_expected<1 OR p_expected>9007199254740991 OR (published->>'approvedVersion')::bigint<>p_expected
 THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 SELECT a.* INTO selected FROM app_private.synthetic_approved_floor_plans s
  JOIN app_private.synthetic_floor_plan_attachments a ON a.tenant_id=s.tenant_id AND a.operation_id=s.operation_id
  WHERE s.tenant_id=app_private.context_tenant() AND s.listing_id=p_listing AND s.revision_no=p_revision AND s.approved_version=p_expected;
 RETURN jsonb_build_object('policy','synthetic-published-floor-plan-output-v1','companyId',app_private.context_tenant(),
  'listingId',p_listing,'revision',p_revision,'approvedVersion',p_expected::text,
  'floorPlan',CASE WHEN selected.request_id IS NOT NULL THEN app_private.synthetic_floor_plan_attachment_record(selected) ELSE 'null'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION app_api.read_synthetic_published_floor_plan_output(uuid,integer,bigint) FROM PUBLIC,media_coordinator;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_published_floor_plan_output(uuid,integer,bigint) TO api_runtime;
COMMIT;

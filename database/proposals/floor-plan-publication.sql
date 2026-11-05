-- Isolated opt-in extension, after floor-plan-attachment.sql. No backfill.
-- Capture inside the existing moderation transaction; bytes are delivered separately.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.synthetic_approved_floor_plans (
 tenant_id uuid NOT NULL,listing_id uuid NOT NULL,revision_no integer NOT NULL,
 approved_version bigint NOT NULL CHECK(approved_version BETWEEN 1 AND 9007199254740991),
 operation_id uuid,
 PRIMARY KEY(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES app_private.synthetic_floor_plan_attachments(tenant_id,operation_id)
);
ALTER TABLE app_private.synthetic_approved_floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_approved_floor_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_approved_floor_plans TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_approved_floor_plan BEFORE UPDATE OR DELETE ON app_private.synthetic_approved_floor_plans
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_approved_floor_plans FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.capture_synthetic_approved_floor_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected app_private.synthetic_floor_plan_attachments;
BEGIN
 IF NEW.state='approved' AND OLD.state='pending' THEN
  SELECT * INTO selected FROM app_private.synthetic_floor_plan_attachments
   WHERE tenant_id=NEW.tenant_id AND listing_id=NEW.listing_id AND revision_no=NEW.revision_no
    AND result_version<NEW.version ORDER BY result_version DESC LIMIT 1;
  INSERT INTO app_private.synthetic_approved_floor_plans(tenant_id,listing_id,revision_no,approved_version,operation_id)
   VALUES(NEW.tenant_id,NEW.listing_id,NEW.revision_no,NEW.version,
    CASE WHEN selected.request_id IS NOT NULL THEN selected.operation_id ELSE NULL END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_synthetic_approved_floor_plan AFTER UPDATE OF state ON app_private.listing_revisions
 FOR EACH ROW EXECUTE FUNCTION app_private.capture_synthetic_approved_floor_plan();
CREATE FUNCTION app_api.read_synthetic_review_floor_plan(p_listing uuid,p_revision integer,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;selected app_private.synthetic_floor_plan_attachments;
 plan jsonb:='null'::jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) OR l.publication_status='archived'
 THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision;
 IF NOT FOUND OR r.state NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Review unavailable' USING ERRCODE='P0002';END IF;
 IF p_expected IS NULL OR p_expected<>r.version THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 IF r.state='pending' THEN
  SELECT * INTO selected FROM app_private.synthetic_floor_plan_attachments
   WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=r.revision_no
    AND result_version<r.version ORDER BY result_version DESC LIMIT 1;
 ELSE
  SELECT a.* INTO selected FROM app_private.synthetic_approved_floor_plans s
   JOIN app_private.synthetic_floor_plan_attachments a ON a.tenant_id=s.tenant_id AND a.operation_id=s.operation_id
   WHERE s.tenant_id=l.tenant_id AND s.listing_id=l.id AND s.revision_no=r.revision_no AND s.approved_version=r.version;
 END IF;
 IF selected.request_id IS NOT NULL THEN plan:=app_private.synthetic_floor_plan_attachment_record(selected);END IF;
 RETURN jsonb_build_object('policy','synthetic-floor-plan-gallery-v1','companyId',l.tenant_id,'actorId',app_private.context_actor(),
  'listingId',l.id,'revision',r.revision_no,'version',r.version::text,'state',r.state,'floorPlan',plan);
END $$;
CREATE FUNCTION app_api.read_synthetic_published_floor_plan(p_listing uuid,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 -- Eligibility is re-evaluated on every read. Public metadata never includes
 -- actor/request/operation/object identifiers, source facts, lease or private address.
 SELECT jsonb_build_object('policy','synthetic-published-floor-plan-v1','listingId',p.listing_id,
  'revision',p.revision_no,'approvedVersion',r.version::text,'floorPlan',
  CASE WHEN a.request_id IS NOT NULL THEN jsonb_build_object(
   'width',a.output_receipt#>'{manifest,width}','height',a.output_receipt#>'{manifest,height}',
   'bytes',a.output_receipt#>'{manifest,bytes}','sha256',a.output_receipt#>'{manifest,sha256}') ELSE 'null'::jsonb END)
 INTO result FROM app_api.public_listings_v2 p JOIN app_private.listing_revisions r
  ON r.tenant_id=p.tenant_id AND r.listing_id=p.listing_id AND r.revision_no=p.revision_no
 LEFT JOIN app_private.synthetic_approved_floor_plans s
  ON s.tenant_id=p.tenant_id AND s.listing_id=p.listing_id AND s.revision_no=p.revision_no AND s.approved_version=r.version
 LEFT JOIN app_private.synthetic_floor_plan_attachments a ON a.tenant_id=s.tenant_id AND a.operation_id=s.operation_id
 WHERE p.tenant_id=app_private.context_tenant() AND p.listing_id=p_listing AND p.revision_no=p_revision;
 IF result IS NULL THEN RAISE EXCEPTION 'Published revision unavailable' USING ERRCODE='P0002';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.capture_synthetic_approved_floor_plan() FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_api.read_synthetic_review_floor_plan(uuid,integer,bigint),
 app_api.read_synthetic_published_floor_plan(uuid,integer) FROM PUBLIC,media_coordinator;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_review_floor_plan(uuid,integer,bigint),
 app_api.read_synthetic_published_floor_plan(uuid,integer) TO api_runtime;
COMMIT;

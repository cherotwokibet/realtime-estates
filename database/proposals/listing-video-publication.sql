-- Isolated, opt-in synthetic extension. Install after listing-video.sql.
-- No backfill: an older approval does not authorize publishing later metadata.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.synthetic_approved_listing_video (
 tenant_id uuid NOT NULL,listing_id uuid NOT NULL,revision_no integer NOT NULL,
 approved_version bigint NOT NULL CHECK(approved_version BETWEEN 1 AND 9007199254740991),
 video jsonb NOT NULL CHECK(app_private.synthetic_listing_video_valid(video)),
 PRIMARY KEY(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no)
);
ALTER TABLE app_private.synthetic_approved_listing_video ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_approved_listing_video FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_approved_listing_video TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_approved_video BEFORE UPDATE OR DELETE ON app_private.synthetic_approved_listing_video
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_approved_listing_video FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.capture_synthetic_approved_video() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected jsonb;
BEGIN
 IF NEW.state='approved' AND OLD.state='pending' THEN
  SELECT command->'video' INTO selected FROM app_private.synthetic_listing_video_operations
   WHERE tenant_id=NEW.tenant_id AND listing_id=NEW.listing_id AND revision_no=NEW.revision_no
    AND result_version<NEW.version ORDER BY result_version DESC LIMIT 1;
  INSERT INTO app_private.synthetic_approved_listing_video(tenant_id,listing_id,revision_no,approved_version,video)
   VALUES(NEW.tenant_id,NEW.listing_id,NEW.revision_no,NEW.version,coalesce(selected,'null'::jsonb));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_synthetic_approved_video AFTER UPDATE OF state ON app_private.listing_revisions
 FOR EACH ROW EXECUTE FUNCTION app_private.capture_synthetic_approved_video();
CREATE FUNCTION app_api.read_synthetic_review_listing_video(p_listing uuid,p_revision integer,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;selected jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision;
 IF NOT FOUND OR r.state<>'pending' OR l.publication_status='archived' THEN RAISE EXCEPTION 'Pending review unavailable' USING ERRCODE='P0002';END IF;
 IF p_expected IS NULL OR p_expected<>r.version THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 SELECT command->'video' INTO selected FROM app_private.synthetic_listing_video_operations
  WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=r.revision_no ORDER BY result_version DESC LIMIT 1;
 RETURN jsonb_build_object('policy','synthetic-listing-video-state-v1','listingId',l.id,'revision',r.revision_no,
  'version',r.version::text,'video',coalesce(selected,'null'::jsonb));
END $$;
CREATE FUNCTION app_api.read_synthetic_published_listing_video(p_listing uuid,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 -- Reuse current public eligibility (active company, publication, availability,
 -- freshness, approved revision and photo minimum). Never read a draft's metadata.
 SELECT jsonb_build_object('policy','synthetic-published-listing-video-v1','listingId',p.listing_id,
  'revision',p.revision_no,'approvedVersion',r.version::text,'video',
  CASE WHEN a.approved_version=r.version THEN a.video ELSE 'null'::jsonb END) INTO result
 FROM app_api.public_listings_v2 p JOIN app_private.listing_revisions r
  ON r.tenant_id=p.tenant_id AND r.listing_id=p.listing_id AND r.revision_no=p.revision_no
 LEFT JOIN app_private.synthetic_approved_listing_video a
  ON a.tenant_id=p.tenant_id AND a.listing_id=p.listing_id AND a.revision_no=p.revision_no
 WHERE p.tenant_id=app_private.context_tenant() AND p.listing_id=p_listing AND p.revision_no=p_revision;
 IF result IS NULL THEN RAISE EXCEPTION 'Published revision unavailable' USING ERRCODE='P0002';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.capture_synthetic_approved_video() FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_api.read_synthetic_review_listing_video(uuid,integer,bigint),
 app_api.read_synthetic_published_listing_video(uuid,integer) FROM PUBLIC,media_coordinator;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_review_listing_video(uuid,integer,bigint),
 app_api.read_synthetic_published_listing_video(uuid,integer) TO api_runtime;
COMMIT;

-- ISOLATED SYNTHETIC MODERATION CANDIDATE. Not a default migration or enabled API.
-- Load after the three reference draft/catalogue/read proposals.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.synthetic_reference_transitions (
 tenant_id uuid NOT NULL, operation_id uuid NOT NULL, actor_id uuid NOT NULL,
 listing_id uuid NOT NULL, revision_no integer NOT NULL,
 action text NOT NULL CHECK(action IN ('submit','withdraw','approve','reject')),
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740990),
 expected_listing_version bigint NOT NULL CHECK(expected_listing_version BETWEEN 1 AND 9007199254740991),
 review jsonb NOT NULL, reason text, receipt jsonb NOT NULL,
 PRIMARY KEY(tenant_id,operation_id), UNIQUE(tenant_id,listing_id,revision_no,expected_version),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no)
);
CREATE TRIGGER immutable_reference_transition BEFORE UPDATE OR DELETE ON app_private.synthetic_reference_transitions
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
ALTER TABLE app_private.synthetic_reference_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_reference_transitions FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_transition_tenant ON app_private.synthetic_reference_transitions TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
REVOKE ALL ON app_private.synthetic_reference_transitions FROM PUBLIC,api_runtime;

CREATE TABLE app_private.synthetic_reference_approved (
 tenant_id uuid NOT NULL,listing_id uuid NOT NULL,revision_no integer NOT NULL,
 reviewed_version bigint NOT NULL,approved_version bigint NOT NULL,
 attributes jsonb NOT NULL,approved_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 CHECK(reviewed_version BETWEEN 1 AND 9007199254740990 AND approved_version=reviewed_version+1)
);
CREATE TRIGGER immutable_reference_approved BEFORE UPDATE OR DELETE ON app_private.synthetic_reference_approved
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
ALTER TABLE app_private.synthetic_reference_approved ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_reference_approved FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_approved_tenant ON app_private.synthetic_reference_approved TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
REVOKE ALL ON app_private.synthetic_reference_approved FROM PUBLIC,api_runtime;

CREATE FUNCTION app_private.synthetic_reference_projection(r app_private.listing_revisions,p_listing_version bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb; original app_private.synthetic_reference_draft_receipts;l app_private.listings;photos jsonb;
BEGIN
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=r.tenant_id AND id=r.listing_id;
 IF NOT FOUND OR r.synthetic_reference_attributes IS NULL THEN RAISE EXCEPTION 'Reference revision unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO original FROM app_private.synthetic_reference_draft_receipts
 WHERE tenant_id=r.tenant_id AND operation_id=r.synthetic_reference_operation AND listing_id=r.listing_id AND revision_no=r.revision_no;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original reference unavailable' USING ERRCODE='23514';END IF;
 c:=jsonb_build_object('title',r.title,'description',r.description,'purpose',r.purpose,'propertyType',r.property_type,
  'currency',r.currency,'amountMinor',r.amount_minor,'rentPeriod',r.rent_period,'bedrooms',r.bedrooms,
  'privateBathrooms',r.private_bathrooms,'sharedBathrooms',r.shared_bathrooms,'country',r.country,'locality',r.locality,
  'publicPrecision',r.public_precision,'latitude',r.latitude,'longitude',r.longitude,'privateAddress',r.private_address,
  'pricing',r.pricing,'location',r.location);
 IF c IS DISTINCT FROM original.content OR r.synthetic_reference_attributes IS DISTINCT FROM original.receipt->'attributes' THEN
  RAISE EXCEPTION 'Original reference facts changed' USING ERRCODE='23514';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'position',m.position,'altText',m.alt_text,
  'accepted',m.accepted,'sha256',m.sha256,'sealed',m.sealed_job_id IS NOT NULL AND m.attach_operation_id IS NOT NULL AND m.sealed_manifest_sha256 IS NOT NULL) ORDER BY m.position),'[]'::jsonb)
 INTO photos FROM app_private.revision_media m WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no;
 RETURN jsonb_build_object('policy','synthetic-reference-revision-v1','listingId',r.listing_id,'revision',r.revision_no,
  'listingVersion',p_listing_version::text,'revisionVersion',r.version::text,'state',r.state,
  'availability',l.availability,'availabilityConfirmedAt',app_private.enquiry_utc(l.last_availability_confirmed_at),
  'publicationStatus',l.publication_status,'publishedRevision',l.published_revision_no,
  'content',c,'attributes',r.synthetic_reference_attributes,'photos',photos);
END $$;

CREATE FUNCTION app_api.read_synthetic_reference_revision(p_id uuid,p_revision integer,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);l:=app_private.lock_listing(p_id);
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=p_id AND revision_no=p_revision;
 IF NOT FOUND OR r.synthetic_reference_attributes IS NULL THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'Explicit version required' USING ERRCODE='23514';END IF;
 IF r.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 IF l.version NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'Listing version bound' USING ERRCODE='40001';END IF;
 RETURN app_private.synthetic_reference_projection(r,l.version);
END $$;
CREATE FUNCTION app_api.read_synthetic_reference_review(p_id uuid,p_revision integer,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);result:=app_api.read_synthetic_reference_revision(p_id,p_revision,p_expected);
 IF result->>'state'<>'pending' THEN RAISE EXCEPTION 'Pending review unavailable' USING ERRCODE='P0002';END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION app_private.guard_synthetic_reference_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE permit app_private.synthetic_reference_transitions;target text;
BEGIN
 IF OLD.synthetic_reference_attributes IS NULL AND NEW.synthetic_reference_attributes IS NULL THEN RETURN NEW;END IF;
 IF NEW.state='draft' AND OLD.state='draft' THEN
  IF OLD.synthetic_reference_attributes IS NOT NULL AND
    (to_jsonb(NEW)-ARRAY['version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','updated_at'])
    AND NEW.synthetic_reference_operation IS NOT DISTINCT FROM OLD.synthetic_reference_operation THEN
   RAISE EXCEPTION 'Reference-aware combined command required' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO permit FROM app_private.synthetic_reference_transitions WHERE tenant_id=OLD.tenant_id
  AND listing_id=OLD.listing_id AND revision_no=OLD.revision_no AND expected_version=OLD.version AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Reference-aware moderation required' USING ERRCODE='23514';END IF;
 target:=CASE permit.action WHEN 'submit' THEN 'pending' WHEN 'withdraw' THEN 'draft' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' END;
 IF (permit.action='submit' AND OLD.state<>'draft') OR (permit.action<>'submit' AND OLD.state<>'pending') OR NEW.state<>target
  OR permit.review IS DISTINCT FROM app_private.synthetic_reference_projection(OLD,permit.expected_listing_version)
  OR (to_jsonb(NEW)-ARRAY['state','version','updated_at','submitted_at','submitted_by','decided_at','decided_by','decision_reason'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updated_at','submitted_at','submitted_by','decided_at','decided_by','decision_reason']) THEN
  RAISE EXCEPTION 'Reference transition facts changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app_api.execute_synthetic_reference_transition(p_id uuid,p_revision integer,p_operation uuid,p_action text,
 p_review jsonb,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;prior app_private.synthetic_reference_transitions;
 snapshot jsonb;expected bigint;result_version bigint;target text;result jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('submit','withdraw','approve','reject') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='23514';END IF;
 PERFORM app_private.assert_staff(CASE WHEN p_action IN ('approve','reject') THEN ARRAY['admin'] ELSE ARRAY['agent','admin'] END);
 l:=app_private.lock_listing(p_id);
 IF p_operation IS NULL OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR p_revision IS NULL OR p_revision<1 OR p_review IS NULL OR jsonb_typeof(p_review)<>'object'
  OR (p_action='reject' AND (p_reason IS NULL OR p_reason<>btrim(p_reason) OR NOT app_private.disclosure_text_valid(to_jsonb(p_reason),2000)))
  OR (p_action<>'reject' AND p_reason IS NOT NULL) THEN RAISE EXCEPTION 'Explicit transition facts required' USING ERRCODE='23514';END IF;
 SELECT * INTO prior FROM app_private.synthetic_reference_transitions WHERE tenant_id=l.tenant_id AND operation_id=p_operation;
 IF FOUND THEN
  IF prior.actor_id<>app_private.context_actor() OR prior.listing_id<>p_id OR prior.revision_no<>p_revision OR prior.action<>p_action
   OR prior.review IS DISTINCT FROM p_review OR prior.reason IS DISTINCT FROM p_reason THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN prior.receipt;
 END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
 IF NOT FOUND OR r.synthetic_reference_attributes IS NULL THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF r.version NOT BETWEEN 1 AND 9007199254740990 OR l.version NOT BETWEEN 1 AND 9007199254740990 THEN RAISE EXCEPTION 'Version bound' USING ERRCODE='40001';END IF;
 snapshot:=app_private.synthetic_reference_projection(r,l.version);
 IF p_review IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Reviewed facts conflict' USING ERRCODE='40001';END IF;
 IF (p_action='submit' AND r.state<>'draft') OR (p_action<>'submit' AND r.state<>'pending') THEN RAISE EXCEPTION 'State conflict' USING ERRCODE='40001';END IF;
 target:=CASE p_action WHEN 'submit' THEN 'pending' WHEN 'withdraw' THEN 'draft' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' END;
 expected:=r.version;
 result:=jsonb_build_object('policy','synthetic-reference-transition-v1','operationId',p_operation,'actorId',app_private.context_actor(),
  'action',p_action,'listingId',p_id,'revision',p_revision,'review',snapshot,'reason',p_reason,
  'revisionVersion',(expected+1)::text,'state',target);
 INSERT INTO app_private.synthetic_reference_transitions VALUES(l.tenant_id,p_operation,app_private.context_actor(),p_id,p_revision,p_action,expected,l.version,snapshot,p_reason,result);
 -- The append-only receipt is the trigger permit. It cannot be forged by runtime SQL or a custom setting.
 IF p_action='submit' THEN result_version:=app_api.submit_revision(p_id,p_revision,expected);
 ELSIF p_action='withdraw' THEN result_version:=app_api.withdraw_revision(p_id,p_revision,expected);
 ELSE result_version:=app_api.decide_revision(p_id,p_revision,expected,p_action='approve',p_reason);END IF;
 IF result_version<>expected+1 THEN RAISE EXCEPTION 'Transition version changed' USING ERRCODE='23514';END IF;
 IF p_action='approve' THEN
  INSERT INTO app_private.synthetic_reference_approved VALUES(l.tenant_id,p_id,p_revision,expected,result_version,
   r.synthetic_reference_attributes,now());
 END IF;
 PERFORM app_private.audit('revision.synthetic_reference_'||p_action,'listing',p_id,result_version,jsonb_build_object('revision',p_revision,'operationId',p_operation));
 RETURN result;
END $$;

CREATE FUNCTION app_api.read_synthetic_reference_transition(p_id uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);PERFORM app_private.lock_listing(p_id);
 SELECT receipt INTO result FROM app_private.synthetic_reference_transitions WHERE tenant_id=app_private.context_tenant()
  AND listing_id=p_id AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN result;
END $$;

CREATE VIEW app_api.public_listings_reference_v3 WITH(security_barrier=true) AS
 SELECT p.*,a.attributes AS reference_attributes,a.approved_version::text AS reference_revision_version
 FROM app_api.public_listings_v2 p JOIN app_private.listing_revisions r
 ON r.tenant_id=p.tenant_id AND r.listing_id=p.listing_id AND r.revision_no=p.revision_no
 LEFT JOIN app_private.synthetic_reference_approved a
 ON a.tenant_id=p.tenant_id AND a.listing_id=p.listing_id AND a.revision_no=p.revision_no
 WHERE r.synthetic_reference_attributes IS NULL OR
  (a.approved_version=r.version AND a.attributes=r.synthetic_reference_attributes);
REVOKE ALL ON FUNCTION app_private.synthetic_reference_projection(app_private.listing_revisions,bigint),
 app_api.read_synthetic_reference_revision(uuid,integer,bigint),app_api.read_synthetic_reference_review(uuid,integer,bigint),
 app_api.execute_synthetic_reference_transition(uuid,integer,uuid,text,jsonb,text),app_api.read_synthetic_reference_transition(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_reference_revision(uuid,integer,bigint),app_api.read_synthetic_reference_review(uuid,integer,bigint),
 app_api.execute_synthetic_reference_transition(uuid,integer,uuid,text,jsonb,text),app_api.read_synthetic_reference_transition(uuid,uuid) TO api_runtime;
GRANT SELECT ON app_api.public_listings_reference_v3 TO api_runtime;
RESET ROLE;
COMMIT;

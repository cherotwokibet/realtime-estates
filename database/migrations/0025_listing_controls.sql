BEGIN;
SET LOCAL ROLE realtor_owner;
-- Guarded controls coexist with legacy versioned controls during client migration.
CREATE TABLE app_private.listing_control_requests (
 tenant_id uuid NOT NULL, operation_id uuid NOT NULL, listing_id uuid NOT NULL, requester_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('confirm_availability','set_publication')),
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),
 target text NOT NULL,
 PRIMARY KEY(tenant_id,operation_id), UNIQUE(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK((kind='confirm_availability' AND target IN ('available','reserved','rented','sold','withdrawn'))
 OR (kind='set_publication' AND target IN ('paused','published','archived')))
);
CREATE TABLE app_private.listing_control_results (
 tenant_id uuid NOT NULL, operation_id uuid NOT NULL, listing_id uuid NOT NULL,
 outcome text NOT NULL, reason text, listing_version bigint,
 completed_at timestamptz NOT NULL CHECK(isfinite(completed_at) AND extract(year FROM completed_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
 PRIMARY KEY(tenant_id,operation_id),
 CHECK((outcome='applied')=(reason IS NULL)),
 FOREIGN KEY(tenant_id,operation_id,listing_id) REFERENCES app_private.listing_control_requests(tenant_id,operation_id,listing_id),
 CHECK((outcome='applied' AND reason IS NULL AND listing_version IS NOT NULL)
 OR (outcome='conflict' AND reason='LISTING_CHANGED' AND listing_version IS NULL)
 OR (outcome='refused' AND reason IN ('VERSION_LIMIT','APPROVED_PUBLICATION_REQUIRED','CONFIRMATION_CLOCK_INVALID') AND listing_version IS NULL))
);
ALTER TABLE app_private.listing_control_requests ADD CONSTRAINT control_must_complete
 FOREIGN KEY(tenant_id,operation_id) REFERENCES app_private.listing_control_results(tenant_id,operation_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.listing_control_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_control_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_control_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_control_results FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.listing_control_requests TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_access ON app_private.listing_control_results TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_control_request BEFORE UPDATE OR DELETE ON app_private.listing_control_requests FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE TRIGGER immutable_control_result BEFORE UPDATE OR DELETE ON app_private.listing_control_results FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE FUNCTION app_private.validate_listing_control_result() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_control_requests;
BEGIN
 SELECT * INTO q FROM app_private.listing_control_requests WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id AND listing_id=NEW.listing_id;
 IF NOT FOUND OR (NEW.outcome='applied' AND (q.expected_version=9007199254740991 OR NEW.listing_version<>q.expected_version+1))
 OR (NEW.reason='VERSION_LIMIT' AND q.expected_version<>9007199254740991)
 OR (NEW.outcome='refused' AND NEW.reason<>'VERSION_LIMIT' AND q.expected_version=9007199254740991)
 OR (NEW.reason='APPROVED_PUBLICATION_REQUIRED' AND NOT(q.kind='set_publication' AND q.target='published'))
 OR (NEW.reason='CONFIRMATION_CLOCK_INVALID' AND NOT(q.kind='confirm_availability' OR q.target='published'))
 THEN RAISE EXCEPTION 'Invalid listing control result' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_control_result BEFORE INSERT ON app_private.listing_control_results FOR EACH ROW EXECUTE FUNCTION app_private.validate_listing_control_result();
CREATE FUNCTION app_api.read_listing_control(p_listing uuid,p_operation uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_control_requests;r app_private.listing_control_results;l app_private.listings;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO q FROM app_private.listing_control_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND listing_id=p_listing AND kind=p_kind AND requester_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=q.tenant_id AND id=q.listing_id;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id)
 OR (q.kind='set_publication' AND q.target<>'paused' AND app_private.staff_role()<>'admin')
 THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM app_private.listing_control_results WHERE tenant_id=q.tenant_id AND operation_id=q.operation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('operationId',q.operation_id::text,'listingId',q.listing_id::text,'actorId',q.requester_id::text,'kind',q.kind,
 'request',jsonb_build_object('expectedListingVersion',q.expected_version::text)||CASE WHEN q.kind='confirm_availability' THEN jsonb_build_object('availability',q.target) ELSE jsonb_build_object('publicationStatus',q.target) END,
 'decision',jsonb_build_object('outcome',r.outcome,'reason',r.reason,'result',CASE WHEN r.outcome='applied' THEN jsonb_build_object('listingVersion',r.listing_version::text) END),
 'completedAt',to_char(r.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;
CREATE FUNCTION app_api.control_listing(p_listing uuid,p_operation uuid,p_kind text,p_expected bigint,p_target text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;q app_private.listing_control_requests;original jsonb;
 outcome text:='applied';reason text;v bigint;operation_time timestamptz;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF p_listing IS NULL OR p_operation IS NULL
 OR p_listing::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991 OR p_kind IS NULL OR p_target IS NULL
 OR NOT((p_kind='confirm_availability' AND p_target IN ('available','reserved','rented','sold','withdrawn')) OR (p_kind='set_publication' AND p_target IN ('paused','published','archived')))
 THEN RAISE EXCEPTION 'Invalid listing control' USING ERRCODE='23514'; END IF;
 -- Consistent listing-first locking also protects current assignment during replay.
 l:=app_private.lock_listing(p_listing);
 SELECT * INTO q FROM app_private.listing_control_requests WHERE tenant_id=l.tenant_id AND operation_id=p_operation;
 IF FOUND THEN
  original:=app_api.read_listing_control(p_listing,p_operation,p_kind);
  IF q.expected_version IS DISTINCT FROM p_expected OR q.target IS DISTINCT FROM p_target THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
  RETURN original;
 END IF;
 IF p_kind='set_publication' AND app_private.staff_role()<>'admin' AND (p_target<>'paused' OR l.publication_status='archived')
 THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 INSERT INTO app_private.listing_control_requests VALUES(l.tenant_id,p_operation,p_listing,app_private.context_actor(),p_kind,p_expected,p_target) ON CONFLICT(tenant_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO q FROM app_private.listing_control_requests WHERE tenant_id=l.tenant_id AND operation_id=p_operation;
  original:=app_api.read_listing_control(p_listing,p_operation,p_kind);
  IF q.expected_version IS DISTINCT FROM p_expected OR q.target IS DISTINCT FROM p_target THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001'; END IF;
  RETURN original;
 END IF;
 operation_time:=clock_timestamp();
 IF l.version<>p_expected THEN outcome:='conflict';reason:='LISTING_CHANGED';
 ELSIF l.version=9007199254740991 THEN outcome:='refused';reason:='VERSION_LIMIT';
 ELSIF (p_kind='confirm_availability' OR p_target='published') AND l.last_availability_confirmed_at>operation_time
 THEN outcome:='refused';reason:='CONFIRMATION_CLOCK_INVALID';
 ELSIF p_kind='set_publication' AND p_target='published' AND (l.published_revision_no IS NULL OR l.availability<>'available'
 OR l.last_availability_confirmed_at IS NULL OR l.last_availability_confirmed_at<=operation_time-interval '720 hours'
 OR NOT EXISTS(SELECT 1 FROM app_private.public_snapshots s JOIN app_private.listing_revisions r ON r.tenant_id=s.tenant_id AND r.listing_id=s.listing_id AND r.revision_no=s.revision_no
 WHERE s.tenant_id=l.tenant_id AND s.listing_id=l.id AND s.revision_no=l.published_revision_no AND r.state='approved'))
 THEN outcome:='refused';reason:='APPROVED_PUBLICATION_REQUIRED';
 ELSE
  IF p_kind='confirm_availability' THEN
   UPDATE app_private.listings SET availability=p_target,last_availability_confirmed_at=operation_time,
   publication_status=CASE WHEN p_target<>'available' AND publication_status='published' THEN 'paused' ELSE publication_status END
   WHERE tenant_id=l.tenant_id AND id=l.id RETURNING version INTO v;
   PERFORM app_private.audit('listing.availability_confirmed','listing',l.id,v,jsonb_build_object('availability',p_target,'operationId',p_operation));
  ELSE
   UPDATE app_private.listings SET publication_status=p_target,archived_at=CASE WHEN p_target='archived' THEN operation_time END
   WHERE tenant_id=l.tenant_id AND id=l.id RETURNING version INTO v;
   PERFORM app_private.audit('listing.publication_changed','listing',l.id,v,jsonb_build_object('status',p_target,'operationId',p_operation));
  END IF;
  IF v<>p_expected+1 THEN RAISE EXCEPTION 'Unexpected listing version' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO app_private.listing_control_results VALUES(l.tenant_id,p_operation,p_listing,outcome,reason,v,clock_timestamp());
 RETURN app_api.read_listing_control(p_listing,p_operation,p_kind);
END $$;
REVOKE ALL ON FUNCTION app_private.validate_listing_control_result(),app_api.read_listing_control(uuid,uuid,text),app_api.control_listing(uuid,uuid,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_control(uuid,uuid,text),app_api.control_listing(uuid,uuid,text,bigint,text) TO api_runtime;
COMMIT;

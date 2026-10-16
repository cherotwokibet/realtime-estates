BEGIN;
SET LOCAL ROLE realtor_owner;
-- Independently recoverable successor allocation. Legacy zero-version allocation remains compatibility-only.
CREATE TABLE app_private.listing_successor_requests(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,listing_id uuid NOT NULL,requester_id uuid NOT NULL,
 expected_listing_version bigint NOT NULL CHECK(expected_listing_version BETWEEN 1 AND 9007199254740991),
 predecessor_revision integer NOT NULL CHECK(predecessor_revision>0),
 predecessor_version bigint NOT NULL CHECK(predecessor_version BETWEEN 1 AND 9007199254740991),
 predecessor_state text NOT NULL CHECK(predecessor_state IN ('approved','rejected')),
 content jsonb NOT NULL CHECK(app_private.creation_content_valid(content)),
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE TABLE app_private.listing_successor_results(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,listing_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('applied','conflict','refused')),reason text,
 allocated_revision integer,initial_listing_version bigint,
 completed_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(completed_at)),
 PRIMARY KEY(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,operation_id,listing_id) REFERENCES app_private.listing_successor_requests(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,listing_id,allocated_revision) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 CHECK((outcome='applied')=(reason IS NULL)),
 CHECK((outcome='applied' AND reason IS NULL AND allocated_revision IS NOT NULL AND initial_listing_version IS NOT NULL)
  OR (outcome='conflict' AND reason='PREDECESSOR_CHANGED' AND allocated_revision IS NULL AND initial_listing_version IS NULL)
  OR (outcome='refused' AND reason IN ('VERSION_LIMIT','REVISION_LIMIT') AND allocated_revision IS NULL AND initial_listing_version IS NULL))
);
ALTER TABLE app_private.listing_successor_requests ADD CONSTRAINT successor_must_complete
 FOREIGN KEY(tenant_id,operation_id) REFERENCES app_private.listing_successor_results(tenant_id,operation_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.listing_successor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_successor_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_successor_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_successor_results FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.listing_successor_requests TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_access ON app_private.listing_successor_results TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_successor_request BEFORE UPDATE OR DELETE ON app_private.listing_successor_requests FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE TRIGGER immutable_successor_result BEFORE UPDATE OR DELETE ON app_private.listing_successor_results FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE FUNCTION app_private.validate_successor_result() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_successor_requests;
BEGIN
 SELECT * INTO q FROM app_private.listing_successor_requests WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id AND listing_id=NEW.listing_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid successor result' USING ERRCODE='23514';END IF;
 IF NEW.outcome='applied' AND (q.expected_listing_version=9007199254740991 OR q.predecessor_revision=2147483647 OR NEW.initial_listing_version<>q.expected_listing_version+1 OR NEW.allocated_revision::bigint<>q.predecessor_revision::bigint+1)
  OR NEW.reason='VERSION_LIMIT' AND q.expected_listing_version<>9007199254740991
  OR NEW.reason='REVISION_LIMIT' AND (q.predecessor_revision<>2147483647 OR q.expected_listing_version=9007199254740991)
 THEN RAISE EXCEPTION 'Invalid successor result' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_successor_result BEFORE INSERT ON app_private.listing_successor_results FOR EACH ROW EXECUTE FUNCTION app_private.validate_successor_result();
CREATE FUNCTION app_api.read_listing_successor(p_listing uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_successor_requests;r app_private.listing_successor_results;l app_private.listings;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO q FROM app_private.listing_successor_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND listing_id=p_listing AND requester_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=q.tenant_id AND id=q.listing_id;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.listing_successor_results WHERE tenant_id=q.tenant_id AND operation_id=q.operation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('operationId',q.operation_id::text,'listingId',q.listing_id::text,'actorId',q.requester_id::text,'kind','start_revision',
 'request',jsonb_build_object('expectedListingVersion',q.expected_listing_version::text,'predecessor',jsonb_build_object('revision',q.predecessor_revision,'version',q.predecessor_version::text,'state',q.predecessor_state),'content',q.content),
 'decision',jsonb_build_object('outcome',r.outcome,'reason',r.reason,'result',CASE WHEN r.outcome='applied' THEN jsonb_build_object('listingVersion',r.initial_listing_version::text,'revision',r.allocated_revision,'revisionVersion','2') END),
 'completedAt',app_private.enquiry_utc(r.completed_at));
END $$;
CREATE FUNCTION app_api.start_listing_revision_v2(p_listing uuid,p_operation uuid,p_listing_version bigint,p_predecessor integer,p_predecessor_version bigint,p_predecessor_state text,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_successor_requests;l app_private.listings;r app_private.listing_revisions;original jsonb;
 outcome text:='applied';reason text;allocated integer;listing_version bigint;revision_version bigint;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF p_listing IS NULL OR p_operation IS NULL OR p_listing::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_listing_version IS NULL OR p_listing_version NOT BETWEEN 1 AND 9007199254740991 OR p_predecessor IS NULL OR p_predecessor<1 OR p_predecessor_version IS NULL OR p_predecessor_version NOT BETWEEN 1 AND 9007199254740991 OR p_predecessor_state IS NULL OR p_predecessor_state NOT IN ('approved','rejected') OR NOT app_private.creation_content_valid(p_content)
 THEN RAISE EXCEPTION 'Invalid successor facts' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 INSERT INTO app_private.listing_successor_requests VALUES(l.tenant_id,p_operation,p_listing,app_private.context_actor(),p_listing_version,p_predecessor,p_predecessor_version,p_predecessor_state,p_content) ON CONFLICT(tenant_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO q FROM app_private.listing_successor_requests WHERE tenant_id=l.tenant_id AND operation_id=p_operation FOR UPDATE;
  original:=app_api.read_listing_successor(p_listing,p_operation);
  IF q.expected_listing_version IS DISTINCT FROM p_listing_version OR q.predecessor_revision IS DISTINCT FROM p_predecessor OR q.predecessor_version IS DISTINCT FROM p_predecessor_version OR q.predecessor_state IS DISTINCT FROM p_predecessor_state OR q.content IS DISTINCT FROM p_content
  THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN original;
 END IF;
 l:=app_private.lock_listing(p_listing);
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id ORDER BY revision_no DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR l.version<>p_listing_version OR r.revision_no<>p_predecessor OR r.version<>p_predecessor_version OR r.state<>p_predecessor_state THEN outcome:='conflict';reason:='PREDECESSOR_CHANGED';
 ELSIF l.version=9007199254740991 THEN outcome:='refused';reason:='VERSION_LIMIT';
 ELSIF r.revision_no=2147483647 THEN outcome:='refused';reason:='REVISION_LIMIT';
 ELSE
  allocated:=p_predecessor+1;
  revision_version:=app_api.save_draft_v2(p_listing,allocated,0,p_content);
  IF revision_version<>2 THEN RAISE EXCEPTION 'Unexpected initial revision' USING ERRCODE='23514';END IF;
  UPDATE app_private.listings SET updated_at=now() WHERE tenant_id=l.tenant_id AND id=l.id RETURNING version INTO listing_version;
  IF listing_version<>p_listing_version+1 THEN RAISE EXCEPTION 'Unexpected listing version' USING ERRCODE='23514';END IF;
  PERFORM app_private.audit('revision.started','listing',p_listing,listing_version,jsonb_build_object('predecessor',p_predecessor,'revision',allocated,'contract','v2'));
 END IF;
 INSERT INTO app_private.listing_successor_results VALUES(l.tenant_id,p_operation,p_listing,outcome,reason,allocated,listing_version,clock_timestamp());
 RETURN app_api.read_listing_successor(p_listing,p_operation);
END $$;
REVOKE ALL ON FUNCTION app_private.validate_successor_result(),app_api.read_listing_successor(uuid,uuid),app_api.start_listing_revision_v2(uuid,uuid,bigint,integer,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_successor(uuid,uuid),app_api.start_listing_revision_v2(uuid,uuid,bigint,integer,bigint,text,jsonb) TO api_runtime;
COMMIT;

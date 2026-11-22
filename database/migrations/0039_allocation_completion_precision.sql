-- Forward correction: real PostgreSQL clock_timestamp has microseconds, while allocation
-- result contracts require canonical milliseconds. Preserve guards, grants and CHECK constraints.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE OR REPLACE FUNCTION app_api.create_listing_draft_v2(p_listing uuid,p_operation uuid,p_slug text,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_creation_requests;original jsonb;v bigint;outcome text:='created';constraint_name text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF p_listing IS NULL OR p_operation IS NULL OR p_listing::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_slug IS NULL OR char_length(p_slug) NOT BETWEEN 1 AND 160 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR NOT app_private.creation_content_valid(p_content) THEN RAISE EXCEPTION 'Invalid creation facts' USING ERRCODE='23514';END IF;
 INSERT INTO app_private.listing_creation_requests VALUES(app_private.context_tenant(),p_operation,p_listing,app_private.context_actor(),p_slug,p_content) ON CONFLICT(tenant_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO q FROM app_private.listing_creation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation FOR UPDATE;
  original:=app_api.read_listing_creation(p_listing,p_operation);
  IF q.slug IS DISTINCT FROM p_slug OR q.content IS DISTINCT FROM p_content THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN original;
 END IF;
 BEGIN
  PERFORM app_api.create_listing(p_listing,p_slug);
  v:=app_private.save_draft_internal_v2(p_listing,1,0,p_content);
  IF v<>2 THEN RAISE EXCEPTION 'Unexpected initial version' USING ERRCODE='23514';END IF;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
  IF constraint_name NOT IN ('listings_pkey','listings_tenant_id_slug_key') THEN RAISE;END IF;
  outcome:='refused';
 END;
 INSERT INTO app_private.listing_creation_results VALUES(app_private.context_tenant(),p_operation,p_listing,outcome,CASE WHEN outcome='created' THEN p_listing END,CASE WHEN outcome='created' THEN 1 END,date_trunc('milliseconds',clock_timestamp()));
 RETURN app_api.read_listing_creation(p_listing,p_operation);
END $$;

CREATE OR REPLACE FUNCTION app_api.start_listing_revision_v2(p_listing uuid,p_operation uuid,p_listing_version bigint,p_predecessor integer,p_predecessor_version bigint,p_predecessor_state text,p_content jsonb) RETURNS jsonb
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
  revision_version:=app_private.save_draft_internal_v2(p_listing,allocated,0,p_content);
  IF revision_version<>2 THEN RAISE EXCEPTION 'Unexpected initial revision' USING ERRCODE='23514';END IF;
  UPDATE app_private.listings SET updated_at=now() WHERE tenant_id=l.tenant_id AND id=l.id RETURNING version INTO listing_version;
  IF listing_version<>p_listing_version+1 THEN RAISE EXCEPTION 'Unexpected listing version' USING ERRCODE='23514';END IF;
  PERFORM app_private.audit('revision.started','listing',p_listing,listing_version,jsonb_build_object('predecessor',p_predecessor,'revision',allocated,'contract','v2'));
 END IF;
 INSERT INTO app_private.listing_successor_results VALUES(l.tenant_id,p_operation,p_listing,outcome,reason,allocated,listing_version,date_trunc('milliseconds',clock_timestamp()));
 RETURN app_api.read_listing_successor(p_listing,p_operation);
END $$;

COMMIT;

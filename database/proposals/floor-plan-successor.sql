-- Isolated SQL candidate. Install after floor-plan attachment/publication and guarded successors.
-- Not a default migration and not yet installed in the native preview.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.synthetic_floor_plan_inheritance (
 tenant_id uuid NOT NULL, listing_id uuid NOT NULL, revision_no integer NOT NULL,
 successor_operation_id uuid NOT NULL, predecessor_revision integer NOT NULL,
 predecessor_version bigint NOT NULL CHECK(predecessor_version BETWEEN 1 AND 9007199254740991),
 source_operation_id uuid,
 PRIMARY KEY(tenant_id,listing_id,revision_no), UNIQUE(tenant_id,successor_operation_id),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,successor_operation_id,listing_id) REFERENCES app_private.listing_successor_requests(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,source_operation_id) REFERENCES app_private.synthetic_floor_plan_attachments(tenant_id,operation_id),
 CHECK(predecessor_revision>0 AND revision_no=predecessor_revision+1)
);
ALTER TABLE app_private.synthetic_floor_plan_inheritance ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_floor_plan_inheritance FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_floor_plan_inheritance TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_floor_plan_inheritance BEFORE UPDATE OR DELETE ON app_private.synthetic_floor_plan_inheritance
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_floor_plan_inheritance FROM PUBLIC,api_runtime,media_coordinator;

-- Select a local decision first, including explicit null. Otherwise use the frozen
-- mapping, never a dynamic walk through historical revisions or a fabricated attachment.
CREATE FUNCTION app_private.selected_synthetic_floor_plan(p_tenant uuid,p_listing uuid,p_revision integer)
RETURNS app_private.synthetic_floor_plan_attachments
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen app_private.synthetic_floor_plan_attachments; inherited uuid;
BEGIN
 IF p_tenant IS DISTINCT FROM app_private.context_tenant()
 THEN RAISE EXCEPTION 'Context mismatch' USING ERRCODE='42501';END IF;
 SELECT * INTO chosen FROM app_private.synthetic_floor_plan_attachments
  WHERE tenant_id=p_tenant AND listing_id=p_listing AND revision_no=p_revision
  ORDER BY result_version DESC LIMIT 1;
 IF FOUND THEN RETURN chosen;END IF;
 SELECT source_operation_id INTO inherited FROM app_private.synthetic_floor_plan_inheritance
  WHERE tenant_id=p_tenant AND listing_id=p_listing AND revision_no=p_revision;
 IF inherited IS NOT NULL THEN
  SELECT * INTO chosen FROM app_private.synthetic_floor_plan_attachments
   WHERE tenant_id=p_tenant AND listing_id=p_listing AND operation_id=inherited
    AND revision_no<p_revision AND request_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid inherited source' USING ERRCODE='23514';END IF;
 END IF;
 RETURN chosen;
END $$;

CREATE FUNCTION app_private.capture_synthetic_floor_plan_inheritance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_successor_requests; r app_private.listing_revisions;
 chosen app_private.synthetic_floor_plan_attachments;
BEGIN
 IF NEW.outcome<>'applied' THEN RETURN NEW;END IF;
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO q FROM app_private.listing_successor_requests
  WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id AND listing_id=NEW.listing_id;
 IF NOT FOUND OR q.tenant_id IS DISTINCT FROM app_private.context_tenant()
  OR q.requester_id IS DISTINCT FROM app_private.context_actor()
  OR NEW.allocated_revision<>q.predecessor_revision+1
 THEN RAISE EXCEPTION 'Invalid successor source context' USING ERRCODE='23514';END IF;
 -- The guarded allocator holds the listing lock. Exact predecessor facts remain authoritative.
 SELECT * INTO r FROM app_private.listing_revisions
  WHERE tenant_id=q.tenant_id AND listing_id=q.listing_id AND revision_no=q.predecessor_revision;
 IF NOT FOUND OR r.version<>q.predecessor_version OR r.state<>q.predecessor_state
 THEN RAISE EXCEPTION 'Predecessor changed' USING ERRCODE='40001';END IF;
 chosen:=app_private.selected_synthetic_floor_plan(q.tenant_id,q.listing_id,q.predecessor_revision);
 INSERT INTO app_private.synthetic_floor_plan_inheritance VALUES(q.tenant_id,q.listing_id,NEW.allocated_revision,
  q.operation_id,q.predecessor_revision,q.predecessor_version,
  CASE WHEN chosen.request_id IS NOT NULL THEN chosen.operation_id ELSE NULL END);
 RETURN NEW;
END $$;
CREATE TRIGGER capture_synthetic_floor_plan_inheritance AFTER INSERT ON app_private.listing_successor_results
 FOR EACH ROW EXECUTE FUNCTION app_private.capture_synthetic_floor_plan_inheritance();

-- Freeze the selected original source when an inherited revision is approved.
-- Existing public metadata remains identifier-free; inherited byte delivery still
-- requires an explicit source-aware reader and is not enabled by this candidate.
CREATE OR REPLACE FUNCTION app_private.capture_synthetic_approved_floor_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen app_private.synthetic_floor_plan_attachments;
BEGIN
 IF NEW.state='approved' AND OLD.state='pending' THEN
  chosen:=app_private.selected_synthetic_floor_plan(NEW.tenant_id,NEW.listing_id,NEW.revision_no);
  INSERT INTO app_private.synthetic_approved_floor_plans(tenant_id,listing_id,revision_no,approved_version,operation_id)
   VALUES(NEW.tenant_id,NEW.listing_id,NEW.revision_no,NEW.version,
    CASE WHEN chosen.request_id IS NOT NULL THEN chosen.operation_id ELSE NULL END);
 END IF;
 RETURN NEW;
END $$;

-- New explicit source envelope. Existing v1 galleries/delivery remain unchanged
-- until they implement and validate this inherited-source contract.
CREATE FUNCTION app_api.read_synthetic_floor_plan_selection(p_listing uuid,p_revision integer,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings; r app_private.listing_revisions; chosen app_private.synthetic_floor_plan_attachments;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) OR l.publication_status='archived'
 THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF p_expected IS NULL OR p_expected<>r.version THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 chosen:=app_private.selected_synthetic_floor_plan(l.tenant_id,l.id,p_revision);
 RETURN jsonb_build_object('policy','synthetic-floor-plan-selection-v1','companyId',l.tenant_id,
  'actorId',app_private.context_actor(),'listingId',l.id,'revision',r.revision_no,'version',r.version::text,'state',r.state,
  'source',CASE WHEN chosen.request_id IS NOT NULL THEN app_private.synthetic_floor_plan_attachment_record(chosen) ELSE 'null'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION app_private.selected_synthetic_floor_plan(uuid,uuid,integer),
 app_private.capture_synthetic_floor_plan_inheritance() FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_api.read_synthetic_floor_plan_selection(uuid,integer,bigint) FROM PUBLIC,media_coordinator;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_floor_plan_selection(uuid,integer,bigint) TO api_runtime;
COMMIT;

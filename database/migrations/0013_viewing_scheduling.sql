BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE FUNCTION app_private.viewing_slot_valid(p_slot jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v_start timestamptz;v_end timestamptz;
BEGIN
 IF p_slot IS NULL OR jsonb_typeof(p_slot)<>'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_slot))<>3 OR NOT p_slot ?& ARRAY['startAt','endAt','timeZone']
  OR jsonb_typeof(p_slot->'startAt')<>'string' OR jsonb_typeof(p_slot->'endAt')<>'string'
  OR (p_slot->>'timeZone') IS DISTINCT FROM 'Africa/Nairobi' THEN RETURN false;END IF;
 IF p_slot->>'startAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  OR p_slot->>'endAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RETURN false;END IF;
 v_start:=(p_slot->>'startAt')::timestamptz;v_end:=(p_slot->>'endAt')::timestamptz;
 RETURN app_private.enquiry_time_valid(v_start) AND app_private.enquiry_time_valid(v_end)
  AND app_private.enquiry_utc(v_start)=p_slot->>'startAt' AND app_private.enquiry_utc(v_end)=p_slot->>'endAt'
  AND v_end-v_start BETWEEN interval '15 minutes' AND interval '4 hours';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
CREATE FUNCTION app_private.viewing_preferences_valid(p_slots jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v_slot jsonb;v_other jsonb;v_seen jsonb:='[]'::jsonb;
BEGIN
 IF p_slots IS NULL OR jsonb_typeof(p_slots)<>'array' THEN RETURN false;END IF;
 IF jsonb_array_length(p_slots)>3 THEN RETURN false;END IF;
 FOR v_slot IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
  IF NOT app_private.viewing_slot_valid(v_slot) THEN RETURN false;END IF;
  FOR v_other IN SELECT value FROM jsonb_array_elements(v_seen) LOOP
   IF v_slot->>'startAt'<v_other->>'endAt' AND v_other->>'startAt'<v_slot->>'endAt' THEN RETURN false;END IF;
  END LOOP;
  v_seen:=v_seen||jsonb_build_array(v_slot);
 END LOOP;RETURN true;
END $$;
CREATE TABLE app_private.viewings (
 tenant_id uuid NOT NULL,id uuid NOT NULL,enquiry_id uuid NOT NULL,listing_id uuid NOT NULL,requested_by_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('requested','proposed')),version bigint NOT NULL,
 preferred_slots jsonb NOT NULL CHECK(app_private.viewing_preferences_valid(preferred_slots)),
 notes text NOT NULL CHECK(app_private.contact_notes_valid(notes)),proposed_slot jsonb,
 created_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(created_at)),
 updated_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(updated_at) AND updated_at>=created_at),
 CHECK((status='requested' AND version=1 AND proposed_slot IS NULL) OR (status='proposed' AND version=2 AND proposed_slot IS NOT NULL AND app_private.viewing_slot_valid(proposed_slot))),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,enquiry_id,id),
 FOREIGN KEY(tenant_id,enquiry_id) REFERENCES app_private.enquiries(tenant_id,id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),
 FOREIGN KEY(tenant_id,requested_by_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE INDEX viewing_enquiry_lookup ON app_private.viewings(tenant_id,enquiry_id,created_at DESC,id);
CREATE FUNCTION app_private.guard_viewing_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_listing uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Viewing history is immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'requested' OR NEW.version<>1) THEN RAISE EXCEPTION 'Viewing must begin as requested' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','version','proposed_slot','updated_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','version','proposed_slot','updated_at']) OR OLD.status<>'requested' OR NEW.status<>'proposed'
  OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Invalid viewing mutation' USING ERRCODE='23514';END IF;
 SELECT listing_id INTO v_listing FROM app_private.enquiries WHERE tenant_id=NEW.tenant_id AND id=NEW.enquiry_id;
 IF v_listing IS NOT NULL AND v_listing<>NEW.listing_id THEN RAISE EXCEPTION 'Viewing listing mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_viewing BEFORE INSERT OR UPDATE OR DELETE ON app_private.viewings FOR EACH ROW EXECUTE FUNCTION app_private.guard_viewing_update();
CREATE TABLE app_private.viewing_operations (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,enquiry_id uuid NOT NULL,requester_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('request','propose')),target_viewing_id uuid,viewing_id uuid,
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),
 request_payload jsonb NOT NULL CHECK(jsonb_typeof(request_payload)='object'),receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(created_at)),
 CHECK((kind='request' AND target_viewing_id IS NULL) OR (kind='propose' AND target_viewing_id IS NOT NULL AND viewing_id IS NOT NULL AND viewing_id=target_viewing_id)),
 PRIMARY KEY(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,enquiry_id) REFERENCES app_private.enquiries(tenant_id,id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,enquiry_id,target_viewing_id) REFERENCES app_private.viewings(tenant_id,enquiry_id,id),
 FOREIGN KEY(tenant_id,enquiry_id,viewing_id) REFERENCES app_private.viewings(tenant_id,enquiry_id,id)
);
CREATE TRIGGER immutable_viewing_operation BEFORE UPDATE OR DELETE ON app_private.viewing_operations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
ALTER TABLE app_private.viewings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.viewings FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.viewings TO realtor_owner USING(true) WITH CHECK(true);
ALTER TABLE app_private.viewing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.viewing_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.viewing_operations TO realtor_owner USING(true) WITH CHECK(true);
CREATE FUNCTION app_private.viewing_snapshot(p_viewing app_private.viewings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('viewingId',p_viewing.id,'enquiryId',p_viewing.enquiry_id,'listingId',p_viewing.listing_id,
  'version',p_viewing.version::text,'status',p_viewing.status,'preferredSlots',p_viewing.preferred_slots,'proposedSlot',p_viewing.proposed_slot)
$$;
CREATE FUNCTION app_private.viewing_detail(p_viewing app_private.viewings,p_assigned uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schedule',app_private.viewing_snapshot(p_viewing),'notes',p_viewing.notes,'requestedById',p_viewing.requested_by_id,
  'assignedAgentId',p_assigned,'createdAt',app_private.enquiry_utc(p_viewing.created_at),'updatedAt',app_private.enquiry_utc(p_viewing.updated_at))
$$;
CREATE FUNCTION app_api.execute_viewing_operation(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,p_kind text,
 p_listing uuid,p_preferences jsonb,p_notes text,p_slot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
 v_enquiry app_private.enquiries;v_viewing app_private.viewings;v_listing app_private.listings;v_original app_private.viewing_operations;
 v_payload jsonb;v_receipt jsonb;v_result jsonb;v_now timestamptz;v_observed bigint;v_id uuid;
 v_outcome text:='applied';v_reason text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991
  OR p_kind IS NULL OR p_kind NOT IN ('request','propose') THEN RAISE EXCEPTION 'Invalid viewing command' USING ERRCODE='23514';END IF;
 IF p_kind='request' THEN
  IF p_viewing IS NOT NULL OR p_listing IS NULL OR p_slot IS NOT NULL OR NOT app_private.viewing_preferences_valid(p_preferences)
   OR NOT app_private.contact_notes_valid(p_notes) THEN RAISE EXCEPTION 'Invalid viewing request' USING ERRCODE='23514';END IF;
  v_payload:=jsonb_build_object('listingId',p_listing,'preferredSlots',p_preferences,'notes',p_notes);
 ELSE
  IF p_viewing IS NULL OR p_listing IS NOT NULL OR p_preferences IS NOT NULL OR p_notes IS NOT NULL
   OR p_expected>9007199254740990 OR NOT app_private.viewing_slot_valid(p_slot) THEN RAISE EXCEPTION 'Invalid viewing proposal' USING ERRCODE='23514';END IF;
  v_payload:=jsonb_build_object('slot',p_slot);
 END IF;
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF p_kind='propose' THEN
  SELECT * INTO v_viewing FROM app_private.viewings WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND id=p_viewing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text||'/viewing/'||p_operation::text,0));
 SELECT * INTO v_original FROM app_private.viewing_operations WHERE tenant_id=v_tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF v_original.enquiry_id<>p_enquiry OR v_original.requester_id<>v_actor OR v_original.kind<>p_kind
   OR v_original.target_viewing_id IS DISTINCT FROM p_viewing OR v_original.expected_version<>p_expected
   OR v_original.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN v_original.receipt;
 END IF;
 SELECT * INTO v_listing FROM app_private.listings WHERE tenant_id=v_tenant AND id=CASE WHEN p_kind='request' THEN p_listing ELSE v_viewing.listing_id END FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 v_now:=date_trunc('milliseconds',clock_timestamp());v_observed:=CASE WHEN p_kind='request' THEN v_enquiry.version ELSE v_viewing.version END;
 v_id:=CASE WHEN p_kind='propose' THEN p_viewing ELSE NULL END;
 IF p_expected<>v_observed THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
 ELSIF v_enquiry.status NOT IN ('new','assigned','contacted','qualified') THEN v_outcome:='refused';v_reason:='ENQUIRY_CLOSED';
 ELSIF v_enquiry.listing_id IS NOT NULL AND v_enquiry.listing_id<>v_listing.id THEN v_outcome:='refused';v_reason:='LISTING_MISMATCH';
 ELSIF v_listing.publication_status<>'published' OR v_listing.availability<>'available' OR v_listing.archived_at IS NOT NULL
  OR v_listing.last_availability_confirmed_at IS NULL OR v_listing.last_availability_confirmed_at<=v_now-interval '30 days'
  OR NOT EXISTS(SELECT 1 FROM app_private.public_snapshots WHERE tenant_id=v_tenant AND listing_id=v_listing.id AND revision_no=v_listing.published_revision_no)
  THEN v_outcome:='refused';v_reason:='LISTING_UNAVAILABLE';
 ELSIF p_kind='propose' AND v_viewing.status<>'requested' THEN v_outcome:='refused';v_reason:='INVALID_STATE';
 ELSIF (p_kind='request' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_preferences) x WHERE (x.value->>'startAt')::timestamptz<=v_now))
  OR (p_kind='propose' AND (p_slot->>'startAt')::timestamptz<=v_now) THEN v_outcome:='refused';v_reason:='SLOT_NOT_FUTURE';
 ELSE
  IF p_kind='request' THEN
   v_id:=gen_random_uuid();
   INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at)
    VALUES(v_tenant,v_id,p_enquiry,p_listing,v_actor,'requested',1,p_preferences,p_notes,v_now,v_now) RETURNING * INTO v_viewing;
  ELSE
   UPDATE app_private.viewings SET status='proposed',version=version+1,proposed_slot=p_slot,updated_at=v_now
    WHERE tenant_id=v_tenant AND id=p_viewing RETURNING * INTO v_viewing;
  END IF;
  v_result:=app_private.viewing_snapshot(v_viewing);
  PERFORM app_private.audit('viewing.'||p_kind,'viewing',v_id,v_viewing.version,jsonb_build_object('operationId',p_operation,'kind',p_kind));
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',v_id,'actorId',v_actor,'kind',p_kind,
  'expectedVersion',p_expected::text,'observedVersion',v_observed::text,'request',v_payload,'outcome',v_outcome,'reason',v_reason,'result',v_result,'completedAt',app_private.enquiry_utc(v_now));
 INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at)
  VALUES(v_tenant,p_operation,p_enquiry,v_actor,p_kind,p_viewing,v_id,p_expected,v_payload,v_receipt,v_now);
 RETURN v_receipt;
END $$;
CREATE FUNCTION app_api.read_viewing_operation(p_enquiry uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_enquiry app_private.enquiries;v_receipt jsonb;v_tenant uuid:=app_private.context_tenant();
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT receipt INTO v_receipt FROM app_private.viewing_operations WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND operation_id=p_operation AND requester_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;RETURN v_receipt;
END $$;
CREATE FUNCTION app_api.read_viewing(p_enquiry uuid,p_viewing uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_enquiry app_private.enquiries;v_viewing app_private.viewings;v_tenant uuid:=app_private.context_tenant();
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v_viewing FROM app_private.viewings WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND id=p_viewing;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN app_private.viewing_detail(v_viewing,v_enquiry.assigned_agent_id);
END $$;
CREATE FUNCTION app_api.list_enquiry_viewings(p_enquiry uuid,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_enquiry app_private.enquiries;v_tenant uuid:=app_private.context_tenant();v_items jsonb;v_count integer;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid viewing limit' USING ERRCODE='23514';END IF;
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC,id) FILTER(WHERE position<=p_limit),'[]'::jsonb),count(*) INTO v_items,v_count FROM (
  SELECT app_private.viewing_detail(viewing,v_enquiry.assigned_agent_id) item,created_at,id,row_number() OVER(ORDER BY created_at DESC,id) position
  FROM (SELECT v AS viewing,v.created_at,v.id FROM app_private.viewings v WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry ORDER BY created_at DESC,id LIMIT p_limit+1) bounded
 ) numbered;
 RETURN jsonb_build_object('items',v_items,'limit',p_limit,'truncated',v_count>p_limit);
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_slot_valid(jsonb),app_private.viewing_preferences_valid(jsonb),app_private.guard_viewing_update(),app_private.viewing_snapshot(app_private.viewings),app_private.viewing_detail(app_private.viewings,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_api.execute_viewing_operation(uuid,uuid,uuid,bigint,text,uuid,jsonb,text,jsonb),app_api.read_viewing_operation(uuid,uuid),app_api.read_viewing(uuid,uuid),app_api.list_enquiry_viewings(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.execute_viewing_operation(uuid,uuid,uuid,bigint,text,uuid,jsonb,text,jsonb),app_api.read_viewing_operation(uuid,uuid),app_api.read_viewing(uuid,uuid),app_api.list_enquiry_viewings(uuid,integer) TO api_runtime;
COMMIT;

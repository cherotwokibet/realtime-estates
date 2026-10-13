BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE FUNCTION app_private.viewing_phone_agreement_valid(p_agreement jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v_time timestamptz;
BEGIN
 IF p_agreement IS NULL OR jsonb_typeof(p_agreement)<>'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_agreement))<>3 OR NOT p_agreement ?& ARRAY['channel','agreedAt','notes']
  OR p_agreement->>'channel' IS DISTINCT FROM 'phone' OR jsonb_typeof(p_agreement->'agreedAt')<>'string'
  OR jsonb_typeof(p_agreement->'notes')<>'string' OR NOT app_private.contact_notes_valid(p_agreement->>'notes')
  OR p_agreement->>'agreedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RETURN false;END IF;
 v_time:=(p_agreement->>'agreedAt')::timestamptz;
 RETURN app_private.enquiry_time_valid(v_time) AND app_private.enquiry_utc(v_time)=p_agreement->>'agreedAt';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
ALTER TABLE app_private.viewings ADD COLUMN phone_agreement jsonb,ADD COLUMN confirmed_by_id uuid,
 ADD COLUMN proposed_at timestamptz,ADD COLUMN confirmed_at timestamptz,
 ADD FOREIGN KEY(tenant_id,confirmed_by_id) REFERENCES app_private.memberships(tenant_id,user_id);
ALTER TABLE app_private.viewings DROP CONSTRAINT viewings_status_check,DROP CONSTRAINT viewings_check1;
ALTER TABLE app_private.viewings ADD CONSTRAINT viewing_state_with_agreement CHECK(
 (status IN ('requested','proposed') AND phone_agreement IS NULL AND confirmed_by_id IS NULL AND proposed_at IS NULL AND confirmed_at IS NULL
  AND ((status='requested' AND version=1 AND proposed_slot IS NULL) OR
   (status='proposed' AND version=2 AND proposed_slot IS NOT NULL AND app_private.viewing_slot_valid(proposed_slot)))) OR
 (status='confirmed' AND version=3 AND proposed_slot IS NOT NULL AND app_private.viewing_slot_valid(proposed_slot)
  AND phone_agreement IS NOT NULL AND app_private.viewing_phone_agreement_valid(phone_agreement) AND confirmed_by_id IS NOT NULL
  AND proposed_at IS NOT NULL AND app_private.enquiry_time_valid(proposed_at) AND proposed_at>=created_at
  AND confirmed_at IS NOT NULL AND confirmed_at=updated_at AND proposed_at<=confirmed_at
  AND (phone_agreement->>'agreedAt')::timestamptz BETWEEN proposed_at AND confirmed_at
  AND (proposed_slot->>'startAt')::timestamptz>confirmed_at)
);
ALTER TABLE app_private.viewing_operations DROP CONSTRAINT viewing_operations_kind_check,DROP CONSTRAINT viewing_operations_check;
ALTER TABLE app_private.viewing_operations ADD CONSTRAINT viewing_operation_kind CHECK(kind IN ('request','propose','confirm')),
 ADD CONSTRAINT viewing_operation_target CHECK((kind='request' AND target_viewing_id IS NULL) OR
 (kind IN ('propose','confirm') AND target_viewing_id IS NOT NULL AND viewing_id IS NOT NULL AND viewing_id=target_viewing_id));
CREATE OR REPLACE FUNCTION app_private.guard_viewing_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_listing uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Viewing history is immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'requested' OR NEW.version<>1) THEN RAISE EXCEPTION 'Viewing must begin as requested' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='requested' AND NEW.status='proposed' THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','proposed_slot','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','proposed_slot','updated_at']) OR NEW.version<>OLD.version+1
    THEN RAISE EXCEPTION 'Invalid viewing proposal mutation' USING ERRCODE='23514';END IF;
  ELSIF OLD.status='proposed' AND NEW.status='confirmed' THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','phone_agreement','confirmed_by_id','proposed_at','confirmed_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','phone_agreement','confirmed_by_id','proposed_at','confirmed_at'])
    OR NEW.version<>OLD.version+1 OR NEW.proposed_at IS DISTINCT FROM OLD.updated_at OR NEW.confirmed_at IS DISTINCT FROM NEW.updated_at
    THEN RAISE EXCEPTION 'Invalid viewing confirmation mutation' USING ERRCODE='23514';END IF;
  ELSE RAISE EXCEPTION 'Invalid viewing mutation' USING ERRCODE='23514';END IF;
 END IF;
 SELECT listing_id INTO v_listing FROM app_private.enquiries WHERE tenant_id=NEW.tenant_id AND id=NEW.enquiry_id;
 IF v_listing IS NOT NULL AND v_listing<>NEW.listing_id THEN RAISE EXCEPTION 'Viewing listing mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app_private.viewing_snapshot(p_viewing app_private.viewings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('viewingId',p_viewing.id,'enquiryId',p_viewing.enquiry_id,'listingId',p_viewing.listing_id,
  'version',p_viewing.version::text,'status',p_viewing.status,'preferredSlots',p_viewing.preferred_slots,'proposedSlot',p_viewing.proposed_slot)
  ||CASE WHEN p_viewing.status='confirmed' THEN jsonb_build_object('agreement',p_viewing.phone_agreement) ELSE '{}'::jsonb END
$$;
CREATE OR REPLACE FUNCTION app_private.viewing_detail(p_viewing app_private.viewings,p_assigned uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schedule',app_private.viewing_snapshot(p_viewing),'notes',p_viewing.notes,'requestedById',p_viewing.requested_by_id,
  'assignedAgentId',p_assigned,'createdAt',app_private.enquiry_utc(p_viewing.created_at),'updatedAt',app_private.enquiry_utc(p_viewing.updated_at))
  ||CASE WHEN p_viewing.status='confirmed' THEN jsonb_build_object('confirmation',jsonb_build_object(
   'proposedAt',app_private.enquiry_utc(p_viewing.proposed_at),'recordedAt',app_private.enquiry_utc(p_viewing.confirmed_at),'recordedById',p_viewing.confirmed_by_id)) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION app_api.confirm_viewing_phone(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,
 p_slot jsonb,p_channel text,p_agreed_at timestamptz,p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
 v_enquiry app_private.enquiries;v_viewing app_private.viewings;v_listing app_private.listings;v_original app_private.viewing_operations;
 v_agreement jsonb;v_payload jsonb;v_receipt jsonb;v_result jsonb;v_now timestamptz;
 v_outcome text:='applied';v_reason text;v_observed bigint;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_viewing IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990
  OR NOT app_private.viewing_slot_valid(p_slot) OR p_channel IS DISTINCT FROM 'phone' OR p_agreed_at IS NULL
  OR NOT app_private.enquiry_time_valid(p_agreed_at) OR NOT app_private.contact_notes_valid(p_notes)
  THEN RAISE EXCEPTION 'Invalid viewing phone confirmation' USING ERRCODE='23514';END IF;
 v_agreement:=jsonb_build_object('channel',p_channel,'agreedAt',app_private.enquiry_utc(p_agreed_at),'notes',p_notes);
 v_payload:=jsonb_build_object('slot',p_slot)||v_agreement;
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v_viewing FROM app_private.viewings WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND id=p_viewing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text||'/viewing/'||p_operation::text,0));
 SELECT * INTO v_original FROM app_private.viewing_operations WHERE tenant_id=v_tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF v_original.enquiry_id<>p_enquiry OR v_original.requester_id<>v_actor OR v_original.kind<>'confirm'
   OR v_original.target_viewing_id IS DISTINCT FROM p_viewing OR v_original.expected_version<>p_expected
   OR v_original.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN v_original.receipt;
 END IF;
 SELECT * INTO v_listing FROM app_private.listings WHERE tenant_id=v_tenant AND id=v_viewing.listing_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 v_now:=date_trunc('milliseconds',clock_timestamp());v_observed:=v_viewing.version;
 IF p_expected<>v_observed THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
 ELSIF v_enquiry.status NOT IN ('new','assigned','contacted','qualified') THEN v_outcome:='refused';v_reason:='ENQUIRY_CLOSED';
 ELSIF v_listing.publication_status<>'published' OR v_listing.availability<>'available' OR v_listing.archived_at IS NOT NULL
  OR v_listing.last_availability_confirmed_at IS NULL OR v_listing.last_availability_confirmed_at<=v_now-interval '30 days'
  OR NOT EXISTS(SELECT 1 FROM app_private.public_snapshots WHERE tenant_id=v_tenant AND listing_id=v_listing.id AND revision_no=v_listing.published_revision_no)
  THEN v_outcome:='refused';v_reason:='LISTING_UNAVAILABLE';
 ELSIF v_viewing.status<>'proposed' THEN v_outcome:='refused';v_reason:='INVALID_STATE';
 ELSIF p_slot IS DISTINCT FROM v_viewing.proposed_slot THEN v_outcome:='refused';v_reason:='PROPOSED_SLOT_MISMATCH';
 ELSIF (p_slot->>'startAt')::timestamptz<=v_now THEN v_outcome:='refused';v_reason:='SLOT_NOT_FUTURE';
 ELSIF p_agreed_at<v_viewing.updated_at THEN v_outcome:='refused';v_reason:='AGREEMENT_BEFORE_PROPOSAL';
 ELSIF p_agreed_at>v_now THEN v_outcome:='refused';v_reason:='AGREEMENT_IN_FUTURE';
 ELSE
  UPDATE app_private.viewings SET status='confirmed',version=version+1,phone_agreement=v_agreement,confirmed_by_id=v_actor,
   proposed_at=updated_at,confirmed_at=v_now,updated_at=v_now WHERE tenant_id=v_tenant AND id=p_viewing RETURNING * INTO v_viewing;
  v_result:=app_private.viewing_snapshot(v_viewing);
  PERFORM app_private.audit('viewing.confirm','viewing',p_viewing,v_viewing.version,jsonb_build_object('operationId',p_operation,'kind','confirm'));
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',p_viewing,'actorId',v_actor,'kind','confirm',
  'expectedVersion',p_expected::text,'observedVersion',v_observed::text,'request',v_payload,'outcome',v_outcome,'reason',v_reason,'result',v_result,'completedAt',app_private.enquiry_utc(v_now));
 INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at)
  VALUES(v_tenant,p_operation,p_enquiry,v_actor,'confirm',p_viewing,p_viewing,p_expected,v_payload,v_receipt,v_now);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_phone_agreement_valid(jsonb),app_api.confirm_viewing_phone(uuid,uuid,uuid,bigint,jsonb,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.confirm_viewing_phone(uuid,uuid,uuid,bigint,jsonb,text,timestamptz,text) TO api_runtime;
COMMIT;

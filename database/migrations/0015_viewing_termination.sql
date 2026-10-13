BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE FUNCTION app_private.viewing_termination_reason_valid(p_reason text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p_reason IS NOT NULL AND app_private.contact_notes_valid(p_reason) AND length(p_reason)<=1000
$$;
CREATE FUNCTION app_private.viewing_stage_valid(p_status text,p_version bigint,p_slot jsonb,p_agreement jsonb,p_confirmed_by uuid,
 p_proposed_at timestamptz,p_confirmed_at timestamptz,p_created_at timestamptz,p_updated_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
 WHEN p_status='requested' THEN p_version=1 AND p_slot IS NULL AND p_agreement IS NULL AND p_confirmed_by IS NULL
  AND p_proposed_at IS NULL AND p_confirmed_at IS NULL AND p_updated_at=p_created_at
 WHEN p_status='proposed' THEN p_version=2 AND p_slot IS NOT NULL AND app_private.viewing_slot_valid(p_slot)
  AND (p_slot->>'startAt')::timestamptz>p_updated_at AND p_updated_at>=p_created_at
  AND p_agreement IS NULL AND p_confirmed_by IS NULL AND p_proposed_at IS NULL AND p_confirmed_at IS NULL
 WHEN p_status='confirmed' THEN p_version=3 AND p_slot IS NOT NULL AND app_private.viewing_slot_valid(p_slot)
  AND p_agreement IS NOT NULL AND app_private.viewing_phone_agreement_valid(p_agreement) AND p_confirmed_by IS NOT NULL
  AND p_proposed_at IS NOT NULL AND app_private.enquiry_time_valid(p_proposed_at) AND p_proposed_at>=p_created_at
  AND p_confirmed_at IS NOT NULL AND p_confirmed_at=p_updated_at AND p_proposed_at<=p_confirmed_at
  AND (p_agreement->>'agreedAt')::timestamptz BETWEEN p_proposed_at AND p_confirmed_at
  AND (p_slot->>'startAt')::timestamptz>p_confirmed_at
 ELSE false END
$$;
ALTER TABLE app_private.viewings ADD COLUMN termination_kind text,ADD COLUMN terminated_from_status text,ADD COLUMN termination_reason text,
 ADD COLUMN terminated_by_id uuid,ADD COLUMN terminated_at timestamptz,ADD COLUMN previous_updated_at timestamptz,
 ADD FOREIGN KEY(tenant_id,terminated_by_id) REFERENCES app_private.memberships(tenant_id,user_id);
ALTER TABLE app_private.viewings DROP CONSTRAINT viewing_state_with_agreement;
ALTER TABLE app_private.viewings ADD CONSTRAINT viewing_state_with_terminal_history CHECK(
 (status IN ('requested','proposed','confirmed') AND termination_kind IS NULL AND terminated_from_status IS NULL AND termination_reason IS NULL
  AND terminated_by_id IS NULL AND terminated_at IS NULL AND previous_updated_at IS NULL
  AND app_private.viewing_stage_valid(status,version,proposed_slot,phone_agreement,confirmed_by_id,proposed_at,confirmed_at,created_at,updated_at)) OR
 (status IN ('cancelled','declined') AND termination_kind IS NOT NULL AND termination_kind IN ('cancel','decline')
  AND status=CASE WHEN termination_kind='cancel' THEN 'cancelled' ELSE 'declined' END
  AND terminated_from_status IS NOT NULL AND terminated_from_status IN ('requested','proposed','confirmed')
  AND (termination_kind='cancel' OR terminated_from_status IN ('requested','proposed'))
  AND termination_reason IS NOT NULL AND app_private.viewing_termination_reason_valid(termination_reason) AND terminated_by_id IS NOT NULL
  AND terminated_at IS NOT NULL AND terminated_at=updated_at AND previous_updated_at IS NOT NULL
  AND app_private.enquiry_time_valid(previous_updated_at) AND previous_updated_at>=created_at AND previous_updated_at<=terminated_at
  AND app_private.viewing_stage_valid(terminated_from_status,version-1,proposed_slot,phone_agreement,confirmed_by_id,proposed_at,confirmed_at,created_at,previous_updated_at))
);
ALTER TABLE app_private.viewing_operations DROP CONSTRAINT viewing_operation_kind,DROP CONSTRAINT viewing_operation_target;
ALTER TABLE app_private.viewing_operations ADD CONSTRAINT viewing_operation_kind CHECK(kind IN ('request','propose','confirm','cancel','decline')),
 ADD CONSTRAINT viewing_operation_target CHECK((kind='request' AND target_viewing_id IS NULL) OR
 (kind IN ('propose','confirm','cancel','decline') AND target_viewing_id IS NOT NULL AND viewing_id IS NOT NULL AND viewing_id=target_viewing_id));
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
  ELSIF OLD.status IN ('requested','proposed','confirmed') AND NEW.status IN ('cancelled','declined') THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','termination_kind','terminated_from_status','termination_reason','terminated_by_id','terminated_at','previous_updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','termination_kind','terminated_from_status','termination_reason','terminated_by_id','terminated_at','previous_updated_at'])
    OR NEW.version<>OLD.version+1 OR NEW.terminated_from_status IS DISTINCT FROM OLD.status
    OR NEW.previous_updated_at IS DISTINCT FROM OLD.updated_at OR NEW.terminated_at IS DISTINCT FROM NEW.updated_at
    THEN RAISE EXCEPTION 'Invalid viewing terminal mutation' USING ERRCODE='23514';END IF;
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
  ||CASE WHEN p_viewing.phone_agreement IS NOT NULL THEN jsonb_build_object('agreement',p_viewing.phone_agreement) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.termination_kind IS NOT NULL THEN jsonb_build_object('termination',jsonb_build_object(
   'kind',p_viewing.termination_kind,'fromStatus',p_viewing.terminated_from_status,'reason',p_viewing.termination_reason,
   'endedAt',app_private.enquiry_utc(p_viewing.terminated_at),'previousUpdatedAt',app_private.enquiry_utc(p_viewing.previous_updated_at))) ELSE '{}'::jsonb END
$$;
CREATE OR REPLACE FUNCTION app_private.viewing_detail(p_viewing app_private.viewings,p_assigned uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schedule',app_private.viewing_snapshot(p_viewing),'notes',p_viewing.notes,'requestedById',p_viewing.requested_by_id,
  'assignedAgentId',p_assigned,'createdAt',app_private.enquiry_utc(p_viewing.created_at),'updatedAt',app_private.enquiry_utc(p_viewing.updated_at))
  ||CASE WHEN p_viewing.phone_agreement IS NOT NULL THEN jsonb_build_object('confirmation',jsonb_build_object(
   'proposedAt',app_private.enquiry_utc(p_viewing.proposed_at),'recordedAt',app_private.enquiry_utc(p_viewing.confirmed_at),'recordedById',p_viewing.confirmed_by_id)) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.termination_kind IS NOT NULL THEN jsonb_build_object('terminationRecord',jsonb_build_object('recordedById',p_viewing.terminated_by_id)) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION app_api.terminate_viewing(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,p_kind text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
 v_enquiry app_private.enquiries;v_viewing app_private.viewings;v_original app_private.viewing_operations;
 v_payload jsonb;v_receipt jsonb;v_result jsonb;v_now timestamptz;v_observed bigint;v_outcome text:='applied';v_reason text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_viewing IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990
  OR p_kind IS NULL OR p_kind NOT IN ('cancel','decline') OR NOT app_private.viewing_termination_reason_valid(p_reason)
  THEN RAISE EXCEPTION 'Invalid viewing terminal command' USING ERRCODE='23514';END IF;
 v_payload:=jsonb_build_object('reason',p_reason);
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v_viewing FROM app_private.viewings WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND id=p_viewing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text||'/viewing/'||p_operation::text,0));
 SELECT * INTO v_original FROM app_private.viewing_operations WHERE tenant_id=v_tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF v_original.enquiry_id<>p_enquiry OR v_original.requester_id<>v_actor OR v_original.kind<>p_kind
   OR v_original.target_viewing_id IS DISTINCT FROM p_viewing OR v_original.expected_version<>p_expected
   OR v_original.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN v_original.receipt;
 END IF;
 v_now:=date_trunc('milliseconds',clock_timestamp());v_observed:=v_viewing.version;
 IF p_expected<>v_observed THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
 ELSIF v_viewing.status NOT IN ('requested','proposed','confirmed') OR (p_kind='decline' AND v_viewing.status='confirmed') THEN v_outcome:='refused';v_reason:='INVALID_STATE';
 ELSIF v_viewing.updated_at>v_now THEN v_outcome:='refused';v_reason:='RECORD_TIME_IN_FUTURE';
 ELSE
  UPDATE app_private.viewings SET status=CASE WHEN p_kind='cancel' THEN 'cancelled' ELSE 'declined' END,version=version+1,
   termination_kind=p_kind,terminated_from_status=status,termination_reason=p_reason,terminated_by_id=v_actor,
   previous_updated_at=updated_at,terminated_at=v_now,updated_at=v_now WHERE tenant_id=v_tenant AND id=p_viewing RETURNING * INTO v_viewing;
  v_result:=app_private.viewing_snapshot(v_viewing);
  PERFORM app_private.audit('viewing.'||p_kind,'viewing',p_viewing,v_viewing.version,jsonb_build_object('operationId',p_operation,'kind',p_kind));
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',p_viewing,'actorId',v_actor,'kind',p_kind,
  'expectedVersion',p_expected::text,'observedVersion',v_observed::text,'request',v_payload,'outcome',v_outcome,'reason',v_reason,'result',v_result,'completedAt',app_private.enquiry_utc(v_now));
 INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at)
  VALUES(v_tenant,p_operation,p_enquiry,v_actor,p_kind,p_viewing,p_viewing,p_expected,v_payload,v_receipt,v_now);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_termination_reason_valid(text),app_private.viewing_stage_valid(text,bigint,jsonb,jsonb,uuid,timestamptz,timestamptz,timestamptz,timestamptz),app_api.terminate_viewing(uuid,uuid,uuid,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.terminate_viewing(uuid,uuid,uuid,bigint,text,text) TO api_runtime;
COMMIT;

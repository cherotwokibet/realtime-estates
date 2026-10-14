BEGIN;
SET LOCAL ROLE realtor_owner;

ALTER TABLE app_private.viewings ADD COLUMN outcome_kind text,ADD COLUMN outcome_reason text,
 ADD COLUMN outcome_occurred_at timestamptz,ADD COLUMN outcome_recorded_at timestamptz,
 ADD COLUMN outcome_recorded_by_id uuid,ADD COLUMN outcome_previous_updated_at timestamptz,
 ADD FOREIGN KEY(tenant_id,outcome_recorded_by_id) REFERENCES app_private.memberships(tenant_id,user_id);
-- Retain the exact reviewed cycle validator, then validate an outcome against its
-- immutable prior confirmed row. No old first-cycle or current-cycle facts change.
ALTER FUNCTION app_private.viewing_current_state_valid(app_private.viewings) RENAME TO viewing_state_before_outcomes_valid;
CREATE FUNCTION app_private.viewing_current_state_valid(p app_private.viewings) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE prior app_private.viewings:=p;slot jsonb;
BEGIN
 IF p.outcome_kind IS NULL THEN
  RETURN coalesce(p.outcome_reason IS NULL AND p.outcome_occurred_at IS NULL AND p.outcome_recorded_at IS NULL
   AND p.outcome_recorded_by_id IS NULL AND p.outcome_previous_updated_at IS NULL
   AND app_private.viewing_state_before_outcomes_valid(p),false);
 END IF;
 IF p.outcome_kind NOT IN ('complete','no_show') OR p.status<>(CASE WHEN p.outcome_kind='complete' THEN 'completed' ELSE 'no_show' END)
  OR p.outcome_reason IS NULL OR NOT app_private.viewing_termination_reason_valid(p.outcome_reason)
  OR p.outcome_occurred_at IS NULL OR NOT app_private.enquiry_time_valid(p.outcome_occurred_at)
  OR p.outcome_recorded_at IS NULL OR p.outcome_recorded_at<>p.updated_at
  OR p.outcome_recorded_by_id IS NULL OR p.outcome_previous_updated_at IS NULL
  OR NOT app_private.enquiry_time_valid(p.outcome_previous_updated_at)
  OR p.outcome_previous_updated_at>p.outcome_recorded_at THEN RETURN false;END IF;
 slot:=coalesce(p.current_cycle->'slot',p.proposed_slot);
 IF slot IS NULL OR NOT app_private.viewing_slot_valid(slot)
  OR p.outcome_occurred_at<(slot->>'endAt')::timestamptz OR p.outcome_occurred_at>p.outcome_recorded_at THEN RETURN false;END IF;
 prior.status:='confirmed';prior.version:=p.version-1;prior.updated_at:=p.outcome_previous_updated_at;
 prior.outcome_kind:=NULL;prior.outcome_reason:=NULL;prior.outcome_occurred_at:=NULL;prior.outcome_recorded_at:=NULL;
 prior.outcome_recorded_by_id:=NULL;prior.outcome_previous_updated_at:=NULL;
 RETURN coalesce(app_private.viewing_state_before_outcomes_valid(prior),false);
END $$;
ALTER TABLE app_private.viewings DROP CONSTRAINT viewing_state_with_cycles;
ALTER TABLE app_private.viewings ADD CONSTRAINT viewing_state_with_outcomes CHECK(app_private.viewing_current_state_valid(viewings));
ALTER TABLE app_private.viewing_operations DROP CONSTRAINT viewing_operation_kind,DROP CONSTRAINT viewing_operation_target;
ALTER TABLE app_private.viewing_operations ADD CONSTRAINT viewing_operation_kind CHECK(kind IN ('request','propose','confirm','cancel','decline','reschedule','complete','no_show')),
 ADD CONSTRAINT viewing_operation_target CHECK((kind='request' AND target_viewing_id IS NULL) OR
 (kind IN ('propose','confirm','cancel','decline','reschedule','complete','no_show') AND target_viewing_id IS NOT NULL AND viewing_id IS NOT NULL AND viewing_id=target_viewing_id));
CREATE OR REPLACE FUNCTION app_private.guard_viewing_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_listing uuid;
BEGIN

 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Viewing history is immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND (NEW.outcome_kind IS NOT NULL OR NEW.outcome_reason IS NOT NULL OR NEW.outcome_occurred_at IS NOT NULL
  OR NEW.outcome_recorded_at IS NOT NULL OR NEW.outcome_recorded_by_id IS NOT NULL OR NEW.outcome_previous_updated_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Viewing cannot begin with an outcome' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.outcome_kind IS NOT NULL OR NEW.outcome_kind IS NOT NULL) THEN
  IF OLD.outcome_kind IS NOT NULL OR OLD.status<>'confirmed' OR NEW.status NOT IN ('completed','no_show')
   OR NEW.version<>OLD.version+1 OR NEW.outcome_previous_updated_at IS DISTINCT FROM OLD.updated_at
   OR NEW.outcome_recorded_at IS DISTINCT FROM NEW.updated_at
   OR (to_jsonb(NEW)-ARRAY['status','version','updated_at','outcome_kind','outcome_reason','outcome_occurred_at','outcome_recorded_at','outcome_recorded_by_id','outcome_previous_updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','updated_at','outcome_kind','outcome_reason','outcome_occurred_at','outcome_recorded_at','outcome_recorded_by_id','outcome_previous_updated_at'])
   THEN RAISE EXCEPTION 'Invalid viewing attendance outcome mutation' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND NEW.current_cycle IS NOT NULL THEN RAISE EXCEPTION 'Viewing must begin in its first cycle' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.current_cycle IS NOT NULL OR NEW.current_cycle IS NOT NULL) THEN
  IF OLD.status IN ('proposed','confirmed') AND NEW.status='proposed' AND NEW.current_cycle IS DISTINCT FROM OLD.current_cycle THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','current_cycle','cycle_confirmed_by_id','first_cycle_status','first_cycle_updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','current_cycle','cycle_confirmed_by_id','first_cycle_status','first_cycle_updated_at'])
    OR NEW.version<>OLD.version+1 OR NEW.cycle_confirmed_by_id IS NOT NULL
    OR NEW.first_cycle_status IS DISTINCT FROM coalesce(OLD.first_cycle_status,OLD.status)
    OR NEW.first_cycle_updated_at IS DISTINCT FROM coalesce(OLD.first_cycle_updated_at,OLD.updated_at)
    OR NEW.current_cycle->>'number' IS DISTINCT FROM (coalesce((OLD.current_cycle->>'number')::bigint,1)+1)::text
    OR NEW.current_cycle->>'proposalVersion' IS DISTINCT FROM NEW.version::text
    OR NEW.current_cycle->>'proposedAt' IS DISTINCT FROM app_private.enquiry_utc(NEW.updated_at)
    OR NEW.current_cycle->>'previousStatus' IS DISTINCT FROM OLD.status
    OR NEW.current_cycle->>'previousUpdatedAt' IS DISTINCT FROM app_private.enquiry_utc(OLD.updated_at)
    OR NEW.current_cycle->'slot' IS NOT DISTINCT FROM coalesce(OLD.current_cycle->'slot',OLD.proposed_slot)
    THEN RAISE EXCEPTION 'Invalid viewing reschedule mutation' USING ERRCODE='23514';END IF;
  ELSIF OLD.current_cycle IS NOT NULL AND OLD.status='proposed' AND NEW.status='confirmed' THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','current_cycle','cycle_confirmed_by_id']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','current_cycle','cycle_confirmed_by_id'])
    OR (NEW.current_cycle-ARRAY['agreement','confirmedAt']) IS DISTINCT FROM (OLD.current_cycle-ARRAY['agreement','confirmedAt'])
    OR NEW.current_cycle->>'confirmedAt' IS DISTINCT FROM app_private.enquiry_utc(NEW.updated_at) OR NEW.version<>OLD.version+1
    THEN RAISE EXCEPTION 'Invalid current cycle confirmation' USING ERRCODE='23514';END IF;
  ELSIF OLD.current_cycle IS NOT NULL AND OLD.status IN ('proposed','confirmed') AND NEW.status IN ('cancelled','declined') THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','termination_kind','terminated_from_status','termination_reason','terminated_by_id','terminated_at','previous_updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','termination_kind','terminated_from_status','termination_reason','terminated_by_id','terminated_at','previous_updated_at'])
    OR NEW.version<>OLD.version+1 OR NEW.terminated_from_status IS DISTINCT FROM OLD.status OR NEW.previous_updated_at IS DISTINCT FROM OLD.updated_at
    OR NEW.terminated_at IS DISTINCT FROM NEW.updated_at THEN RAISE EXCEPTION 'Invalid current cycle ending' USING ERRCODE='23514';END IF;
  ELSE RAISE EXCEPTION 'Invalid viewing cycle mutation' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
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
  'version',p_viewing.version::text,'status',p_viewing.status,'preferredSlots',p_viewing.preferred_slots,
  'proposedSlot',coalesce(p_viewing.current_cycle->'slot',p_viewing.proposed_slot))
  ||CASE WHEN coalesce(nullif(p_viewing.current_cycle->'agreement','null'::jsonb),CASE WHEN p_viewing.current_cycle IS NULL THEN p_viewing.phone_agreement END) IS NOT NULL
   THEN jsonb_build_object('agreement',coalesce(nullif(p_viewing.current_cycle->'agreement','null'::jsonb),p_viewing.phone_agreement)) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.current_cycle IS NOT NULL THEN jsonb_build_object('cycle',p_viewing.current_cycle-ARRAY['slot','agreement','confirmedAt']) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.termination_kind IS NOT NULL THEN jsonb_build_object('termination',jsonb_build_object('kind',p_viewing.termination_kind,
   'fromStatus',p_viewing.terminated_from_status,'reason',p_viewing.termination_reason,'endedAt',app_private.enquiry_utc(p_viewing.terminated_at),
   'previousUpdatedAt',app_private.enquiry_utc(p_viewing.previous_updated_at))) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.outcome_kind IS NOT NULL THEN jsonb_build_object('outcome',jsonb_build_object(
   'kind',p_viewing.outcome_kind,'fromStatus','confirmed','reason',p_viewing.outcome_reason,
   'occurredAt',app_private.enquiry_utc(p_viewing.outcome_occurred_at),'recordedAt',app_private.enquiry_utc(p_viewing.outcome_recorded_at),
   'previousUpdatedAt',app_private.enquiry_utc(p_viewing.outcome_previous_updated_at))) ELSE '{}'::jsonb END
$$;
CREATE OR REPLACE FUNCTION app_private.viewing_detail(p_viewing app_private.viewings,p_assigned uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schedule',app_private.viewing_snapshot(p_viewing),'notes',p_viewing.notes,'requestedById',p_viewing.requested_by_id,
  'assignedAgentId',p_assigned,'createdAt',app_private.enquiry_utc(p_viewing.created_at),'updatedAt',app_private.enquiry_utc(p_viewing.updated_at))
  ||CASE WHEN nullif(p_viewing.current_cycle->'agreement','null'::jsonb) IS NOT NULL THEN jsonb_build_object('confirmation',jsonb_build_object(
   'proposedAt',p_viewing.current_cycle->>'proposedAt','recordedAt',p_viewing.current_cycle->>'confirmedAt','recordedById',p_viewing.cycle_confirmed_by_id))
   WHEN p_viewing.current_cycle IS NULL AND p_viewing.phone_agreement IS NOT NULL THEN jsonb_build_object('confirmation',jsonb_build_object(
   'proposedAt',app_private.enquiry_utc(p_viewing.proposed_at),'recordedAt',app_private.enquiry_utc(p_viewing.confirmed_at),'recordedById',p_viewing.confirmed_by_id)) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.termination_kind IS NOT NULL THEN jsonb_build_object('terminationRecord',jsonb_build_object('recordedById',p_viewing.terminated_by_id)) ELSE '{}'::jsonb END
  ||CASE WHEN p_viewing.outcome_kind IS NOT NULL THEN jsonb_build_object('outcomeRecord',jsonb_build_object('recordedById',p_viewing.outcome_recorded_by_id)) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION app_api.record_viewing_outcome(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,p_kind text,p_occurred_at timestamptz,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
 v_enquiry app_private.enquiries;v_viewing app_private.viewings;v_original app_private.viewing_operations;
 v_payload jsonb;v_receipt jsonb;v_result jsonb;v_now timestamptz;v_slot jsonb;v_observed bigint;v_outcome text:='applied';v_reason text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_viewing IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990
  OR p_kind IS NULL OR p_kind NOT IN ('complete','no_show') OR p_occurred_at IS NULL OR NOT app_private.enquiry_time_valid(p_occurred_at)
  OR NOT app_private.viewing_termination_reason_valid(p_reason) THEN RAISE EXCEPTION 'Invalid viewing outcome command' USING ERRCODE='23514';END IF;
 v_payload:=jsonb_build_object('occurredAt',app_private.enquiry_utc(p_occurred_at),'reason',p_reason);
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
 v_now:=date_trunc('milliseconds',clock_timestamp());v_observed:=v_viewing.version;v_slot:=coalesce(v_viewing.current_cycle->'slot',v_viewing.proposed_slot);
 IF p_expected<>v_observed THEN v_outcome:='conflict';v_reason:='VERSION_CONFLICT';
 ELSIF v_viewing.status<>'confirmed' THEN v_outcome:='refused';v_reason:='INVALID_STATE';
 ELSIF v_viewing.updated_at>v_now THEN v_outcome:='refused';v_reason:='RECORD_TIME_IN_FUTURE';
 ELSIF (v_slot->>'endAt')::timestamptz>v_now THEN v_outcome:='refused';v_reason:='SLOT_NOT_ENDED';
 ELSIF p_occurred_at<(v_slot->>'endAt')::timestamptz THEN v_outcome:='refused';v_reason:='OUTCOME_BEFORE_SLOT_END';
 ELSIF p_occurred_at>v_now THEN v_outcome:='refused';v_reason:='OUTCOME_IN_FUTURE';
 ELSE
  UPDATE app_private.viewings SET status=CASE WHEN p_kind='complete' THEN 'completed' ELSE 'no_show' END,version=version+1,
   outcome_kind=p_kind,outcome_reason=p_reason,outcome_occurred_at=p_occurred_at,outcome_recorded_at=v_now,outcome_recorded_by_id=v_actor,
   outcome_previous_updated_at=updated_at,updated_at=v_now WHERE tenant_id=v_tenant AND id=p_viewing RETURNING * INTO v_viewing;
  v_result:=app_private.viewing_snapshot(v_viewing);
  PERFORM app_private.audit('viewing.'||p_kind,'viewing',p_viewing,v_viewing.version,jsonb_build_object('operationId',p_operation,'kind',p_kind));
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',p_viewing,'actorId',v_actor,'kind',p_kind,
  'expectedVersion',p_expected::text,'observedVersion',v_observed::text,'request',v_payload,'outcome',v_outcome,'reason',v_reason,'result',v_result,'completedAt',app_private.enquiry_utc(v_now));
 INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at)
  VALUES(v_tenant,p_operation,p_enquiry,v_actor,p_kind,p_viewing,p_viewing,p_expected,v_payload,v_receipt,v_now);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_state_before_outcomes_valid(app_private.viewings),app_private.viewing_current_state_valid(app_private.viewings),app_api.record_viewing_outcome(uuid,uuid,uuid,bigint,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.record_viewing_outcome(uuid,uuid,uuid,bigint,text,timestamptz,text) TO api_runtime;
COMMIT;

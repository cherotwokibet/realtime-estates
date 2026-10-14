BEGIN;
SET LOCAL ROLE realtor_owner;

-- First-cycle fields remain historical facts. Later current cycles are separate;
-- every superseded applied projection remains in the immutable operation ledger.
ALTER TABLE app_private.viewings ADD COLUMN current_cycle jsonb,ADD COLUMN cycle_confirmed_by_id uuid,
 ADD COLUMN first_cycle_status text,ADD COLUMN first_cycle_updated_at timestamptz,
 ADD FOREIGN KEY(tenant_id,cycle_confirmed_by_id) REFERENCES app_private.memberships(tenant_id,user_id);
CREATE FUNCTION app_private.viewing_current_state_valid(p app_private.viewings) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb:=p.current_cycle;a jsonb;n bigint;pv bigint;pt timestamptz;previous timestamptz;ct timestamptz;
 stage text;stage_version bigint;stage_time timestamptz;ended boolean:=p.status IN ('cancelled','declined');
BEGIN
 IF c IS NULL THEN RETURN coalesce((
 (p.status IN ('requested','proposed','confirmed') AND p.termination_kind IS NULL AND p.terminated_from_status IS NULL AND p.termination_reason IS NULL
  AND p.terminated_by_id IS NULL AND p.terminated_at IS NULL AND p.previous_updated_at IS NULL
  AND app_private.viewing_stage_valid(p.status,p.version,p.proposed_slot,p.phone_agreement,p.confirmed_by_id,p.proposed_at,p.confirmed_at,p.created_at,p.updated_at)) OR
 (p.status IN ('cancelled','declined') AND p.termination_kind IS NOT NULL AND p.termination_kind IN ('cancel','decline')
  AND p.status=CASE WHEN p.termination_kind='cancel' THEN 'cancelled' ELSE 'declined' END
  AND p.terminated_from_status IS NOT NULL AND p.terminated_from_status IN ('requested','proposed','confirmed')
  AND (p.termination_kind='cancel' OR p.terminated_from_status IN ('requested','proposed'))
  AND p.termination_reason IS NOT NULL AND app_private.viewing_termination_reason_valid(p.termination_reason) AND p.terminated_by_id IS NOT NULL
  AND p.terminated_at IS NOT NULL AND p.terminated_at=p.updated_at AND p.previous_updated_at IS NOT NULL
  AND app_private.enquiry_time_valid(p.previous_updated_at) AND p.previous_updated_at>=p.created_at AND p.previous_updated_at<=p.terminated_at
  AND app_private.viewing_stage_valid(p.terminated_from_status,p.version-1,p.proposed_slot,p.phone_agreement,p.confirmed_by_id,p.proposed_at,p.confirmed_at,p.created_at,p.previous_updated_at))) AND p.cycle_confirmed_by_id IS NULL
  AND p.first_cycle_status IS NULL AND p.first_cycle_updated_at IS NULL,false);END IF;
 IF jsonb_typeof(c)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>9
  OR NOT c ?& ARRAY['number','proposalVersion','slot','proposedAt','reason','previousStatus','previousUpdatedAt','agreement','confirmedAt']
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['number','proposalVersion','proposedAt','reason','previousStatus','previousUpdatedAt']) key WHERE jsonb_typeof(c->key)<>'string')
  OR c->>'number' !~ '^[1-9][0-9]{0,15}$' OR c->>'proposalVersion' !~ '^[1-9][0-9]{0,15}$'
  OR c->>'previousStatus' NOT IN ('proposed','confirmed') OR NOT app_private.viewing_slot_valid(c->'slot')
  OR NOT app_private.viewing_termination_reason_valid(c->>'reason') THEN RETURN false;END IF;
 n:=(c->>'number')::bigint;pv:=(c->>'proposalVersion')::bigint;pt:=(c->>'proposedAt')::timestamptz;previous:=(c->>'previousUpdatedAt')::timestamptz;
 IF n NOT BETWEEN 2 AND 9007199254740990 OR pv NOT BETWEEN n+1 AND 2*n OR pv>9007199254740991 OR pv-(CASE WHEN c->>'previousStatus'='confirmed' THEN 2 ELSE 1 END) NOT BETWEEN n AND 2*(n-1)
  OR NOT app_private.enquiry_time_valid(pt) OR app_private.enquiry_utc(pt)<>c->>'proposedAt'
  OR NOT app_private.enquiry_time_valid(previous) OR app_private.enquiry_utc(previous)<>c->>'previousUpdatedAt'
  OR previous>pt OR (c->'slot'->>'startAt')::timestamptz<=pt
  OR p.first_cycle_status IS NULL OR p.first_cycle_status NOT IN ('proposed','confirmed') OR p.first_cycle_updated_at IS NULL
  OR p.first_cycle_updated_at>previous
  OR NOT app_private.viewing_stage_valid(p.first_cycle_status,CASE WHEN p.first_cycle_status='proposed' THEN 2 ELSE 3 END,
    p.proposed_slot,p.phone_agreement,p.confirmed_by_id,p.proposed_at,p.confirmed_at,p.created_at,p.first_cycle_updated_at) THEN RETURN false;END IF;
 IF ended THEN
  IF p.termination_kind IS NULL OR p.status<>(CASE WHEN p.termination_kind='cancel' THEN 'cancelled' WHEN p.termination_kind='decline' THEN 'declined' ELSE '' END)
   OR p.terminated_from_status IS NULL OR p.terminated_from_status NOT IN ('proposed','confirmed')
   OR p.termination_kind='decline' AND p.terminated_from_status='confirmed'
   OR p.terminated_by_id IS NULL OR p.termination_reason IS NULL OR NOT app_private.viewing_termination_reason_valid(p.termination_reason)
   OR p.terminated_at IS NULL OR p.terminated_at<>p.updated_at OR p.previous_updated_at IS NULL OR p.previous_updated_at>p.terminated_at THEN RETURN false;END IF;
  stage:=p.terminated_from_status;stage_version:=p.version-1;stage_time:=p.previous_updated_at;
 ELSE
  IF p.status NOT IN ('proposed','confirmed') OR p.termination_kind IS NOT NULL OR p.terminated_from_status IS NOT NULL OR p.termination_reason IS NOT NULL
   OR p.terminated_by_id IS NOT NULL OR p.terminated_at IS NOT NULL OR p.previous_updated_at IS NOT NULL THEN RETURN false;END IF;
  stage:=p.status;stage_version:=p.version;stage_time:=p.updated_at;
 END IF;
 a:=nullif(c->'agreement','null'::jsonb);
 IF stage='proposed' THEN RETURN stage_version=pv AND stage_time=pt AND a IS NULL AND c->'confirmedAt'='null'::jsonb AND p.cycle_confirmed_by_id IS NULL;END IF;
 IF jsonb_typeof(c->'confirmedAt')<>'string' THEN RETURN false;END IF;ct:=(c->>'confirmedAt')::timestamptz;
 RETURN stage_version=pv+1 AND stage_time=ct AND app_private.enquiry_time_valid(ct) AND app_private.enquiry_utc(ct)=c->>'confirmedAt'
  AND ct>=pt AND (c->'slot'->>'startAt')::timestamptz>ct AND a IS NOT NULL AND app_private.viewing_phone_agreement_valid(a)
  AND (a->>'agreedAt')::timestamptz BETWEEN pt AND ct AND p.cycle_confirmed_by_id IS NOT NULL;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
ALTER TABLE app_private.viewings DROP CONSTRAINT viewing_state_with_terminal_history;
ALTER TABLE app_private.viewings ADD CONSTRAINT viewing_state_with_cycles CHECK(app_private.viewing_current_state_valid(viewings));
ALTER TABLE app_private.viewing_operations DROP CONSTRAINT viewing_operation_kind,DROP CONSTRAINT viewing_operation_target;
ALTER TABLE app_private.viewing_operations ADD CONSTRAINT viewing_operation_kind CHECK(kind IN ('request','propose','confirm','cancel','decline','reschedule')),
 ADD CONSTRAINT viewing_operation_target CHECK((kind='request' AND target_viewing_id IS NULL) OR
  (kind IN ('propose','confirm','cancel','decline','reschedule') AND target_viewing_id IS NOT NULL AND viewing_id IS NOT NULL AND viewing_id=target_viewing_id));
CREATE OR REPLACE FUNCTION app_private.guard_viewing_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_listing uuid;
BEGIN
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
$$;
CREATE OR REPLACE FUNCTION app_api.confirm_viewing_phone(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,
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
 ELSIF p_slot IS DISTINCT FROM coalesce(v_viewing.current_cycle->'slot',v_viewing.proposed_slot) THEN v_outcome:='refused';v_reason:='PROPOSED_SLOT_MISMATCH';
 ELSIF (p_slot->>'startAt')::timestamptz<=v_now THEN v_outcome:='refused';v_reason:='SLOT_NOT_FUTURE';
 ELSIF p_agreed_at<v_viewing.updated_at THEN v_outcome:='refused';v_reason:='AGREEMENT_BEFORE_PROPOSAL';
 ELSIF p_agreed_at>v_now THEN v_outcome:='refused';v_reason:='AGREEMENT_IN_FUTURE';
 ELSE
  UPDATE app_private.viewings SET status='confirmed',version=version+1,
   phone_agreement=CASE WHEN current_cycle IS NULL THEN v_agreement ELSE phone_agreement END,
   confirmed_by_id=CASE WHEN current_cycle IS NULL THEN v_actor ELSE confirmed_by_id END,
   proposed_at=CASE WHEN current_cycle IS NULL THEN updated_at ELSE proposed_at END,
   confirmed_at=CASE WHEN current_cycle IS NULL THEN v_now ELSE confirmed_at END,
   current_cycle=CASE WHEN current_cycle IS NULL THEN NULL ELSE current_cycle||jsonb_build_object('agreement',v_agreement,'confirmedAt',app_private.enquiry_utc(v_now)) END,
   cycle_confirmed_by_id=CASE WHEN current_cycle IS NULL THEN NULL ELSE v_actor END,updated_at=v_now
   WHERE tenant_id=v_tenant AND id=p_viewing RETURNING * INTO v_viewing;
  v_result:=app_private.viewing_snapshot(v_viewing);
  PERFORM app_private.audit('viewing.confirm','viewing',p_viewing,v_viewing.version,jsonb_build_object('operationId',p_operation,'kind','confirm'));
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',p_viewing,'actorId',v_actor,'kind','confirm',
  'expectedVersion',p_expected::text,'observedVersion',v_observed::text,'request',v_payload,'outcome',v_outcome,'reason',v_reason,'result',v_result,'completedAt',app_private.enquiry_utc(v_now));
 INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at)
  VALUES(v_tenant,p_operation,p_enquiry,v_actor,'confirm',p_viewing,p_viewing,p_expected,v_payload,v_receipt,v_now);
 RETURN v_receipt;
END $$;
CREATE FUNCTION app_api.reschedule_viewing(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,p_slot jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();v_enquiry app_private.enquiries;
 v_viewing app_private.viewings;v_listing app_private.listings;v_original app_private.viewing_operations;
 v_payload jsonb;v_receipt jsonb;v_result jsonb;v_now timestamptz;v_observed bigint;v_outcome text:='applied';v_reason text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_viewing IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990
  OR NOT app_private.viewing_slot_valid(p_slot) OR NOT app_private.viewing_termination_reason_valid(p_reason)
  THEN RAISE EXCEPTION 'Invalid viewing reschedule command' USING ERRCODE='23514';END IF;
 v_payload:=jsonb_build_object('slot',p_slot,'reason',p_reason);
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v_viewing FROM app_private.viewings WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND id=p_viewing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text||'/viewing/'||p_operation::text,0));
 SELECT * INTO v_original FROM app_private.viewing_operations WHERE tenant_id=v_tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF v_original.enquiry_id<>p_enquiry OR v_original.requester_id<>v_actor OR v_original.kind<>'reschedule'
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
 ELSIF v_viewing.status NOT IN ('proposed','confirmed') THEN v_outcome:='refused';v_reason:='INVALID_STATE';
 ELSIF v_viewing.updated_at>v_now THEN v_outcome:='refused';v_reason:='RECORD_TIME_IN_FUTURE';
 ELSIF p_slot IS NOT DISTINCT FROM coalesce(v_viewing.current_cycle->'slot',v_viewing.proposed_slot) THEN v_outcome:='refused';v_reason:='SLOT_UNCHANGED';
 ELSIF (p_slot->>'startAt')::timestamptz<=v_now THEN v_outcome:='refused';v_reason:='SLOT_NOT_FUTURE';
 ELSE
  UPDATE app_private.viewings SET current_cycle=jsonb_build_object('number',(coalesce((current_cycle->>'number')::bigint,1)+1)::text,
   'proposalVersion',(version+1)::text,'slot',p_slot,'proposedAt',app_private.enquiry_utc(v_now),'reason',p_reason,'previousStatus',status,
   'previousUpdatedAt',app_private.enquiry_utc(updated_at),'agreement',NULL,'confirmedAt',NULL),cycle_confirmed_by_id=NULL,
   first_cycle_status=coalesce(first_cycle_status,status),first_cycle_updated_at=coalesce(first_cycle_updated_at,updated_at),
   status='proposed',version=version+1,updated_at=v_now WHERE tenant_id=v_tenant AND id=p_viewing RETURNING * INTO v_viewing;
  v_result:=app_private.viewing_snapshot(v_viewing);
  PERFORM app_private.audit('viewing.reschedule','viewing',p_viewing,v_viewing.version,jsonb_build_object('operationId',p_operation,'kind','reschedule'));
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',p_viewing,'actorId',v_actor,'kind','reschedule',
  'expectedVersion',p_expected::text,'observedVersion',v_observed::text,'request',v_payload,'outcome',v_outcome,'reason',v_reason,'result',v_result,'completedAt',app_private.enquiry_utc(v_now));
 INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at)
  VALUES(v_tenant,p_operation,p_enquiry,v_actor,'reschedule',p_viewing,p_viewing,p_expected,v_payload,v_receipt,v_now);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_current_state_valid(app_private.viewings),app_api.reschedule_viewing(uuid,uuid,uuid,bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.reschedule_viewing(uuid,uuid,uuid,bigint,jsonb,text) TO api_runtime;
COMMIT;

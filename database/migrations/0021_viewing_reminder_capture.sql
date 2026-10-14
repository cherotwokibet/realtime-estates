BEGIN;
SET LOCAL ROLE realtor_owner;
-- Atomic SQL-only synthetic capture. No lease, remote adapter, recipient or provider send.
ALTER TABLE app_private.viewing_reminder_admissions ADD CONSTRAINT reminder_admission_attempt_identity UNIQUE(tenant_id,operation_id,enquiry_id,viewing_id,requester_id,expected_version);
CREATE TABLE app_private.viewing_reminder_attempts(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,admission_operation_id uuid NOT NULL,enquiry_id uuid NOT NULL,viewing_id uuid NOT NULL,requester_id uuid NOT NULL,
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),observed_version bigint NOT NULL CHECK(observed_version BETWEEN 1 AND 9007199254740991),
 captured_operation_id uuid,receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),created_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(created_at)),
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,admission_operation_id,operation_id),
 FOREIGN KEY(tenant_id,admission_operation_id,enquiry_id,viewing_id,requester_id,expected_version) REFERENCES app_private.viewing_reminder_admissions(tenant_id,operation_id,enquiry_id,viewing_id,requester_id,expected_version),
 FOREIGN KEY(tenant_id,admission_operation_id,captured_operation_id) REFERENCES app_private.viewing_reminder_attempts(tenant_id,admission_operation_id,operation_id)
);
CREATE FUNCTION app_private.viewing_reminder_attempt_valid(p app_private.viewing_reminder_attempts) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE r jsonb:=p.receipt;c jsonb;outcome text;reason text;
BEGIN
 IF r IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(r))<>13 OR NOT r ?& ARRAY['operationId','admissionOperationId','enquiryId','viewingId','actorId','kind','mode','expectedVersion','observedVersion','outcome','reason','capture','completedAt'] THEN RETURN false;END IF;
 IF r->>'operationId' IS DISTINCT FROM p.operation_id::text OR r->>'admissionOperationId' IS DISTINCT FROM p.admission_operation_id::text
  OR r->>'enquiryId' IS DISTINCT FROM p.enquiry_id::text OR r->>'viewingId' IS DISTINCT FROM p.viewing_id::text OR r->>'actorId' IS DISTINCT FROM p.requester_id::text
  OR r->>'kind' IS DISTINCT FROM 'capture_reminder' OR r->>'mode' IS DISTINCT FROM 'capture-only-v1'
  OR r->'expectedVersion' IS DISTINCT FROM to_jsonb(p.expected_version::text) OR r->'observedVersion' IS DISTINCT FROM to_jsonb(p.observed_version::text)
  OR r->>'completedAt' IS DISTINCT FROM app_private.enquiry_utc(p.created_at) THEN RETURN false;END IF;
 outcome:=r->>'outcome';reason:=r->>'reason';c:=r->'capture';
 IF outcome IN ('captured','duplicate') THEN
  IF c IS NULL OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(c))<>4 OR NOT c ?& ARRAY['operationId','admissionOperationId','viewingVersion','capturedAt'] THEN RETURN false;END IF;
  IF p.captured_operation_id IS NULL OR c->>'operationId' IS DISTINCT FROM p.captured_operation_id::text OR c->>'admissionOperationId' IS DISTINCT FROM p.admission_operation_id::text
   OR c->'viewingVersion' IS DISTINCT FROM to_jsonb(p.expected_version::text) OR jsonb_typeof(c->'capturedAt')<>'string'
   OR c->>'capturedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
   OR NOT app_private.enquiry_time_valid((c->>'capturedAt')::timestamptz) OR app_private.enquiry_utc((c->>'capturedAt')::timestamptz)<>c->>'capturedAt' THEN RETURN false;END IF;
  IF outcome='captured' THEN RETURN coalesce(p.observed_version=p.expected_version AND p.captured_operation_id=p.operation_id AND r->'reason'='null'::jsonb AND c->>'capturedAt'=app_private.enquiry_utc(p.created_at),false);END IF;
  RETURN coalesce(p.observed_version=p.expected_version AND p.captured_operation_id<>p.operation_id AND reason='ALREADY_CAPTURED' AND c->>'capturedAt'<=app_private.enquiry_utc(p.created_at),false);
 END IF;
 IF p.captured_operation_id IS NOT NULL OR c IS DISTINCT FROM 'null'::jsonb THEN RETURN false;END IF;
 IF outcome='waiting' THEN RETURN coalesce(reason='NOT_DUE' AND p.expected_version=p.observed_version,false);END IF;
 IF outcome='suppressed' THEN
  RETURN coalesce(reason IN ('TARGET_CHANGED','NOT_CONFIRMED','VERSION_CHANGED','CYCLE_CHANGED','SLOT_CHANGED','AGREEMENT_CHANGED','ENQUIRY_CLOSED','LISTING_UNAVAILABLE','CLOCK_BEFORE_RECORD','EXPIRED','SLOT_STARTED')
   AND (CASE WHEN reason='VERSION_CHANGED' THEN p.expected_version<>p.observed_version WHEN reason IN ('TARGET_CHANGED','NOT_CONFIRMED') THEN true ELSE p.expected_version=p.observed_version END),false);
 END IF;RETURN false;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END $$;
ALTER TABLE app_private.viewing_reminder_attempts ADD CHECK(app_private.viewing_reminder_attempt_valid(viewing_reminder_attempts));
CREATE UNIQUE INDEX viewing_reminder_one_capture ON app_private.viewing_reminder_attempts(tenant_id,admission_operation_id) WHERE receipt->>'outcome'='captured';
ALTER TABLE app_private.viewing_reminder_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.viewing_reminder_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.viewing_reminder_attempts TO realtor_owner USING(true) WITH CHECK(true);

CREATE FUNCTION app_private.viewing_reminder_capture_state(a app_private.viewing_reminder_admissions,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e app_private.enquiries;v app_private.viewings;l app_private.listings;eligible boolean;decision jsonb;
BEGIN
 IF a.receipt->>'outcome' IS DISTINCT FROM 'admitted' OR p_now IS NULL OR NOT app_private.enquiry_time_valid(p_now) THEN RAISE EXCEPTION 'Invalid capture admission' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM app_private.enquiries WHERE tenant_id=a.tenant_id AND id=a.enquiry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v FROM app_private.viewings WHERE tenant_id=a.tenant_id AND enquiry_id=a.enquiry_id AND id=a.viewing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=a.tenant_id AND id=v.listing_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 eligible:=l.publication_status='published' AND l.availability='available' AND l.archived_at IS NULL
  AND l.last_availability_confirmed_at IS NOT NULL AND l.last_availability_confirmed_at>p_now-interval '30 days'
  AND EXISTS(SELECT 1 FROM app_private.public_snapshots WHERE tenant_id=a.tenant_id AND listing_id=l.id AND revision_no=l.published_revision_no);
 decision:=app_private.evaluate_viewing_reminder(a.receipt->'candidate',v,e.status IN ('new','assigned','contacted','qualified'),eligible,p_now);
 IF p_now<a.created_at AND decision->>'state' IN ('eligible','waiting') THEN decision:=jsonb_build_object('state','suppressed','reason','CLOCK_BEFORE_RECORD');END IF;
 RETURN jsonb_build_object('decision',decision,'observedVersion',v.version::text);
END $$;

CREATE FUNCTION app_private.guard_viewing_reminder_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a app_private.viewing_reminder_admissions;state jsonb;fresh jsonb;source app_private.viewing_reminder_attempts;clock_at timestamptz;outcome text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Reminder attempt evidence is immutable' USING ERRCODE='23514';END IF;
 IF NEW.tenant_id IS DISTINCT FROM app_private.context_tenant() OR NEW.requester_id IS DISTINCT FROM app_private.context_actor() THEN RAISE EXCEPTION 'Attempt context mismatch' USING ERRCODE='42501';END IF;
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 SELECT * INTO a FROM app_private.viewing_reminder_admissions WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.admission_operation_id;
 IF NOT FOUND OR a.receipt->>'outcome' IS DISTINCT FROM 'admitted' THEN RAISE EXCEPTION 'Invalid capture admission' USING ERRCODE='23514';END IF;
 clock_at:=date_trunc('milliseconds',clock_timestamp());
 IF NEW.created_at<date_trunc('milliseconds',statement_timestamp()) OR NEW.created_at>clock_at THEN RAISE EXCEPTION 'Capture clock must come from this statement' USING ERRCODE='23514';END IF;
 state:=app_private.viewing_reminder_capture_state(a,NEW.created_at);outcome:=NEW.receipt->>'outcome';
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF NOT EXISTS(SELECT 1 FROM app_private.enquiries e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.enquiry_id AND app_private.may_work(NEW.tenant_id,e.assigned_agent_id)) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF NEW.observed_version::text<>state->>'observedVersion' THEN RAISE EXCEPTION 'Capture observed version mismatch' USING ERRCODE='23514';END IF;
 IF outcome IN ('captured','duplicate') THEN
  clock_at:=date_trunc('milliseconds',clock_timestamp());
  fresh:=app_private.viewing_reminder_capture_state(a,clock_at);
  IF state->'decision'->>'state'<>'eligible' OR fresh->'decision'->>'state'<>'eligible' THEN RAISE EXCEPTION 'Capture is no longer eligible' USING ERRCODE='23514';END IF;
  IF outcome='duplicate' THEN
   SELECT * INTO source FROM app_private.viewing_reminder_attempts WHERE tenant_id=NEW.tenant_id AND admission_operation_id=NEW.admission_operation_id AND operation_id=NEW.captured_operation_id;
   IF NOT FOUND OR source.receipt->>'outcome'<>'captured' OR NEW.receipt->'capture' IS DISTINCT FROM source.receipt->'capture' THEN RAISE EXCEPTION 'Duplicate capture evidence mismatch' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF outcome IN ('waiting','suppressed') THEN
  IF state->'decision'->>'state'<>outcome OR state->'decision'->>'reason' IS DISTINCT FROM NEW.receipt->>'reason' THEN RAISE EXCEPTION 'Capture decision mismatch' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Invalid capture attempt outcome' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_viewing_reminder_attempt BEFORE INSERT OR UPDATE OR DELETE ON app_private.viewing_reminder_attempts FOR EACH ROW EXECUTE FUNCTION app_private.guard_viewing_reminder_attempt();

CREATE FUNCTION app_api.capture_viewing_reminder(p_enquiry uuid,p_admission uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=app_private.context_tenant();actor uuid:=app_private.context_actor();e app_private.enquiries;a app_private.viewing_reminder_admissions;
 original app_private.viewing_reminder_attempts;source app_private.viewing_reminder_attempts;state jsonb;v_receipt jsonb;capture jsonb;clock_at timestamptz;outcome text;reason text;captured_id uuid;observed bigint;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_admission IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'Invalid reminder capture command' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM app_private.enquiries WHERE tenant_id=tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(tenant,e.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO a FROM app_private.viewing_reminder_admissions WHERE tenant_id=tenant AND enquiry_id=p_enquiry AND operation_id=p_admission AND requester_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF a.receipt->>'outcome'<>'admitted' THEN RAISE EXCEPTION 'Admission has no candidate' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM app_private.viewings WHERE tenant_id=tenant AND enquiry_id=p_enquiry AND id=a.viewing_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text||'/reminder-attempt/'||p_operation::text,0));
 SELECT * INTO original FROM app_private.viewing_reminder_attempts WHERE tenant_id=tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF original.enquiry_id<>p_enquiry OR original.admission_operation_id<>p_admission OR original.requester_id<>actor THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN original.receipt;
 END IF;
 -- Acquire the listing lock too before choosing the authoritative decision clock.
 clock_at:=date_trunc('milliseconds',clock_timestamp());PERFORM app_private.viewing_reminder_capture_state(a,clock_at);
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF NOT app_private.may_work(tenant,e.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 clock_at:=date_trunc('milliseconds',clock_timestamp());state:=app_private.viewing_reminder_capture_state(a,clock_at);observed:=(state->>'observedVersion')::bigint;
 outcome:=state->'decision'->>'state';reason:=state->'decision'->>'reason';
 IF outcome='eligible' THEN
  SELECT t.* INTO source FROM app_private.viewing_reminder_attempts t WHERE t.tenant_id=tenant AND t.admission_operation_id=p_admission AND t.receipt->>'outcome'='captured';
  IF FOUND THEN outcome:='duplicate';reason:='ALREADY_CAPTURED';capture:=source.receipt->'capture';captured_id:=source.operation_id;
  ELSE
   outcome:='captured';captured_id:=p_operation;
   capture:=jsonb_build_object('operationId',p_operation,'admissionOperationId',p_admission,'viewingVersion',a.expected_version::text,'capturedAt',app_private.enquiry_utc(clock_at));
   PERFORM app_private.audit('viewing.reminder_captured','viewing',a.viewing_id,observed,jsonb_build_object('operationId',p_operation,'admissionOperationId',p_admission,'mode','capture-only-v1'));
  END IF;
 END IF;
 v_receipt:=jsonb_build_object('operationId',p_operation,'admissionOperationId',p_admission,'enquiryId',p_enquiry,'viewingId',a.viewing_id,'actorId',actor,
  'kind','capture_reminder','mode','capture-only-v1','expectedVersion',a.expected_version::text,'observedVersion',observed::text,'outcome',outcome,'reason',reason,'capture',capture,'completedAt',app_private.enquiry_utc(clock_at));
 INSERT INTO app_private.viewing_reminder_attempts(tenant_id,operation_id,admission_operation_id,enquiry_id,viewing_id,requester_id,expected_version,observed_version,captured_operation_id,receipt,created_at)
  VALUES(tenant,p_operation,p_admission,p_enquiry,a.viewing_id,actor,a.expected_version,observed,captured_id,v_receipt,clock_at);
 RETURN v_receipt;
END $$;
CREATE FUNCTION app_api.read_viewing_reminder_attempt(p_enquiry uuid,p_admission uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=app_private.context_tenant();actor uuid:=app_private.context_actor();e app_private.enquiries;original app_private.viewing_reminder_attempts;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 SELECT * INTO e FROM app_private.enquiries WHERE tenant_id=tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(tenant,e.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO original FROM app_private.viewing_reminder_attempts WHERE tenant_id=tenant AND enquiry_id=p_enquiry AND admission_operation_id=p_admission AND operation_id=p_operation AND requester_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN original.receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_reminder_attempt_valid(app_private.viewing_reminder_attempts),app_private.viewing_reminder_capture_state(app_private.viewing_reminder_admissions,timestamptz),app_private.guard_viewing_reminder_attempt(),app_api.capture_viewing_reminder(uuid,uuid,uuid),app_api.read_viewing_reminder_attempt(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.capture_viewing_reminder(uuid,uuid,uuid),app_api.read_viewing_reminder_attempt(uuid,uuid,uuid) TO api_runtime;
COMMIT;

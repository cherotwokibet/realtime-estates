BEGIN;
SET LOCAL ROLE realtor_owner;
-- Capture-only admission. No delivery claim, recipient or provider dispatch is enabled.
ALTER TABLE app_private.viewings ADD CONSTRAINT viewings_reminder_target_key UNIQUE(tenant_id,enquiry_id,id,listing_id);
CREATE TABLE app_private.viewing_reminder_admissions(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,enquiry_id uuid NOT NULL,viewing_id uuid NOT NULL,listing_id uuid NOT NULL,requester_id uuid NOT NULL,
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),
 due_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(due_at)),
 expires_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(expires_at) AND expires_at>due_at),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),created_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(created_at)),
 PRIMARY KEY(tenant_id,operation_id),FOREIGN KEY(tenant_id,enquiry_id,viewing_id,listing_id) REFERENCES app_private.viewings(tenant_id,enquiry_id,id,listing_id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE FUNCTION app_private.viewing_reminder_admission_valid(p app_private.viewing_reminder_admissions) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE r jsonb:=p.receipt;c jsonb;observed bigint;outcome text;reason text;
BEGIN
 IF (SELECT count(*) FROM jsonb_object_keys(r))<>13 OR NOT r ?& ARRAY['operationId','enquiryId','viewingId','actorId','kind','mode','expectedVersion','observedVersion','request','outcome','reason','candidate','completedAt'] THEN RETURN false;END IF;
 IF r->>'operationId' IS DISTINCT FROM p.operation_id::text OR r->>'enquiryId' IS DISTINCT FROM p.enquiry_id::text
  OR r->>'viewingId' IS DISTINCT FROM p.viewing_id::text OR r->>'actorId' IS DISTINCT FROM p.requester_id::text
  OR r->>'kind' IS DISTINCT FROM 'admit_reminder' OR r->>'mode' IS DISTINCT FROM 'capture-only-v1'
  OR r->>'expectedVersion' IS DISTINCT FROM p.expected_version::text OR jsonb_typeof(r->'expectedVersion')<>'string'
  OR r->>'completedAt' IS DISTINCT FROM app_private.enquiry_utc(p.created_at)
  OR r->'request' IS DISTINCT FROM jsonb_build_object('dueAt',app_private.enquiry_utc(p.due_at),'expiresAt',app_private.enquiry_utc(p.expires_at)) THEN RETURN false;END IF;
 IF jsonb_typeof(r->'observedVersion')<>'string' OR r->>'observedVersion' !~ '^[1-9][0-9]{0,15}$' THEN RETURN false;END IF;
 observed:=(r->>'observedVersion')::bigint;
 IF observed>9007199254740991 OR observed::text<>r->>'observedVersion' THEN RETURN false;END IF;
 outcome:=r->>'outcome';reason:=r->>'reason';c:=r->'candidate';
 IF outcome='admitted' THEN
  RETURN coalesce(observed=p.expected_version AND r->'reason'='null'::jsonb AND app_private.viewing_reminder_candidate_valid(c)
   AND c->>'enquiryId'=p.enquiry_id::text AND c->>'viewingId'=p.viewing_id::text AND c->>'listingId'=p.listing_id::text
   AND c->>'viewingVersion'=p.expected_version::text AND c->>'dueAt'=app_private.enquiry_utc(p.due_at)
   AND c->>'expiresAt'=app_private.enquiry_utc(p.expires_at) AND c->>'confirmationRecordedAt'<=app_private.enquiry_utc(p.created_at)
   AND p.expires_at>p.created_at AND c->'slot'->>'startAt'>app_private.enquiry_utc(p.created_at),false);
 ELSIF outcome='conflict' THEN RETURN coalesce(observed<>p.expected_version AND reason='VERSION_CONFLICT' AND c='null'::jsonb,false);
 ELSIF outcome='refused' THEN RETURN coalesce(observed=p.expected_version AND reason IN ('ENQUIRY_CLOSED','LISTING_UNAVAILABLE','INVALID_STATE','RECORD_TIME_IN_FUTURE','SLOT_STARTED','WINDOW_EXPIRED','WINDOW_BEFORE_CONFIRMATION','WINDOW_OUTSIDE_SLOT','ALREADY_ADMITTED') AND c='null'::jsonb,false);
 END IF;RETURN false;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END $$;
ALTER TABLE app_private.viewing_reminder_admissions ADD CHECK(app_private.viewing_reminder_admission_valid(viewing_reminder_admissions));
CREATE UNIQUE INDEX viewing_reminder_one_admission ON app_private.viewing_reminder_admissions(tenant_id,viewing_id,expected_version,due_at,expires_at) WHERE receipt->>'outcome'='admitted';
CREATE TRIGGER immutable_viewing_reminder_admission BEFORE UPDATE OR DELETE ON app_private.viewing_reminder_admissions FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
ALTER TABLE app_private.viewing_reminder_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.viewing_reminder_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.viewing_reminder_admissions TO realtor_owner USING(true) WITH CHECK(true);

CREATE FUNCTION app_api.admit_viewing_reminder(p_enquiry uuid,p_viewing uuid,p_operation uuid,p_expected bigint,p_due timestamptz,p_expires timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=app_private.context_tenant();actor uuid:=app_private.context_actor();e app_private.enquiries;v app_private.viewings;l app_private.listings;
 original app_private.viewing_reminder_admissions;s jsonb;c jsonb;r jsonb;clock_at timestamptz;outcome text:='admitted';reason text;confirmed_at timestamptz;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_viewing IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991
  OR p_due IS NULL OR p_expires IS NULL OR NOT app_private.enquiry_time_valid(p_due) OR NOT app_private.enquiry_time_valid(p_expires) OR p_due>=p_expires
  THEN RAISE EXCEPTION 'Invalid viewing reminder admission' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM app_private.enquiries WHERE tenant_id=tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(tenant,e.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v FROM app_private.viewings WHERE tenant_id=tenant AND enquiry_id=p_enquiry AND id=p_viewing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text||'/viewing-reminder/'||p_operation::text,0));
 SELECT * INTO original FROM app_private.viewing_reminder_admissions WHERE tenant_id=tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF original.enquiry_id<>p_enquiry OR original.viewing_id<>p_viewing OR original.requester_id<>actor OR original.expected_version<>p_expected
   OR original.due_at<>p_due OR original.expires_at<>p_expires THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN original.receipt;
 END IF;
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=tenant AND id=v.listing_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 clock_at:=date_trunc('milliseconds',clock_timestamp());s:=app_private.viewing_snapshot(v);
 confirmed_at:=CASE WHEN v.current_cycle IS NULL THEN v.confirmed_at ELSE (v.current_cycle->>'confirmedAt')::timestamptz END;
 IF p_expected<>v.version THEN outcome:='conflict';reason:='VERSION_CONFLICT';
 ELSIF e.status NOT IN ('new','assigned','contacted','qualified') THEN outcome:='refused';reason:='ENQUIRY_CLOSED';
 ELSIF l.publication_status<>'published' OR l.availability<>'available' OR l.archived_at IS NOT NULL
  OR l.last_availability_confirmed_at IS NULL OR l.last_availability_confirmed_at<=clock_at-interval '30 days'
  OR NOT EXISTS(SELECT 1 FROM app_private.public_snapshots WHERE tenant_id=tenant AND listing_id=l.id AND revision_no=l.published_revision_no)
  THEN outcome:='refused';reason:='LISTING_UNAVAILABLE';
 ELSIF v.status<>'confirmed' OR confirmed_at IS NULL THEN outcome:='refused';reason:='INVALID_STATE';
 ELSIF v.updated_at>clock_at THEN outcome:='refused';reason:='RECORD_TIME_IN_FUTURE';
 ELSIF s->'proposedSlot'->>'startAt'<=app_private.enquiry_utc(clock_at) THEN outcome:='refused';reason:='SLOT_STARTED';
 ELSIF p_expires<=clock_at THEN outcome:='refused';reason:='WINDOW_EXPIRED';
 ELSIF p_due<confirmed_at THEN outcome:='refused';reason:='WINDOW_BEFORE_CONFIRMATION';
 ELSIF p_expires>(s->'proposedSlot'->>'startAt')::timestamptz THEN outcome:='refused';reason:='WINDOW_OUTSIDE_SLOT';
 ELSIF EXISTS(SELECT 1 FROM app_private.viewing_reminder_admissions WHERE tenant_id=tenant AND viewing_id=p_viewing AND expected_version=p_expected AND due_at=p_due AND expires_at=p_expires AND receipt->>'outcome'='admitted') THEN outcome:='refused';reason:='ALREADY_ADMITTED';
 ELSE
  c:=jsonb_build_object('enquiryId',p_enquiry,'viewingId',p_viewing,'listingId',v.listing_id,'viewingVersion',v.version::text,
   'cycleNumber',coalesce(v.current_cycle->>'number','1'),'slot',s->'proposedSlot','confirmationRecordedAt',app_private.enquiry_utc(confirmed_at),
   'agreedAt',s->'agreement'->>'agreedAt','dueAt',app_private.enquiry_utc(p_due),'expiresAt',app_private.enquiry_utc(p_expires));
  PERFORM app_private.audit('viewing.reminder_admitted','viewing',p_viewing,v.version,jsonb_build_object('operationId',p_operation,'mode','capture-only-v1'));
 END IF;
 r:=jsonb_build_object('operationId',p_operation,'enquiryId',p_enquiry,'viewingId',p_viewing,'actorId',actor,'kind','admit_reminder','mode','capture-only-v1',
  'expectedVersion',p_expected::text,'observedVersion',v.version::text,'request',jsonb_build_object('dueAt',app_private.enquiry_utc(p_due),'expiresAt',app_private.enquiry_utc(p_expires)),
  'outcome',outcome,'reason',reason,'candidate',c,'completedAt',app_private.enquiry_utc(clock_at));
 INSERT INTO app_private.viewing_reminder_admissions(tenant_id,operation_id,enquiry_id,viewing_id,listing_id,requester_id,expected_version,due_at,expires_at,receipt,created_at)
  VALUES(tenant,p_operation,p_enquiry,p_viewing,v.listing_id,actor,p_expected,p_due,p_expires,r,clock_at);
 RETURN r;
END $$;
CREATE FUNCTION app_api.read_viewing_reminder_admission(p_enquiry uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=app_private.context_tenant();actor uuid:=app_private.context_actor();e app_private.enquiries;original app_private.viewing_reminder_admissions;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 SELECT * INTO e FROM app_private.enquiries WHERE tenant_id=tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(tenant,e.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO original FROM app_private.viewing_reminder_admissions WHERE tenant_id=tenant AND enquiry_id=p_enquiry AND operation_id=p_operation AND requester_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN original.receipt;
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_reminder_admission_valid(app_private.viewing_reminder_admissions),app_api.admit_viewing_reminder(uuid,uuid,uuid,bigint,timestamptz,timestamptz),app_api.read_viewing_reminder_admission(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.admit_viewing_reminder(uuid,uuid,uuid,bigint,timestamptz,timestamptz),app_api.read_viewing_reminder_admission(uuid,uuid) TO api_runtime;
COMMIT;

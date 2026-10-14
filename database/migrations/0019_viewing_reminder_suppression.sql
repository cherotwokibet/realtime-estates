BEGIN;
SET LOCAL ROLE realtor_owner;
-- Private planning primitives only. No public/runtime invocation, queue or provider dispatch.
CREATE FUNCTION app_private.viewing_reminder_candidate_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text;t timestamptz;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>10 OR NOT p ?& ARRAY['enquiryId','viewingId','listingId','viewingVersion','cycleNumber','slot','confirmationRecordedAt','agreedAt','dueAt','expiresAt'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['enquiryId','viewingId','listingId'] LOOP
  IF jsonb_typeof(p->k)<>'string' OR char_length(p->>k)<>36 OR p->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false;END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['viewingVersion','cycleNumber'] LOOP
  IF jsonb_typeof(p->k)<>'string' OR p->>k !~ '^[1-9][0-9]{0,15}$' THEN RETURN false;END IF;
  IF (p->>k)::bigint>9007199254740991 OR (p->>k)::bigint::text<>p->>k THEN RETURN false;END IF;
 END LOOP;
 IF NOT app_private.viewing_slot_valid(p->'slot') THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['confirmationRecordedAt','agreedAt','dueAt','expiresAt'] LOOP
  IF jsonb_typeof(p->k)<>'string' OR p->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RETURN false;END IF;
  t:=(p->>k)::timestamptz;
  IF NOT app_private.enquiry_time_valid(t) OR app_private.enquiry_utc(t)<>p->>k THEN RETURN false;END IF;
 END LOOP;
 RETURN coalesce(p->>'agreedAt'<=p->>'confirmationRecordedAt' AND p->>'confirmationRecordedAt'<=p->>'dueAt'
  AND p->>'dueAt'<p->>'expiresAt' AND p->>'expiresAt'<=p->'slot'->>'startAt',false);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END $$;

-- Future protected claims must load/lock authoritative rows and pass their own server clock.
-- This pure helper does not infer tenant scope, recipient consent, delivery or authorization.
CREATE FUNCTION app_private.evaluate_viewing_reminder(p jsonb,v app_private.viewings,p_enquiry_open boolean,p_listing_available boolean,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE s jsonb;clock_text text;reason text;confirmation_time text;agreement_time text;
BEGIN
 IF NOT app_private.viewing_reminder_candidate_valid(p) OR v.tenant_id IS NULL OR NOT app_private.viewing_current_state_valid(v)
  OR p_enquiry_open IS NULL OR p_listing_available IS NULL OR p_now IS NULL OR NOT app_private.enquiry_time_valid(p_now) THEN
  RAISE EXCEPTION 'Invalid viewing reminder planning facts' USING ERRCODE='23514';
 END IF;
 s:=app_private.viewing_snapshot(v);clock_text:=app_private.enquiry_utc(p_now);
 confirmation_time:=CASE WHEN v.current_cycle IS NULL THEN app_private.enquiry_utc(v.confirmed_at) ELSE v.current_cycle->>'confirmedAt' END;
 agreement_time:=s->'agreement'->>'agreedAt';
 IF p->>'enquiryId'<>v.enquiry_id::text OR p->>'viewingId'<>v.id::text OR p->>'listingId'<>v.listing_id::text THEN reason:='TARGET_CHANGED';
 ELSIF v.status<>'confirmed' OR s->'proposedSlot' IS NULL OR agreement_time IS NULL OR confirmation_time IS NULL THEN reason:='NOT_CONFIRMED';
 ELSIF p->>'viewingVersion'<>v.version::text THEN reason:='VERSION_CHANGED';
 ELSIF p->>'cycleNumber'<>coalesce(v.current_cycle->>'number','1') THEN reason:='CYCLE_CHANGED';
 ELSIF p->'slot' IS DISTINCT FROM s->'proposedSlot' THEN reason:='SLOT_CHANGED';
 ELSIF p->>'confirmationRecordedAt'<>confirmation_time OR p->>'agreedAt'<>agreement_time THEN reason:='AGREEMENT_CHANGED';
 ELSIF NOT p_enquiry_open THEN reason:='ENQUIRY_CLOSED';
 ELSIF NOT p_listing_available THEN reason:='LISTING_UNAVAILABLE';
 ELSIF p_now<v.updated_at THEN reason:='CLOCK_BEFORE_RECORD';
 ELSIF clock_text>=s->'proposedSlot'->>'startAt' THEN reason:='SLOT_STARTED';
 ELSIF clock_text>=p->>'expiresAt' THEN reason:='EXPIRED';
 ELSIF clock_text<p->>'dueAt' THEN RETURN jsonb_build_object('state','waiting','reason','NOT_DUE');
 ELSE RETURN jsonb_build_object('state','eligible','reason',NULL);
 END IF;
 RETURN jsonb_build_object('state','suppressed','reason',reason);
END $$;
REVOKE ALL ON FUNCTION app_private.viewing_reminder_candidate_valid(jsonb),app_private.evaluate_viewing_reminder(jsonb,app_private.viewings,boolean,boolean,timestamptz) FROM PUBLIC,api_runtime;
COMMIT;

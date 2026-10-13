BEGIN;
-- Repair the preceding local-only read function ownership without rewriting history.
ALTER FUNCTION app_api.list_enquiry_activity(uuid,integer) OWNER TO realtor_owner;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.contact_notes_valid(p_notes text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(char_length(p_notes) BETWEEN 1 AND 2000 AND char_length(btrim(p_notes,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))>0
   AND p_notes !~ U&'[\0001-\0008\000b\000c\000e-\001f\007f-\009f]',false)
$$;
CREATE TABLE app_private.enquiry_contacts (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,enquiry_id uuid NOT NULL,requester_id uuid NOT NULL,
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),
 observed_version bigint NOT NULL CHECK(observed_version BETWEEN 1 AND 9007199254740991),
 channel text NOT NULL CHECK(channel IN ('call','whatsapp','email','in_person','other')),
 outcome text NOT NULL CHECK(outcome IN ('connected','no_response','left_message','wrong_contact','other')),
 occurred_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(occurred_at)),
 notes text NOT NULL CHECK(app_private.contact_notes_valid(notes)),
 recorded_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(recorded_at)),
 applied boolean NOT NULL CHECK(applied=(expected_version=observed_version)),
 CHECK(occurred_at<=recorded_at),PRIMARY KEY(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,enquiry_id) REFERENCES app_private.enquiries(tenant_id,id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE INDEX enquiry_contacts_lookup ON app_private.enquiry_contacts(tenant_id,enquiry_id,recorded_at DESC,operation_id);
CREATE TRIGGER immutable_enquiry_contact BEFORE UPDATE OR DELETE ON app_private.enquiry_contacts
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
ALTER TABLE app_private.enquiry_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.enquiry_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.enquiry_contacts TO realtor_owner USING(true) WITH CHECK(true);
CREATE FUNCTION app_private.contact_entry(p_contact app_private.enquiry_contacts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('entryId',p_contact.operation_id,'actorId',p_contact.requester_id,'channel',p_contact.channel,
 'outcome',p_contact.outcome,'occurredAt',app_private.enquiry_utc(p_contact.occurred_at),
 'notes',p_contact.notes,'recordedAt',app_private.enquiry_utc(p_contact.recorded_at))
$$;
CREATE FUNCTION app_private.contact_receipt(p_contact app_private.enquiry_contacts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('operationId',p_contact.operation_id,'enquiryId',p_contact.enquiry_id,'actorId',p_contact.requester_id,
 'expectedVersion',p_contact.expected_version::text,'observedVersion',p_contact.observed_version::text,
 'request',jsonb_build_object('channel',p_contact.channel,'outcome',p_contact.outcome,'occurredAt',app_private.enquiry_utc(p_contact.occurred_at),'notes',p_contact.notes),
 'outcome',CASE WHEN p_contact.applied THEN 'applied' ELSE 'conflict' END,
 'reason',CASE WHEN p_contact.applied THEN NULL ELSE 'VERSION_CONFLICT' END,
 'entry',CASE WHEN p_contact.applied THEN app_private.contact_entry(p_contact) ELSE NULL END,
 'completedAt',app_private.enquiry_utc(p_contact.recorded_at))
$$;
CREATE FUNCTION app_api.record_enquiry_contact(p_enquiry uuid,p_operation uuid,p_expected bigint,p_channel text,
 p_outcome text,p_occurred timestamptz,p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_actor uuid:=app_private.context_actor();
 v_enquiry app_private.enquiries;v_contact app_private.enquiry_contacts;v_now timestamptz;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_enquiry IS NULL OR p_operation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740991
  OR p_channel IS NULL OR p_channel NOT IN ('call','whatsapp','email','in_person','other')
  OR p_outcome IS NULL OR p_outcome NOT IN ('connected','no_response','left_message','wrong_contact','other')
  OR NOT app_private.enquiry_time_valid(p_occurred) OR NOT app_private.contact_notes_valid(p_notes) THEN
  RAISE EXCEPTION 'Invalid contact entry' USING ERRCODE='23514';END IF;
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry FOR UPDATE;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN
  RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/contact/' || p_operation::text,0));
 SELECT * INTO v_contact FROM app_private.enquiry_contacts WHERE tenant_id=v_tenant AND operation_id=p_operation;
 IF FOUND THEN
  IF v_contact.enquiry_id<>p_enquiry OR v_contact.requester_id<>v_actor OR v_contact.expected_version<>p_expected
   OR v_contact.channel<>p_channel OR v_contact.outcome<>p_outcome OR v_contact.occurred_at<>p_occurred
   OR v_contact.notes IS DISTINCT FROM p_notes THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN app_private.contact_receipt(v_contact);
 END IF;
 v_now:=date_trunc('milliseconds',clock_timestamp());
 IF p_occurred>v_now THEN RAISE EXCEPTION 'Contact must already have occurred' USING ERRCODE='23514';END IF;
 INSERT INTO app_private.enquiry_contacts(tenant_id,operation_id,enquiry_id,requester_id,expected_version,observed_version,
  channel,outcome,occurred_at,notes,recorded_at,applied)
 VALUES(v_tenant,p_operation,p_enquiry,v_actor,p_expected,v_enquiry.version,p_channel,p_outcome,p_occurred,p_notes,v_now,p_expected=v_enquiry.version)
 RETURNING * INTO v_contact;
 IF v_contact.applied THEN PERFORM app_private.audit('enquiry.contact_recorded','enquiry',p_enquiry,v_enquiry.version,
  jsonb_build_object('operationId',p_operation,'channel',p_channel,'outcome',p_outcome));END IF;
 RETURN app_private.contact_receipt(v_contact);
END $$;
CREATE FUNCTION app_api.read_enquiry_contact(p_enquiry uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_enquiry app_private.enquiries;v_contact app_private.enquiry_contacts;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO v_contact FROM app_private.enquiry_contacts WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry
  AND operation_id=p_operation AND requester_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN app_private.contact_receipt(v_contact);
END $$;
CREATE FUNCTION app_api.list_enquiry_contacts(p_enquiry uuid,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_tenant uuid:=app_private.context_tenant();v_enquiry app_private.enquiries;v_items jsonb;v_count integer;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='23514';END IF;
 SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=v_tenant AND id=p_enquiry;
 IF NOT FOUND OR NOT app_private.may_work(v_tenant,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY recorded_at DESC,operation_id) FILTER(WHERE position<=p_limit),'[]'::jsonb),count(*)
 INTO v_items,v_count FROM (
  SELECT app_private.contact_entry(contact) AS item,recorded_at,operation_id,row_number() OVER(ORDER BY recorded_at DESC,operation_id) AS position
  FROM (SELECT c AS contact,c.recorded_at,c.operation_id FROM app_private.enquiry_contacts c WHERE tenant_id=v_tenant AND enquiry_id=p_enquiry AND applied
   ORDER BY recorded_at DESC,operation_id LIMIT p_limit+1) bounded
 ) numbered;
 RETURN jsonb_build_object('items',v_items,'limit',p_limit,'truncated',v_count>p_limit);
END $$;
REVOKE ALL ON FUNCTION app_private.contact_notes_valid(text),app_private.contact_entry(app_private.enquiry_contacts),
 app_private.contact_receipt(app_private.enquiry_contacts) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_api.record_enquiry_contact(uuid,uuid,bigint,text,text,timestamptz,text),
 app_api.read_enquiry_contact(uuid,uuid),app_api.list_enquiry_contacts(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.record_enquiry_contact(uuid,uuid,bigint,text,text,timestamptz,text),
 app_api.read_enquiry_contact(uuid,uuid),app_api.list_enquiry_contacts(uuid,integer) TO api_runtime;
COMMIT;

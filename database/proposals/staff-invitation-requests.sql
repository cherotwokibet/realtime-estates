-- Isolated capture-only invitation candidate. Requires staff-branches.sql; never grants membership or sends mail.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.staff_invitation_requests (
 tenant_id uuid NOT NULL REFERENCES app_private.tenants(id),operation_id uuid NOT NULL,actor_id uuid NOT NULL,
 recipient_email text NOT NULL,requested_role text NOT NULL CHECK(requested_role IN ('agent','admin')),
 branch_operation_id uuid,expires_after_hours integer NOT NULL CHECK(expires_after_hours IN (24,72,168)),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(tenant_id,operation_id),FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,branch_operation_id) REFERENCES app_private.staff_branch_operations(tenant_id,operation_id),
 CHECK(requested_role<>'admin' OR branch_operation_id IS NULL)
);
CREATE TABLE app_private.staff_invitation_revocations (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,invitation_id uuid NOT NULL,actor_id uuid NOT NULL,
 expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740990),
 observed_version bigint NOT NULL CHECK(observed_version IN (1,2)),reason text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('revoked','already_revoked','expired','conflict')),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(tenant_id,operation_id),FOREIGN KEY(tenant_id,invitation_id) REFERENCES app_private.staff_invitation_requests(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE UNIQUE INDEX staff_invitation_once_revoked ON app_private.staff_invitation_revocations(tenant_id,invitation_id) WHERE outcome='revoked';
ALTER TABLE app_private.staff_invitation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_invitation_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_invitation_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_invitation_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.staff_invitation_requests TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON app_private.staff_invitation_revocations TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_invitation_request BEFORE UPDATE OR DELETE ON app_private.staff_invitation_requests FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
CREATE TRIGGER immutable_invitation_revocation BEFORE UPDATE OR DELETE ON app_private.staff_invitation_revocations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.staff_invitation_requests,app_private.staff_invitation_revocations FROM PUBLIC,api_runtime,media_coordinator,media_maintenance;
CREATE FUNCTION app_private.staff_invitation_email_valid(v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ DECLARE l text;d text;label text; BEGIN
 IF v IS NULL OR char_length(v)>254 OR v<>lower(v) OR char_length(v)-char_length(replace(v,'@',''))<>1 THEN RETURN false; END IF;
 l:=split_part(v,'@',1);d:=split_part(v,'@',2);
 IF char_length(l) NOT BETWEEN 1 AND 64 OR l!~'^[a-z0-9!#$%&''*+/=?^_`{|}~.-]+$' OR l LIKE '.%' OR l LIKE '%.' OR position('..' in l)>0 OR position('.' in d)=0 THEN RETURN false; END IF;
 FOREACH label IN ARRAY string_to_array(d,'.') LOOP
  IF char_length(label) NOT BETWEEN 1 AND 63 OR label!~'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' THEN RETURN false; END IF;
 END LOOP;RETURN true;
END $$;
CREATE FUNCTION app_private.staff_invitation_request_json(r app_private.staff_invitation_requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object(
 'policy','staff-invitation-request-record-v1','operationId',r.operation_id,'actorId',r.actor_id,
 'recipientEmail',r.recipient_email,'requestedRole',r.requested_role,'expiresAfterHours',r.expires_after_hours,
 'branch',(SELECT jsonb_build_object('branchId',b.branch_id,'version',b.observed_version::text,'name',b.name) FROM app_private.staff_branch_operations b WHERE b.tenant_id=r.tenant_id AND b.operation_id=r.branch_operation_id),
 'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'expiresAt',to_char((r.recorded_at+make_interval(hours=>r.expires_after_hours)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'status','recorded','delivery','not_attempted','membershipGranted',false) $$;
CREATE FUNCTION app_api.record_staff_invitation_request(p_operation uuid,p_email text,p_role text,p_branch uuid,p_hours integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.staff_invitation_requests;b app_private.staff_branch_operations;old_branch uuid;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_operation IS NULL OR NOT app_private.staff_invitation_email_valid(p_email) OR p_role IS NULL OR p_role NOT IN ('agent','admin') OR p_hours IS NULL OR p_hours NOT IN (24,72,168) OR (p_role='admin' AND p_branch IS NOT NULL)
 THEN RAISE EXCEPTION 'Invalid invitation intent' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':staff-invitation:'||p_operation::text,0));
 SELECT * INTO r FROM app_private.staff_invitation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
 IF FOUND THEN
  IF r.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  SELECT branch_id INTO old_branch FROM app_private.staff_branch_operations WHERE tenant_id=r.tenant_id AND operation_id=r.branch_operation_id;
  IF ROW(r.recipient_email,r.requested_role,old_branch,r.expires_after_hours) IS DISTINCT FROM ROW(p_email,p_role,p_branch,p_hours) THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  RETURN app_private.staff_invitation_request_json(r);
 END IF;
 IF p_branch IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':staff-branch:'||p_branch::text,0));
  SELECT * INTO b FROM app_private.staff_branch_operations WHERE tenant_id=app_private.context_tenant() AND branch_id=p_branch AND outcome='applied' ORDER BY observed_version DESC LIMIT 1;
  IF NOT FOUND OR NOT b.active THEN RAISE EXCEPTION 'Active branch unavailable' USING ERRCODE='P0002'; END IF;
 END IF;
 INSERT INTO app_private.staff_invitation_requests(tenant_id,operation_id,actor_id,recipient_email,requested_role,branch_operation_id,expires_after_hours)
 VALUES(app_private.context_tenant(),p_operation,app_private.context_actor(),p_email,p_role,b.operation_id,p_hours) RETURNING * INTO r;
 PERFORM app_private.audit('staff.invitation_request_recorded','staff_invitation',p_operation,1);
 RETURN app_private.staff_invitation_request_json(r);
END $$;
CREATE FUNCTION app_api.read_staff_invitation_request(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_invitation_requests; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_invitation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.staff_invitation_request_json(r);
END $$;
CREATE FUNCTION app_private.staff_invitation_revocation_json(r app_private.staff_invitation_revocations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('policy','staff-invitation-revocation-record-v1',
 'operationId',r.operation_id,'invitationId',r.invitation_id,'actorId',r.actor_id,'expectedVersion',r.expected_version::text,
 'version',r.observed_version::text,'reason',r.reason,'outcome',r.outcome,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) $$;
CREATE FUNCTION app_api.revoke_staff_invitation_request(p_operation uuid,p_invitation uuid,p_expected bigint,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.staff_invitation_revocations;i app_private.staff_invitation_requests;actual bigint;kind text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_operation IS NULL OR p_invitation IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990 OR p_reason IS NULL OR p_reason<>btrim(p_reason) OR char_length(p_reason) NOT BETWEEN 1 AND 500 OR p_reason<>normalize(p_reason,NFC) OR p_reason~'[[:cntrl:]<>]' OR p_reason~U&'[\202A-\202E\2066-\2069]'
 THEN RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':staff-invitation-revoke-op:'||p_operation::text,0));
 SELECT * INTO r FROM app_private.staff_invitation_revocations WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
 IF FOUND THEN
  IF r.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF ROW(r.invitation_id,r.expected_version,r.reason) IS DISTINCT FROM ROW(p_invitation,p_expected,p_reason) THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  RETURN app_private.staff_invitation_revocation_json(r);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':staff-invitation:'||p_invitation::text,0));
 SELECT * INTO i FROM app_private.staff_invitation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_invitation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 actual:=CASE WHEN EXISTS(SELECT 1 FROM app_private.staff_invitation_revocations WHERE tenant_id=i.tenant_id AND invitation_id=p_invitation AND outcome='revoked') THEN 2 ELSE 1 END;
 IF p_expected<>actual THEN kind:='conflict';
 ELSIF actual=2 THEN kind:='already_revoked';
 ELSIF statement_timestamp()>=i.recorded_at+make_interval(hours=>i.expires_after_hours) THEN kind:='expired';
 ELSE kind:='revoked';actual:=2; END IF;
 INSERT INTO app_private.staff_invitation_revocations(tenant_id,operation_id,invitation_id,actor_id,expected_version,observed_version,reason,outcome)
 VALUES(i.tenant_id,p_operation,p_invitation,app_private.context_actor(),p_expected,actual,p_reason,kind) RETURNING * INTO r;
 IF kind='revoked' THEN PERFORM app_private.audit('staff.invitation_request_revoked','staff_invitation',p_invitation,2); END IF;
 RETURN app_private.staff_invitation_revocation_json(r);
END $$;
CREATE FUNCTION app_api.read_staff_invitation_revocation(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_invitation_revocations; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_invitation_revocations WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;RETURN app_private.staff_invitation_revocation_json(r);
END $$;
CREATE FUNCTION app_api.read_staff_invitation_state(p_invitation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE i app_private.staff_invitation_requests;revoked boolean; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);SELECT * INTO i FROM app_private.staff_invitation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_invitation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 revoked:=EXISTS(SELECT 1 FROM app_private.staff_invitation_revocations WHERE tenant_id=i.tenant_id AND invitation_id=i.operation_id AND outcome='revoked');
 RETURN (app_private.staff_invitation_request_json(i)-'actorId') || jsonb_build_object('policy','staff-invitation-state-v1','version',CASE WHEN revoked THEN '2' ELSE '1' END,
 'state',CASE WHEN revoked THEN 'revoked' WHEN statement_timestamp()>=i.recorded_at+make_interval(hours=>i.expires_after_hours) THEN 'expired' ELSE 'pending' END);
END $$;
REVOKE ALL ON FUNCTION app_private.staff_invitation_email_valid(text),app_private.staff_invitation_request_json(app_private.staff_invitation_requests),app_private.staff_invitation_revocation_json(app_private.staff_invitation_revocations),app_api.record_staff_invitation_request(uuid,text,text,uuid,integer),app_api.read_staff_invitation_request(uuid),app_api.revoke_staff_invitation_request(uuid,uuid,bigint,text),app_api.read_staff_invitation_revocation(uuid),app_api.read_staff_invitation_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.record_staff_invitation_request(uuid,text,text,uuid,integer),app_api.read_staff_invitation_request(uuid),app_api.revoke_staff_invitation_request(uuid,uuid,bigint,text),app_api.read_staff_invitation_revocation(uuid),app_api.read_staff_invitation_state(uuid) TO api_runtime;
COMMIT;

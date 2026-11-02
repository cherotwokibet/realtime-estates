-- Isolated synthetic candidate only. Requires the branch, invitation-request and
-- membership candidates. Not a normal migration, startup hook or public route.
-- Verified issuer/email must come from the trusted server verifier, never a body.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.staff_invitation_issues (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,invitation_id uuid NOT NULL,actor_id uuid NOT NULL,
 issuer text NOT NULL,secret_digest text NOT NULL CHECK(secret_digest ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,invitation_id),UNIQUE(secret_digest),UNIQUE(tenant_id,operation_id,invitation_id),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES app_private.staff_invitation_requests(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK(expires_at>recorded_at)
);
CREATE TABLE app_private.staff_invitation_redemptions (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,invitation_id uuid NOT NULL,issue_operation_id uuid NOT NULL,
 member_id uuid NOT NULL,issuer text NOT NULL,recipient_email text NOT NULL,
 requested_role text NOT NULL CHECK(requested_role IN ('agent','admin')),branch_id uuid,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,invitation_id),
 FOREIGN KEY(tenant_id,issue_operation_id,invitation_id) REFERENCES app_private.staff_invitation_issues(tenant_id,operation_id,invitation_id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK(requested_role<>'admin' OR branch_id IS NULL)
);
ALTER TABLE app_private.staff_invitation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_invitation_issues FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_invitation_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_invitation_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.staff_invitation_issues TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON app_private.staff_invitation_redemptions TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_invitation_issue BEFORE UPDATE OR DELETE ON app_private.staff_invitation_issues FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
CREATE TRIGGER immutable_invitation_redemption BEFORE UPDATE OR DELETE ON app_private.staff_invitation_redemptions FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.staff_invitation_issues,app_private.staff_invitation_redemptions FROM PUBLIC,api_runtime,media_coordinator,media_maintenance;

CREATE FUNCTION app_private.staff_issued_branch_valid(i app_private.staff_invitation_requests) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE captured app_private.staff_branch_operations;current_branch app_private.staff_branch_operations;
BEGIN
 IF i.branch_operation_id IS NULL THEN RETURN true; END IF;
 SELECT * INTO captured FROM app_private.staff_branch_operations WHERE tenant_id=i.tenant_id AND operation_id=i.branch_operation_id;
 SELECT * INTO current_branch FROM app_private.staff_branch_operations WHERE tenant_id=i.tenant_id AND branch_id=captured.branch_id AND outcome='applied' ORDER BY observed_version DESC LIMIT 1;
 RETURN coalesce(current_branch.active AND current_branch.observed_version=captured.observed_version,false);
END $$;
CREATE FUNCTION app_private.staff_invitation_issue_json(r app_private.staff_invitation_issues) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object(
 'policy','staff-invitation-issuance-record-v1','operationId',r.operation_id,'invitationId',r.invitation_id,'actorId',r.actor_id,
 'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'expiresAt',to_char(r.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'secretRecovery','revoke_and_replace','delivery','not_attempted','membershipGranted',false) $$;
CREATE FUNCTION app_private.staff_invitation_redemption_json(r app_private.staff_invitation_redemptions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object(
 'policy','staff-invitation-redemption-record-v1','operationId',r.operation_id,'invitationId',r.invitation_id,
 'memberId',r.member_id,'requestedRole',r.requested_role,'branchId',r.branch_id,'membershipGranted',true,
 'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) $$;

CREATE FUNCTION app_api.issue_staff_invitation(p_operation uuid,p_invitation uuid,p_issuer text,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.staff_invitation_issues;i app_private.staff_invitation_requests;decision_at timestamptz;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_operation IS NULL OR p_invitation IS NULL OR p_issuer IS NULL OR char_length(p_issuer) NOT BETWEEN 1 AND 2048
 OR p_issuer ~ '[[:space:][:cntrl:]]' OR p_digest IS NULL OR p_digest!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid invitation issue' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() FOR UPDATE;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() FOR SHARE;
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_invitation_issues WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
 IF FOUND THEN
  IF r.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF ROW(r.invitation_id,r.issuer,r.secret_digest) IS DISTINCT FROM ROW(p_invitation,p_issuer,p_digest)
  THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  RETURN app_private.staff_invitation_issue_json(r);
 END IF;
 SELECT * INTO i FROM app_private.staff_invitation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_invitation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.staff_invitation_issues WHERE tenant_id=i.tenant_id AND invitation_id=p_invitation)
 THEN RAISE EXCEPTION 'Invitation already issued; revoke and replace' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.staff_invitation_revocations WHERE tenant_id=i.tenant_id AND invitation_id=p_invitation AND outcome='revoked')
 OR NOT app_private.staff_issued_branch_valid(i)
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 decision_at:=clock_timestamp();
 IF decision_at>=i.recorded_at+make_interval(hours=>i.expires_after_hours)
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 INSERT INTO app_private.staff_invitation_issues(tenant_id,operation_id,invitation_id,actor_id,issuer,secret_digest,recorded_at,expires_at)
 VALUES(i.tenant_id,p_operation,p_invitation,app_private.context_actor(),p_issuer,p_digest,decision_at,i.recorded_at+make_interval(hours=>i.expires_after_hours)) RETURNING * INTO r;
 PERFORM app_private.audit('staff.invitation_issued','staff_invitation',p_invitation,1,jsonb_build_object('operationId',p_operation));
 RETURN app_private.staff_invitation_issue_json(r);
END $$;
CREATE FUNCTION app_api.read_staff_invitation_issue(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_invitation_issues; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_invitation_issues WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.staff_invitation_issue_json(r);
END $$;

CREATE FUNCTION app_api.redeem_staff_invitation(p_operation uuid,p_invitation uuid,p_issuer text,p_email text,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.staff_invitation_redemptions;s app_private.staff_invitation_issues;
 i app_private.staff_invitation_requests;b app_private.staff_branch_operations;decision_at timestamptz;
BEGIN
 IF p_operation IS NULL OR p_invitation IS NULL OR app_private.context_actor() IS NULL OR p_issuer IS NULL
 OR char_length(p_issuer) NOT BETWEEN 1 AND 2048 OR p_issuer ~ '[[:space:][:cntrl:]]'
 OR NOT app_private.staff_invitation_email_valid(p_email) OR p_digest IS NULL OR p_digest!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid invitation redemption' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled)
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM app_private.staff_invitation_issues WHERE tenant_id=app_private.context_tenant() AND invitation_id=p_invitation AND issuer=p_issuer AND secret_digest=p_digest;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM app_private.staff_invitation_redemptions WHERE tenant_id=s.tenant_id AND operation_id=p_operation;
 IF FOUND THEN
  IF r.member_id<>app_private.context_actor() OR r.issuer<>p_issuer OR r.recipient_email<>p_email
  THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  IF r.invitation_id<>p_invitation THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  -- Historical receipt only: never re-activate or re-grant after later access loss.
  RETURN app_private.staff_invitation_redemption_json(r);
 END IF;
 SELECT * INTO i FROM app_private.staff_invitation_requests WHERE tenant_id=s.tenant_id AND operation_id=p_invitation;
 IF i.recipient_email<>p_email OR EXISTS(SELECT 1 FROM app_private.staff_invitation_redemptions WHERE tenant_id=s.tenant_id AND invitation_id=p_invitation)
 OR EXISTS(SELECT 1 FROM app_private.staff_invitation_revocations WHERE tenant_id=s.tenant_id AND invitation_id=p_invitation AND outcome='revoked')
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=i.tenant_id AND user_id=i.actor_id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=i.tenant_id AND user_id=i.actor_id AND active AND role='admin')
 OR NOT app_private.staff_issued_branch_valid(i)
 OR EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=i.tenant_id AND user_id=app_private.context_actor())
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO b FROM app_private.staff_branch_operations WHERE tenant_id=i.tenant_id AND operation_id=i.branch_operation_id;
 decision_at:=clock_timestamp();
 IF decision_at>=s.expires_at THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 INSERT INTO app_private.memberships(tenant_id,user_id,role,active,created_at,admin_version)
 VALUES(i.tenant_id,app_private.context_actor(),i.requested_role,true,decision_at,1);
 INSERT INTO app_private.staff_invitation_redemptions(tenant_id,operation_id,invitation_id,issue_operation_id,member_id,issuer,recipient_email,requested_role,branch_id,recorded_at)
 VALUES(i.tenant_id,p_operation,p_invitation,s.operation_id,app_private.context_actor(),p_issuer,p_email,i.requested_role,b.branch_id,decision_at) RETURNING * INTO r;
 PERFORM app_private.audit('staff.invitation_redeemed','staff_invitation',p_invitation,2,jsonb_build_object('operationId',p_operation,'role',i.requested_role));
 RETURN app_private.staff_invitation_redemption_json(r);
END $$;
CREATE FUNCTION app_api.read_staff_invitation_redemption(p_operation uuid,p_issuer text,p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_invitation_redemptions; BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled)
 THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM app_private.staff_invitation_redemptions WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation
 AND member_id=app_private.context_actor() AND issuer=p_issuer AND recipient_email=p_email;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.staff_invitation_redemption_json(r);
END $$;
CREATE FUNCTION app_api.read_issued_staff_invitation(p_invitation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE s app_private.staff_invitation_issues;kind text; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO s FROM app_private.staff_invitation_issues WHERE tenant_id=app_private.context_tenant() AND invitation_id=p_invitation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 kind:=CASE WHEN EXISTS(SELECT 1 FROM app_private.staff_invitation_redemptions WHERE tenant_id=s.tenant_id AND invitation_id=p_invitation) THEN 'used'
 WHEN EXISTS(SELECT 1 FROM app_private.staff_invitation_revocations WHERE tenant_id=s.tenant_id AND invitation_id=p_invitation AND outcome='revoked') THEN 'revoked'
 WHEN clock_timestamp()>=s.expires_at THEN 'expired' ELSE 'issued' END;
 RETURN (app_private.staff_invitation_issue_json(s)-'actorId'-'membershipGranted'-'secretRecovery'-'delivery')
 || jsonb_build_object('policy','staff-issued-invitation-state-v1','state',kind);
END $$;

-- Capture receipts remain immutable historical evidence. Current reads and the
-- bounded directory must instead reflect issuance/consumption once this proposal
-- is installed. The capture's membershipGranted:false describes capture only.
CREATE OR REPLACE FUNCTION app_api.read_staff_invitation_state(p_invitation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app_private.staff_invitation_requests;kind text;revoked boolean;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO i FROM app_private.staff_invitation_requests
 WHERE tenant_id=app_private.context_tenant() AND operation_id=p_invitation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 revoked:=EXISTS(SELECT 1 FROM app_private.staff_invitation_revocations WHERE tenant_id=i.tenant_id AND invitation_id=i.operation_id AND outcome='revoked');
 kind:=CASE
 WHEN EXISTS(SELECT 1 FROM app_private.staff_invitation_redemptions WHERE tenant_id=i.tenant_id AND invitation_id=i.operation_id) THEN 'used'
 WHEN revoked THEN 'revoked'
 WHEN clock_timestamp()>=i.recorded_at+make_interval(hours=>i.expires_after_hours) THEN 'expired'
 WHEN EXISTS(SELECT 1 FROM app_private.staff_invitation_issues WHERE tenant_id=i.tenant_id AND invitation_id=i.operation_id) THEN 'issued'
 ELSE 'pending' END;
 RETURN (app_private.staff_invitation_request_json(i)-'actorId') || jsonb_build_object(
  'policy','staff-invitation-state-v1','version',CASE WHEN revoked THEN '2' ELSE '1' END,'state',kind);
END $$;

-- Old capture-only cancellation must never label an already consumed invitation
-- as revoked. Exact historical cancellation receipts remain immutable/readable.
CREATE FUNCTION app_private.refuse_consumed_invitation_revocation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.outcome='revoked' AND EXISTS(SELECT 1 FROM app_private.staff_invitation_redemptions WHERE tenant_id=NEW.tenant_id AND invitation_id=NEW.invitation_id)
 THEN RAISE EXCEPTION 'Invitation already consumed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refuse_consumed_invitation_revocation BEFORE INSERT ON app_private.staff_invitation_revocations
 FOR EACH ROW EXECUTE FUNCTION app_private.refuse_consumed_invitation_revocation();
REVOKE ALL ON FUNCTION app_private.staff_issued_branch_valid(app_private.staff_invitation_requests),app_private.staff_invitation_issue_json(app_private.staff_invitation_issues),app_private.staff_invitation_redemption_json(app_private.staff_invitation_redemptions),app_private.refuse_consumed_invitation_revocation(),app_api.issue_staff_invitation(uuid,uuid,text,text),app_api.read_staff_invitation_issue(uuid),app_api.redeem_staff_invitation(uuid,uuid,text,text,text),app_api.read_staff_invitation_redemption(uuid,text,text),app_api.read_issued_staff_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.issue_staff_invitation(uuid,uuid,text,text),app_api.read_staff_invitation_issue(uuid),app_api.redeem_staff_invitation(uuid,uuid,text,text,text),app_api.read_staff_invitation_redemption(uuid,text,text),app_api.read_issued_staff_invitation(uuid) TO api_runtime;
COMMIT;

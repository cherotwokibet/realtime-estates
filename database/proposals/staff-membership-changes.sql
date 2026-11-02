-- Isolated existing-staff administration candidate. Never installed by normal migrations/startup.
-- Does not create memberships, promote customers, assign branches or redeem invitations.
BEGIN;
SET LOCAL ROLE realtor_owner;
ALTER TABLE app_private.memberships ADD COLUMN admin_version bigint NOT NULL DEFAULT 1
 CHECK(admin_version BETWEEN 1 AND 9007199254740991);
CREATE TABLE app_private.staff_membership_operations (
 tenant_id uuid NOT NULL REFERENCES app_private.tenants(id),operation_id uuid NOT NULL,member_id uuid NOT NULL,
 actor_id uuid NOT NULL,expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740990),
 observed_version bigint NOT NULL CHECK(observed_version BETWEEN 1 AND 9007199254740991),
 requested_role text NOT NULL CHECK(requested_role IN ('agent','admin')),active boolean NOT NULL,reason text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('applied','conflict','unchanged')),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK(outcome<>'applied' OR observed_version=expected_version+1),
 CHECK(outcome<>'unchanged' OR observed_version=expected_version),
 CHECK(outcome<>'conflict' OR observed_version<>expected_version)
);
CREATE UNIQUE INDEX staff_membership_applied_version ON app_private.staff_membership_operations(tenant_id,member_id,observed_version) WHERE outcome='applied';
ALTER TABLE app_private.staff_membership_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_membership_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.staff_membership_operations TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_staff_membership_operation BEFORE UPDATE OR DELETE ON app_private.staff_membership_operations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.staff_membership_operations FROM PUBLIC,api_runtime,media_coordinator,media_maintenance;
CREATE FUNCTION app_private.staff_membership_record_json(r app_private.staff_membership_operations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object(
 'policy','staff-membership-record-v1','operationId',r.operation_id,'memberId',r.member_id,'actorId',r.actor_id,
 'expectedVersion',r.expected_version::text,'version',r.observed_version::text,'outcome',r.outcome,
 'requestedRole',r.requested_role,'active',r.active,'reason',r.reason,
 'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) $$;
CREATE FUNCTION app_api.save_staff_membership(p_operation uuid,p_member uuid,p_expected bigint,p_role text,p_active boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior app_private.staff_membership_operations; target app_private.memberships; actual bigint; result_kind text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_operation IS NULL OR p_member IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 9007199254740990
 OR p_role IS NULL OR p_role NOT IN ('agent','admin') OR p_active IS NULL OR p_reason IS NULL
 OR p_reason<>btrim(p_reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
 OR char_length(p_reason) NOT BETWEEN 1 AND 500 OR p_reason<>normalize(p_reason,NFC)
 OR p_reason ~ '[[:cntrl:]<>]' OR p_reason ~ U&'[\0080-\009F\202A-\202E\2066-\2069]'
 THEN RAISE EXCEPTION 'Invalid membership command' USING ERRCODE='23514'; END IF;
 -- Shared tenant lock order matches company settings. Concurrent candidate membership changes
 -- cannot each use a stale other admin; current authority is rechecked after acquiring the lock.
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() FOR UPDATE;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() FOR SHARE;
 PERFORM app_private.assert_staff(ARRAY['admin']);
 -- Self changes intentionally unavailable, including no-ops; recovery requires current admin access.
 IF p_member=app_private.context_actor() THEN RAISE EXCEPTION 'Self changes unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM app_private.staff_membership_operations WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
 IF FOUND THEN
  IF prior.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF ROW(prior.member_id,prior.expected_version,prior.requested_role,prior.active,prior.reason) IS DISTINCT FROM ROW(p_member,p_expected,p_role,p_active,p_reason)
   THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  RETURN app_private.staff_membership_record_json(prior);
 END IF;
 SELECT * INTO target FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=p_member AND role IN ('agent','admin') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff member unavailable' USING ERRCODE='P0002'; END IF;
 actual:=target.admin_version;
 IF actual<>p_expected THEN result_kind:='conflict';
 ELSIF target.role=p_role AND target.active=p_active THEN result_kind:='unchanged';
 ELSE
  IF target.active AND target.role='admin' AND (NOT p_active OR p_role<>'admin')
   AND NOT EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id<>p_member AND active AND role='admin')
   THEN RAISE EXCEPTION 'At least one active admin is required' USING ERRCODE='23514'; END IF;
  UPDATE app_private.memberships SET role=p_role,active=p_active,
   revoked_at=CASE WHEN p_active THEN NULL ELSE coalesce(target.revoked_at,statement_timestamp()) END,
   admin_version=actual+1 WHERE tenant_id=app_private.context_tenant() AND user_id=p_member;
  actual:=actual+1;result_kind:='applied';
 END IF;
 INSERT INTO app_private.staff_membership_operations(tenant_id,operation_id,member_id,actor_id,expected_version,observed_version,requested_role,active,reason,outcome)
 VALUES(app_private.context_tenant(),p_operation,p_member,app_private.context_actor(),p_expected,actual,p_role,p_active,p_reason,result_kind) RETURNING * INTO prior;
 IF result_kind='applied' THEN
  PERFORM app_private.audit('staff.membership_saved','staff_membership',p_member,actual,jsonb_build_object('operationId',p_operation,'role',p_role,'active',p_active));
 END IF;
 RETURN app_private.staff_membership_record_json(prior);
END $$;
CREATE FUNCTION app_api.read_staff_membership_operation(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_membership_operations; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_membership_operations WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.staff_membership_record_json(r);
END $$;
CREATE FUNCTION app_private.staff_membership_current_json(r app_private.memberships) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','staff-membership-current-v1','memberId',r.user_id,'role',r.role,'active',r.active,'version',r.admin_version::text,
  -- Legacy active rows can retain a historical revoked_at. Reading does not rewrite history.
  'revokedAt',CASE WHEN r.active OR r.revoked_at IS NULL THEN NULL ELSE to_char(r.revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) $$;
CREATE FUNCTION app_api.read_staff_membership(p_member uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.memberships; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=p_member AND role IN ('agent','admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff member unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.staff_membership_current_json(r);
END $$;
CREATE FUNCTION app_api.list_staff_memberships(p_limit integer,p_after uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows_json jsonb;more boolean;next_id uuid;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='23514'; END IF;
 -- Stable UUID identity order, not creation order or snapshot traversal across requests.
 WITH bounded AS (
  SELECT * FROM app_private.memberships WHERE tenant_id=app_private.context_tenant()
   AND role IN ('agent','admin') AND (p_after IS NULL OR user_id>p_after)
  ORDER BY user_id LIMIT p_limit+1
 ), page AS (SELECT * FROM bounded ORDER BY user_id LIMIT p_limit)
 SELECT coalesce((SELECT jsonb_agg(app_private.staff_membership_current_json(p::app_private.memberships) ORDER BY p.user_id) FROM page p),'[]'::jsonb),
  (SELECT count(*)>p_limit FROM bounded),(SELECT user_id FROM page ORDER BY user_id DESC LIMIT 1)
 INTO rows_json,more,next_id;
 RETURN jsonb_build_object('policy','staff-membership-page-v1','items',rows_json,'nextAfter',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION app_private.staff_membership_record_json(app_private.staff_membership_operations),app_private.staff_membership_current_json(app_private.memberships),app_api.save_staff_membership(uuid,uuid,bigint,text,boolean,text),app_api.read_staff_membership_operation(uuid),app_api.read_staff_membership(uuid),app_api.list_staff_memberships(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.save_staff_membership(uuid,uuid,bigint,text,boolean,text),app_api.read_staff_membership_operation(uuid),app_api.read_staff_membership(uuid),app_api.list_staff_memberships(integer,uuid) TO api_runtime;
COMMIT;

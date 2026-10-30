-- Isolated staff-branch candidate. Not registered in normal migrations or production startup.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.staff_branch_operations (
 tenant_id uuid NOT NULL REFERENCES app_private.tenants(id),operation_id uuid NOT NULL,branch_id uuid NOT NULL,
 actor_id uuid NOT NULL,expected_version bigint NOT NULL CHECK(expected_version BETWEEN 0 AND 9007199254740990),
 observed_version bigint NOT NULL CHECK(observed_version BETWEEN 0 AND 9007199254740991),
 name text NOT NULL,active boolean NOT NULL,reason text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('applied','conflict','unchanged')),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(tenant_id,operation_id),FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK(outcome<>'applied' OR observed_version=expected_version+1),
 CHECK(outcome<>'unchanged' OR observed_version=expected_version)
);
CREATE UNIQUE INDEX staff_branch_applied_version ON app_private.staff_branch_operations(tenant_id,branch_id,observed_version) WHERE outcome='applied';
ALTER TABLE app_private.staff_branch_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_branch_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.staff_branch_operations TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_staff_branch_operation BEFORE UPDATE OR DELETE ON app_private.staff_branch_operations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.staff_branch_operations FROM PUBLIC,api_runtime,media_coordinator,media_maintenance;
CREATE FUNCTION app_private.staff_branch_record_json(r app_private.staff_branch_operations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object(
 'policy','staff-branch-record-v1','operationId',r.operation_id,'branchId',r.branch_id,'actorId',r.actor_id,
 'expectedVersion',r.expected_version::text,'version',r.observed_version::text,'outcome',r.outcome,
 'name',r.name,'active',r.active,'reason',r.reason,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) $$;
CREATE FUNCTION app_api.save_staff_branch(p_operation uuid,p_branch uuid,p_expected bigint,p_name text,p_active boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior app_private.staff_branch_operations; current_branch app_private.staff_branch_operations;
 actual bigint; result_kind text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_operation IS NULL OR p_branch IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 9007199254740990
 OR p_active IS NULL OR p_name IS NULL OR p_reason IS NULL OR p_name<>btrim(p_name) OR p_reason<>btrim(p_reason)
 OR char_length(p_name) NOT BETWEEN 1 AND 160 OR char_length(p_reason) NOT BETWEEN 1 AND 500
 OR p_name<>normalize(p_name,NFC) OR p_reason<>normalize(p_reason,NFC)
 OR p_name ~ '[[:cntrl:]<>]' OR p_reason ~ '[[:cntrl:]<>]'
 OR p_name ~ U&'[\202A-\202E\2066-\2069]' OR p_reason ~ U&'[\202A-\202E\2066-\2069]'
 THEN RAISE EXCEPTION 'Invalid branch command' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':staff-branch-op:'||p_operation::text,0));
 SELECT * INTO prior FROM app_private.staff_branch_operations WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
 IF FOUND THEN
  IF prior.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF ROW(prior.branch_id,prior.expected_version,prior.name,prior.active,prior.reason) IS DISTINCT FROM ROW(p_branch,p_expected,p_name,p_active,p_reason)
   THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  RETURN app_private.staff_branch_record_json(prior);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':staff-branch:'||p_branch::text,0));
 SELECT * INTO current_branch FROM app_private.staff_branch_operations WHERE tenant_id=app_private.context_tenant() AND branch_id=p_branch AND outcome='applied' ORDER BY observed_version DESC LIMIT 1;
 actual:=coalesce(current_branch.observed_version,0);
 IF p_expected<>actual THEN result_kind:='conflict';
 ELSIF current_branch.name IS NOT DISTINCT FROM p_name AND current_branch.active IS NOT DISTINCT FROM p_active THEN result_kind:='unchanged';
 ELSE result_kind:='applied'; END IF;
 INSERT INTO app_private.staff_branch_operations(tenant_id,operation_id,branch_id,actor_id,expected_version,observed_version,name,active,reason,outcome)
 VALUES(app_private.context_tenant(),p_operation,p_branch,app_private.context_actor(),p_expected,actual+CASE WHEN result_kind='applied' THEN 1 ELSE 0 END,p_name,p_active,p_reason,result_kind) RETURNING * INTO prior;
 IF result_kind='applied' THEN PERFORM app_private.audit('staff.branch_saved','staff_branch',p_branch,prior.observed_version); END IF;
 RETURN app_private.staff_branch_record_json(prior);
END $$;
CREATE FUNCTION app_api.read_staff_branch_operation(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_branch_operations; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_branch_operations WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN app_private.staff_branch_record_json(r);
END $$;
CREATE FUNCTION app_api.read_staff_branch(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.staff_branch_operations; BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.staff_branch_operations WHERE tenant_id=app_private.context_tenant() AND branch_id=p_branch AND outcome='applied' ORDER BY observed_version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Branch unavailable' USING ERRCODE='P0002'; END IF;
 RETURN (app_private.staff_branch_record_json(r)-'reason'-'actorId'-'operationId'-'expectedVersion'-'outcome') || jsonb_build_object('policy','staff-branch-current-v1');
END $$;
REVOKE ALL ON FUNCTION app_private.staff_branch_record_json(app_private.staff_branch_operations),app_api.save_staff_branch(uuid,uuid,bigint,text,boolean,text),app_api.read_staff_branch_operation(uuid),app_api.read_staff_branch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.save_staff_branch(uuid,uuid,bigint,text,boolean,text),app_api.read_staff_branch_operation(uuid),app_api.read_staff_branch(uuid) TO api_runtime;
COMMIT;

-- Independently authored public company copy/palette. No domains, identities, contacts or modules.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.company_settings_records (
 tenant_id uuid NOT NULL REFERENCES app_private.tenants(id),version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 operation_id uuid NOT NULL,actor_id uuid NOT NULL,request jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(tenant_id,version),UNIQUE(tenant_id,operation_id),FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
ALTER TABLE app_private.company_settings_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.company_settings_records FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_command ON app_private.company_settings_records TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_company_settings BEFORE UPDATE OR DELETE ON app_private.company_settings_records FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.company_settings_records FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.company_settings_content_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text;v jsonb;maximum integer;
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(c) key) IS DISTINCT FROM ARRAY['about','colors','companyName','officeAddress','openingHours','summary']::text[] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['companyName','summary','about','officeAddress','openingHours'] LOOP
  v:=c->k;
  IF v='null'::jsonb AND k IN ('officeAddress','openingHours') THEN CONTINUE;END IF;
  maximum:=CASE k WHEN 'companyName' THEN 160 WHEN 'about' THEN 4000 ELSE 320 END;
  IF jsonb_typeof(v)<>'string' OR c->>k<>btrim(c->>k) OR c->>k<>normalize(c->>k,NFC) OR length(c->>k) NOT BETWEEN 1 AND maximum OR (c->>k) ~ '[[:cntrl:]<>]' OR (c->>k) ~ U&'[\202A-\202E\2066-\2069]' THEN RETURN false;END IF;
 END LOOP;
 IF jsonb_typeof(c->'colors')<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(c->'colors') key) IS DISTINCT FROM ARRAY['accent','background','primary','secondary']::text[] THEN RETURN false;END IF;
 FOR k,v IN SELECT * FROM jsonb_each(c->'colors') LOOP IF jsonb_typeof(v)<>'string' OR (c->'colors'->>k)!~'^#[0-9a-f]{6}$' THEN RETURN false;END IF;END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION app_private.company_settings_record_json(r app_private.company_settings_records) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',r.version::text,'operationId',r.operation_id,'actorId',r.actor_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'request',r.request)
$$;
CREATE FUNCTION app_api.read_company_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE latest app_private.company_settings_records;history jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO latest FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant() ORDER BY version DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(app_private.company_settings_record_json(r) ORDER BY version DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant() ORDER BY version DESC LIMIT 20) r;
 RETURN jsonb_build_object('policy','company-settings-state-v1','version',coalesce(latest.version,0)::text,'current',latest.request->'content','history',history,'hasMore',coalesce(latest.version,0)>20);
END $$;
CREATE FUNCTION app_api.read_company_settings_operation(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.company_settings_records;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN app_private.company_settings_record_json(r);
END $$;
CREATE FUNCTION app_api.approve_company_settings(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.company_settings_records;expected bigint;actual bigint;op uuid;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_request) key) IS DISTINCT FROM ARRAY['approval','content','expectedVersion','operationId','policy']::text[] OR p_request->>'policy' IS DISTINCT FROM 'company-settings-command-v1' OR p_request->>'approval' IS DISTINCT FROM 'approved-for-publication' OR jsonb_typeof(p_request->'expectedVersion') IS DISTINCT FROM 'string' OR (p_request->>'expectedVersion')!~'^(0|[1-9][0-9]{0,15})$' OR jsonb_typeof(p_request->'operationId') IS DISTINCT FROM 'string' OR (p_request->>'operationId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR NOT app_private.company_settings_content_valid(p_request->'content') THEN RAISE EXCEPTION 'Invalid settings command' USING ERRCODE='23514';END IF;
 expected:=(p_request->>'expectedVersion')::bigint;op:=(p_request->>'operationId')::uuid;
 IF expected>=9007199254740991 THEN RAISE EXCEPTION 'Version exhausted' USING ERRCODE='23514';END IF;
 -- One tenant row lock serializes first and later writes and tenant-disable changes.
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() FOR UPDATE;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() FOR SHARE;
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
  IF r.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Original request conflicts' USING ERRCODE='40001';END IF;
  RETURN app_private.company_settings_record_json(r);
 END IF;
 SELECT coalesce(max(version),0) INTO actual FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant();
 IF actual<>expected THEN RAISE EXCEPTION 'Settings version changed' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant() AND version=actual AND request->'content'=p_request->'content') THEN RAISE EXCEPTION 'No settings change' USING ERRCODE='23514';END IF;
 INSERT INTO app_private.company_settings_records(tenant_id,version,operation_id,actor_id,request) VALUES(app_private.context_tenant(),actual+1,op,app_private.context_actor(),p_request) RETURNING * INTO r;
 PERFORM app_private.audit('company.settings.approved','company',app_private.context_tenant(),r.version,jsonb_build_object('operationId',op,'approval','approved-for-publication'));
 RETURN app_private.company_settings_record_json(r);
END $$;
CREATE FUNCTION app_api.read_public_company_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app_private.context_actor() IS NOT NULL THEN RAISE EXCEPTION 'Anonymous projection required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled) THEN RETURN NULL;END IF;
 RETURN (SELECT request->'content' FROM app_private.company_settings_records WHERE tenant_id=app_private.context_tenant() ORDER BY version DESC LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION app_private.company_settings_content_valid(jsonb),app_private.company_settings_record_json(app_private.company_settings_records),app_api.read_company_settings(),app_api.read_company_settings_operation(uuid),app_api.approve_company_settings(jsonb),app_api.read_public_company_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_company_settings(),app_api.read_company_settings_operation(uuid),app_api.approve_company_settings(jsonb),app_api.read_public_company_settings() TO api_runtime;
COMMIT;

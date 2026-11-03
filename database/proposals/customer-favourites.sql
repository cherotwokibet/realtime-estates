-- Isolated customer favourites candidate; no ordinary migration/startup registration.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.customer_favourites (
 tenant_id uuid NOT NULL,customer_id uuid NOT NULL,listing_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),saved boolean NOT NULL,
 PRIMARY KEY(tenant_id,customer_id,listing_id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id)
);
CREATE TABLE app_private.customer_favourite_operations (
 tenant_id uuid NOT NULL,customer_id uuid NOT NULL,operation_id uuid NOT NULL,
 listing_id uuid NOT NULL,expected_version bigint NOT NULL CHECK(expected_version BETWEEN 0 AND 9007199254740990),
 requested_saved boolean NOT NULL,receipt jsonb NOT NULL,
 PRIMARY KEY(tenant_id,customer_id,operation_id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
ALTER TABLE app_private.customer_favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_favourites FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_favourite_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_favourite_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.customer_favourites TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON app_private.customer_favourite_operations TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_customer_favourite_operation BEFORE UPDATE OR DELETE ON app_private.customer_favourite_operations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.customer_favourites,app_private.customer_favourite_operations FROM PUBLIC,api_runtime,media_coordinator,media_maintenance;
CREATE FUNCTION app_private.assert_customer() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF app_private.staff_role() IS DISTINCT FROM 'customer' THEN RAISE EXCEPTION 'Customer access required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app_api.customer_account() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM app_private.assert_customer();
 RETURN jsonb_build_object('policy','customer-account-v1','tenantId',app_private.context_tenant(),'customerId',app_private.context_actor());
END $$;
CREATE FUNCTION app_api.set_customer_favourite(p_operation uuid,p_listing uuid,p_expected bigint,p_saved boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior app_private.customer_favourite_operations;current_state app_private.customer_favourites;actual bigint;outcome text;result jsonb;BEGIN
 IF p_operation IS NULL OR p_listing IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 9007199254740990 OR p_saved IS NULL
 THEN RAISE EXCEPTION 'Invalid favourite command' USING ERRCODE='23514'; END IF;
 -- Same tenant-before-membership lock order as staff membership writers. Serializes one customer's quota and state.
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() FOR SHARE;
 PERFORM 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() FOR UPDATE;
 PERFORM app_private.assert_customer();
 SELECT * INTO prior FROM app_private.customer_favourite_operations WHERE tenant_id=app_private.context_tenant() AND customer_id=app_private.context_actor() AND operation_id=p_operation;
 IF FOUND THEN
  IF ROW(prior.listing_id,prior.expected_version,prior.requested_saved) IS DISTINCT FROM ROW(p_listing,p_expected,p_saved)
  THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
  RETURN prior.receipt;
 END IF;
 SELECT * INTO current_state FROM app_private.customer_favourites WHERE tenant_id=app_private.context_tenant() AND customer_id=app_private.context_actor() AND listing_id=p_listing;
 actual:=coalesce(current_state.version,0);
 IF p_expected<>actual THEN outcome:='conflict';
 ELSIF coalesce(current_state.saved,false)=p_saved THEN outcome:='unchanged';
 ELSE
  IF p_saved THEN
   PERFORM 1 FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing FOR SHARE;
   IF NOT EXISTS(SELECT 1 FROM app_api.public_listings WHERE listing_id=p_listing) THEN RAISE EXCEPTION 'Property unavailable' USING ERRCODE='P0002'; END IF;
   IF (SELECT count(*) FROM app_private.customer_favourites WHERE tenant_id=app_private.context_tenant() AND customer_id=app_private.context_actor() AND saved)>=100
   THEN RAISE EXCEPTION 'Favourite limit reached' USING ERRCODE='54000'; END IF;
  END IF;
  outcome:='applied';actual:=actual+1;
  INSERT INTO app_private.customer_favourites(tenant_id,customer_id,listing_id,version,saved)
  VALUES(app_private.context_tenant(),app_private.context_actor(),p_listing,actual,p_saved)
  ON CONFLICT(tenant_id,customer_id,listing_id) DO UPDATE SET version=excluded.version,saved=excluded.saved;
 END IF;
 result:=jsonb_build_object('policy','customer-favourite-receipt-v1','tenantId',app_private.context_tenant(),'customerId',app_private.context_actor(),
 'operationId',p_operation,'listingId',p_listing,'expectedVersion',p_expected::text,'version',actual::text,'requestedSaved',p_saved,
 'saved',CASE WHEN outcome='applied' THEN p_saved ELSE coalesce(current_state.saved,false) END,'outcome',outcome,
 'recordedAt',to_char(date_trunc('milliseconds',statement_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 INSERT INTO app_private.customer_favourite_operations VALUES(app_private.context_tenant(),app_private.context_actor(),p_operation,p_listing,p_expected,p_saved,result);
 RETURN result;
END $$;
CREATE FUNCTION app_api.read_customer_favourite_operation(p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result jsonb; BEGIN
 PERFORM app_private.assert_customer();
 SELECT receipt INTO result FROM app_private.customer_favourite_operations WHERE tenant_id=app_private.context_tenant() AND customer_id=app_private.context_actor() AND operation_id=p_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION app_api.list_customer_favourites(p_limit integer DEFAULT 20,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE items jsonb;more boolean;BEGIN
 PERFORM app_private.assert_customer();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid page limit' USING ERRCODE='23514'; END IF;
 WITH page AS (SELECT f.listing_id,f.version,EXISTS(SELECT 1 FROM app_api.public_listings p WHERE p.listing_id=f.listing_id) AS available
 FROM app_private.customer_favourites f WHERE f.tenant_id=app_private.context_tenant() AND f.customer_id=app_private.context_actor() AND f.saved AND (p_after IS NULL OR f.listing_id>p_after) ORDER BY f.listing_id LIMIT p_limit+1)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('listingId',listing_id,'version',version::text,'available',available) ORDER BY listing_id) FROM (SELECT * FROM page ORDER BY listing_id LIMIT p_limit) visible),'[]'::jsonb),(SELECT count(*)>p_limit FROM page) INTO items,more;
 RETURN jsonb_build_object('policy','customer-favourites-page-v1','tenantId',app_private.context_tenant(),'customerId',app_private.context_actor(),'items',items,'hasMore',more);
END $$;
CREATE FUNCTION app_api.read_customer_favourite(p_listing uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r app_private.customer_favourites;BEGIN
 PERFORM app_private.assert_customer();
 IF p_listing IS NULL THEN RAISE EXCEPTION 'Invalid property' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM app_private.customer_favourites WHERE tenant_id=app_private.context_tenant() AND customer_id=app_private.context_actor() AND listing_id=p_listing;
 RETURN jsonb_build_object('policy','customer-favourite-state-v1','tenantId',app_private.context_tenant(),'customerId',app_private.context_actor(),'listingId',p_listing,'version',coalesce(r.version,0)::text,'saved',coalesce(r.saved,false));
END $$;
REVOKE ALL ON FUNCTION app_private.assert_customer(),app_api.customer_account(),app_api.read_customer_favourite(uuid),app_api.set_customer_favourite(uuid,uuid,bigint,boolean),app_api.read_customer_favourite_operation(uuid),app_api.list_customer_favourites(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.customer_account(),app_api.read_customer_favourite(uuid),app_api.set_customer_favourite(uuid,uuid,bigint,boolean),app_api.read_customer_favourite_operation(uuid),app_api.list_customer_favourites(integer,uuid) TO api_runtime;
COMMIT;

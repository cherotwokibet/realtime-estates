BEGIN;
SET LOCAL ROLE realtor_owner;
-- Private full replacement snapshots only. No media, caller identity or publication authority.
CREATE FUNCTION app_private.creation_content_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text;v text;n numeric;trimset text:=E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>18 OR NOT p ?& ARRAY['title','description','purpose','propertyType','currency','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','country','locality','publicPrecision','latitude','longitude','privateAddress','pricing','location'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['title','description','purpose','propertyType','currency','rentPeriod','country','locality','publicPrecision','privateAddress'] LOOP
  IF jsonb_typeof(p->k) NOT IN ('string','null') THEN RETURN false;END IF;
 END LOOP;
 IF p->'currency' IS DISTINCT FROM '"KES"'::jsonb OR p->'country' IS DISTINCT FROM '"KE"'::jsonb OR p->>'publicPrecision' IS NULL OR p->>'publicPrecision' NOT IN ('area','exact') THEN RETURN false;END IF;
 IF p->>'purpose' NOT IN ('rent','sale') OR p->>'propertyType' NOT IN ('apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land') OR p->>'rentPeriod' NOT IN ('day','week','month','year') THEN RETURN false;END IF;
 IF p->>'purpose'='sale' AND p->'rentPeriod'<>'null'::jsonb THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['title','description','locality','privateAddress'] LOOP
  IF p->k='null'::jsonb THEN CONTINUE;END IF;v:=p->>k;
  IF char_length(v)>(CASE k WHEN 'description' THEN 10000 WHEN 'privateAddress' THEN 1000 ELSE 160 END) OR v ~ U&'[\0001-\0008\000b\000c\000e-\001f\007f]' THEN RETURN false;END IF;
  IF k<>'privateAddress' AND (char_length(v)<1 OR v<>btrim(v,trimset)) THEN RETURN false;END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['amountMinor','bedrooms','privateBathrooms','sharedBathrooms','latitude','longitude'] LOOP
  IF p->k='null'::jsonb THEN CONTINUE;END IF;
  IF jsonb_typeof(p->k)<>'number' THEN RETURN false;END IF;n:=(p->>k)::numeric;
  IF k='amountMinor' THEN IF n<>trunc(n) OR n NOT BETWEEN 1 AND 100000000000000 THEN RETURN false;END IF;
  ELSIF k='latitude' THEN IF n NOT BETWEEN -90 AND 90 THEN RETURN false;END IF;
  ELSIF k='longitude' THEN IF n NOT BETWEEN -180 AND 180 THEN RETURN false;END IF;
  ELSE IF n<>trunc(n) OR n NOT BETWEEN 0 AND 100 THEN RETURN false;END IF;END IF;
 END LOOP;
 IF (p->'latitude'='null'::jsonb)<>(p->'longitude'='null'::jsonb) OR p->>'propertyType'='land' AND p->'bedrooms'<>'null'::jsonb OR p->>'propertyType' IN ('studio','bedsitter') AND p->'bedrooms' NOT IN ('null'::jsonb,'0'::jsonb) THEN RETURN false;END IF;
 RETURN app_private.pricing_disclosure_valid(p->'pricing',p->>'purpose',(p->>'amountMinor')::bigint) AND app_private.public_location_valid(p->'location');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
CREATE TABLE app_private.listing_creation_requests(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,listing_id uuid NOT NULL,requester_id uuid NOT NULL,
 slug text NOT NULL CHECK(char_length(slug) BETWEEN 1 AND 160 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 content jsonb NOT NULL CHECK(app_private.creation_content_valid(content)),
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE TABLE app_private.listing_creation_results(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,listing_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('created','refused')),created_listing_id uuid,initial_revision integer,
 completed_at timestamptz NOT NULL CHECK(app_private.enquiry_time_valid(completed_at)),
 PRIMARY KEY(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,operation_id,listing_id) REFERENCES app_private.listing_creation_requests(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,created_listing_id,initial_revision) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 CHECK((outcome='created' AND created_listing_id IS NOT NULL AND created_listing_id=listing_id AND initial_revision IS NOT NULL AND initial_revision=1) OR (outcome='refused' AND created_listing_id IS NULL AND initial_revision IS NULL))
);
-- A reservation cannot commit without its completed result. No persisted pending allocation.
ALTER TABLE app_private.listing_creation_requests ADD CONSTRAINT creation_must_complete
 FOREIGN KEY(tenant_id,operation_id) REFERENCES app_private.listing_creation_results(tenant_id,operation_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.listing_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_creation_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_creation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_creation_results FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.listing_creation_requests TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_access ON app_private.listing_creation_results TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_creation_request BEFORE UPDATE OR DELETE ON app_private.listing_creation_requests FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE TRIGGER immutable_creation_result BEFORE UPDATE OR DELETE ON app_private.listing_creation_results FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE FUNCTION app_api.read_listing_creation(p_listing uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_creation_requests;r app_private.listing_creation_results;l app_private.listings;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO q FROM app_private.listing_creation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation AND listing_id=p_listing AND requester_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.listing_creation_results WHERE tenant_id=q.tenant_id AND operation_id=q.operation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF r.outcome='created' THEN
  SELECT * INTO l FROM app_private.listings WHERE tenant_id=q.tenant_id AND id=q.listing_id;
  IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 END IF;
 RETURN jsonb_build_object('operationId',q.operation_id::text,'listingId',q.listing_id::text,'actorId',q.requester_id::text,'kind','create_listing','request',jsonb_build_object('slug',q.slug,'content',q.content),'outcome',r.outcome,'reason',CASE WHEN r.outcome='refused' THEN 'TARGET_UNAVAILABLE' END,'result',CASE WHEN r.outcome='created' THEN jsonb_build_object('listingVersion','1','revision',1,'revisionVersion','2') END,'completedAt',app_private.enquiry_utc(r.completed_at));
END $$;
CREATE FUNCTION app_api.create_listing_draft_v2(p_listing uuid,p_operation uuid,p_slug text,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app_private.listing_creation_requests;original jsonb;v bigint;outcome text:='created';constraint_name text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF p_listing IS NULL OR p_operation IS NULL OR p_listing::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_slug IS NULL OR char_length(p_slug) NOT BETWEEN 1 AND 160 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR NOT app_private.creation_content_valid(p_content) THEN RAISE EXCEPTION 'Invalid creation facts' USING ERRCODE='23514';END IF;
 INSERT INTO app_private.listing_creation_requests VALUES(app_private.context_tenant(),p_operation,p_listing,app_private.context_actor(),p_slug,p_content) ON CONFLICT(tenant_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO q FROM app_private.listing_creation_requests WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation FOR UPDATE;
  original:=app_api.read_listing_creation(p_listing,p_operation);
  IF q.slug IS DISTINCT FROM p_slug OR q.content IS DISTINCT FROM p_content THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN original;
 END IF;
 BEGIN
  PERFORM app_api.create_listing(p_listing,p_slug);
  v:=app_api.save_draft_v2(p_listing,1,0,p_content);
  IF v<>2 THEN RAISE EXCEPTION 'Unexpected initial version' USING ERRCODE='23514';END IF;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
  IF constraint_name NOT IN ('listings_pkey','listings_tenant_id_slug_key') THEN RAISE;END IF;
  outcome:='refused';
 END;
 INSERT INTO app_private.listing_creation_results VALUES(app_private.context_tenant(),p_operation,p_listing,outcome,CASE WHEN outcome='created' THEN p_listing END,CASE WHEN outcome='created' THEN 1 END,clock_timestamp());
 RETURN app_api.read_listing_creation(p_listing,p_operation);
END $$;
REVOKE ALL ON FUNCTION app_private.creation_content_valid(jsonb),app_api.read_listing_creation(uuid,uuid),app_api.create_listing_draft_v2(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_creation(uuid,uuid),app_api.create_listing_draft_v2(uuid,uuid,text,jsonb) TO api_runtime;
COMMIT;

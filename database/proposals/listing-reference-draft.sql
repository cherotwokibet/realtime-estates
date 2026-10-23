-- ISOLATED SYNTHETIC CANDIDATE: explicitly loaded only by its candidate tests.
-- Not registered in migrations. Adopted drafts cannot submit until v3 review exists.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.synthetic_reference_catalogues (
  version bigint PRIMARY KEY CHECK (version BETWEEN 1 AND 9007199254740991),
  payload jsonb NOT NULL
);
CREATE TRIGGER immutable_reference_catalogue BEFORE UPDATE OR DELETE ON app_private.synthetic_reference_catalogues
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
CREATE TABLE app_private.synthetic_reference_catalogue_current (
  singleton boolean PRIMARY KEY CHECK (singleton), version bigint REFERENCES app_private.synthetic_reference_catalogues(version)
);
INSERT INTO app_private.synthetic_reference_catalogue_current VALUES(true,NULL);
REVOKE ALL ON app_private.synthetic_reference_catalogues,app_private.synthetic_reference_catalogue_current FROM PUBLIC,api_runtime;

CREATE TABLE app_private.synthetic_reference_locations (
  catalogue_version bigint NOT NULL CHECK (catalogue_version BETWEEN 1 AND 9007199254740991),
  id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('county','locality','neighbourhood')),
  parent_id uuid, parent_kind text,
  label text NOT NULL CHECK (app_private.disclosure_text_valid(to_jsonb(label),160)),
  PRIMARY KEY (catalogue_version,id), UNIQUE (catalogue_version,id,kind),
  FOREIGN KEY (catalogue_version) REFERENCES app_private.synthetic_reference_catalogues(version),
  FOREIGN KEY (catalogue_version,parent_id,parent_kind)
    REFERENCES app_private.synthetic_reference_locations(catalogue_version,id,kind),
  CHECK ((kind='county' AND parent_id IS NULL AND parent_kind IS NULL)
    OR (kind='locality' AND parent_id IS NOT NULL AND parent_kind IS NOT NULL AND parent_kind='county')
    OR (kind='neighbourhood' AND parent_id IS NOT NULL AND parent_kind IS NOT NULL AND parent_kind='locality'))
);
CREATE TABLE app_private.synthetic_reference_amenities (
  catalogue_version bigint NOT NULL CHECK (catalogue_version BETWEEN 1 AND 9007199254740991),
  id uuid NOT NULL, code text NOT NULL CHECK (length(code)<=64 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  label text NOT NULL CHECK (app_private.disclosure_text_valid(to_jsonb(label),160)),
  property_types text[] NOT NULL CHECK (cardinality(property_types)>0 AND property_types <@
    ARRAY['apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land']::text[]
    AND array_position(property_types,NULL) IS NULL),
  PRIMARY KEY (catalogue_version,id), UNIQUE (catalogue_version,code),
  FOREIGN KEY (catalogue_version) REFERENCES app_private.synthetic_reference_catalogues(version)
);
CREATE TRIGGER immutable_reference_location BEFORE UPDATE OR DELETE ON app_private.synthetic_reference_locations
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
CREATE TRIGGER immutable_reference_amenity BEFORE UPDATE OR DELETE ON app_private.synthetic_reference_amenities
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
-- Migration-owner curated only; labels for a version cannot be rewritten by runtime.
REVOKE ALL ON app_private.synthetic_reference_locations,app_private.synthetic_reference_amenities FROM PUBLIC,api_runtime;

ALTER TABLE app_private.listing_revisions ADD COLUMN synthetic_reference_attributes jsonb,
  ADD COLUMN synthetic_reference_operation uuid;

CREATE TABLE app_private.synthetic_reference_draft_receipts (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL, actor_id uuid NOT NULL,
  listing_id uuid NOT NULL, revision_no integer NOT NULL, expected_version bigint NOT NULL,
  content jsonb NOT NULL, selection jsonb NOT NULL, receipt jsonb NOT NULL,
  PRIMARY KEY (tenant_id,operation_id),
  FOREIGN KEY (tenant_id,listing_id,revision_no)
    REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no)
);
CREATE TRIGGER immutable_reference_receipt BEFORE UPDATE OR DELETE ON app_private.synthetic_reference_draft_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_reference_draft_receipts FROM PUBLIC,api_runtime;
ALTER TABLE app_private.synthetic_reference_draft_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_reference_draft_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_receipt_tenant ON app_private.synthetic_reference_draft_receipts TO realtor_owner
  USING (tenant_id=app_private.context_tenant()) WITH CHECK (tenant_id=app_private.context_tenant());

CREATE FUNCTION app_private.guard_synthetic_reference_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.synthetic_reference_attributes IS NOT NULL AND NEW.state<>'draft' THEN
    RAISE EXCEPTION 'Reference-aware review not enabled' USING ERRCODE='23514'; END IF;
  IF OLD.synthetic_reference_attributes IS NOT NULL AND
    (to_jsonb(NEW)-ARRAY['version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','updated_at'])
    AND NEW.synthetic_reference_operation IS NOT DISTINCT FROM OLD.synthetic_reference_operation THEN
    RAISE EXCEPTION 'Reference-aware combined command required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_synthetic_reference_draft BEFORE UPDATE ON app_private.listing_revisions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_synthetic_reference_draft();

CREATE FUNCTION app_api.save_synthetic_reference_draft(p_id uuid,p_revision integer,p_expected bigint,
  p_operation uuid,p_content jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_current app_private.listing_revisions; v_prior app_private.synthetic_reference_draft_receipts;
  v_catalogue bigint; v_county uuid; v_locality uuid; v_area uuid; v_ids uuid[];
  v_snapshot jsonb; v_location jsonb; v_amenities jsonb; v_version bigint; v_receipt jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); PERFORM app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected,false);
  IF p_operation IS NULL OR p_revision IS NULL OR p_revision<1 THEN
    RAISE EXCEPTION 'Explicit operation and existing revision required' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_prior FROM app_private.synthetic_reference_draft_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
  IF FOUND THEN
    IF v_prior.actor_id<>app_private.context_actor() OR v_prior.listing_id<>p_id OR v_prior.revision_no<>p_revision
      OR v_prior.expected_version<>p_expected OR v_prior.content IS DISTINCT FROM p_content OR v_prior.selection IS DISTINCT FROM p_selection
      THEN RAISE EXCEPTION 'Operation payload conflict' USING ERRCODE='40001'; END IF;
    RETURN v_prior.receipt;
  END IF;
  IF NOT coalesce(app_private.creation_content_valid(p_content),false)
    OR jsonb_typeof(p_selection) IS DISTINCT FROM 'object'
    OR NOT (p_selection ?& ARRAY['catalogueVersion','location','amenityIds'])
    OR p_selection-ARRAY['catalogueVersion','location','amenityIds']<>'{}'::jsonb
    OR jsonb_typeof(p_selection->'catalogueVersion') IS DISTINCT FROM 'string'
    OR p_selection->>'catalogueVersion' !~ '^[1-9][0-9]{0,15}$'
    THEN RAISE EXCEPTION 'Invalid combined draft' USING ERRCODE='23514'; END IF;
  v_catalogue:=(p_selection->>'catalogueVersion')::bigint;
  IF v_catalogue IS DISTINCT FROM (SELECT version FROM app_private.synthetic_reference_catalogue_current WHERE singleton)
    THEN RAISE EXCEPTION 'Stale reference catalogue' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_selection->'location') IS DISTINCT FROM 'object'
    OR NOT (p_selection->'location' ?& ARRAY['countyId','localityId','neighbourhoodId'])
    OR (p_selection->'location')-ARRAY['countyId','localityId','neighbourhoodId']<>'{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_selection->'location') e
      WHERE e.value<>'null'::jsonb AND (jsonb_typeof(e.value)<>'string'
        OR e.value #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
    OR jsonb_typeof(p_selection->'amenityIds') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Invalid reference selection' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(p_selection->'amenityIds')>50 OR EXISTS
    (SELECT 1 FROM jsonb_array_elements(p_selection->'amenityIds') e
      WHERE jsonb_typeof(e.value)<>'string' OR e.value #>> '{}' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    THEN RAISE EXCEPTION 'Invalid amenity IDs' USING ERRCODE='23514'; END IF;
  v_county:=(p_selection->'location'->>'countyId')::uuid;
  v_locality:=(p_selection->'location'->>'localityId')::uuid;
  v_area:=(p_selection->'location'->>'neighbourhoodId')::uuid;
  IF (v_county IS NULL AND (v_locality IS NOT NULL OR v_area IS NOT NULL))
    OR (v_locality IS NULL AND v_area IS NOT NULL)
    OR (v_county IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_private.synthetic_reference_locations
      WHERE catalogue_version=v_catalogue AND id=v_county AND kind='county'))
    OR (v_locality IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_private.synthetic_reference_locations
      WHERE catalogue_version=v_catalogue AND id=v_locality AND kind='locality' AND parent_id=v_county))
    OR (v_area IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_private.synthetic_reference_locations
      WHERE catalogue_version=v_catalogue AND id=v_area AND kind='neighbourhood' AND parent_id=v_locality))
    THEN RAISE EXCEPTION 'Invalid location chain' USING ERRCODE='23514'; END IF;
  SELECT coalesce(array_agg(value::uuid ORDER BY value),ARRAY[]::uuid[]) INTO v_ids
    FROM jsonb_array_elements_text(p_selection->'amenityIds');
  IF cardinality(v_ids)<>(SELECT count(DISTINCT value) FROM unnest(v_ids) value)
    OR EXISTS (SELECT 1 FROM unnest(v_ids) value WHERE NOT EXISTS
      (SELECT 1 FROM app_private.synthetic_reference_amenities a WHERE a.catalogue_version=v_catalogue
        AND a.id=value AND p_content->>'propertyType'=ANY(a.property_types)))
    THEN RAISE EXCEPTION 'Inapplicable or duplicate amenity' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('county',max(label) FILTER (WHERE id=v_county),
    'town',max(label) FILTER (WHERE id=v_locality),'area',max(label) FILTER (WHERE id=v_area)) INTO v_location
    FROM app_private.synthetic_reference_locations WHERE catalogue_version=v_catalogue;
  IF p_content->'location' IS DISTINCT FROM v_location THEN
    RAISE EXCEPTION 'Explicit disclosure must match selected labels' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'label',label) ORDER BY id),'[]'::jsonb)
    INTO v_amenities FROM app_private.synthetic_reference_amenities WHERE catalogue_version=v_catalogue AND id=ANY(v_ids);
  SELECT jsonb_build_object('catalogueVersion',v_catalogue::text,'country','KE',
    'location',jsonb_build_object(
      'county',(SELECT jsonb_build_object('id',id,'label',label) FROM app_private.synthetic_reference_locations WHERE catalogue_version=v_catalogue AND id=v_county),
      'locality',(SELECT jsonb_build_object('id',id,'label',label) FROM app_private.synthetic_reference_locations WHERE catalogue_version=v_catalogue AND id=v_locality),
      'neighbourhood',(SELECT jsonb_build_object('id',id,'label',label) FROM app_private.synthetic_reference_locations WHERE catalogue_version=v_catalogue AND id=v_area)),
    'amenities',v_amenities) INTO v_snapshot;
  SELECT * INTO v_current FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant()
    AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND OR v_current.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF v_current.state<>'draft' THEN RAISE EXCEPTION 'Only existing drafts may be edited' USING ERRCODE='23514'; END IF;
  -- One UPDATE: the existing touch_revision trigger advances the editorial version exactly once.
  UPDATE app_private.listing_revisions SET title=p_content->>'title',description=p_content->>'description',
    purpose=p_content->>'purpose',property_type=p_content->>'propertyType',currency=p_content->>'currency',
    amount_minor=(p_content->>'amountMinor')::bigint,rent_period=p_content->>'rentPeriod',bedrooms=(p_content->>'bedrooms')::integer,
    private_bathrooms=(p_content->>'privateBathrooms')::integer,shared_bathrooms=(p_content->>'sharedBathrooms')::integer,
    country=p_content->>'country',locality=p_content->>'locality',public_precision=p_content->>'publicPrecision',
    latitude=(p_content->>'latitude')::numeric,longitude=(p_content->>'longitude')::numeric,
    private_address=p_content->>'privateAddress',pricing=p_content->'pricing',location=p_content->'location',
    synthetic_reference_attributes=v_snapshot,synthetic_reference_operation=p_operation
    WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision RETURNING version INTO v_version;
  v_receipt:=jsonb_build_object('operationId',p_operation,'listingId',p_id,'revision',p_revision,
    'revisionVersion',v_version::text,'attributes',v_snapshot);
  INSERT INTO app_private.synthetic_reference_draft_receipts VALUES(app_private.context_tenant(),p_operation,
    app_private.context_actor(),p_id,p_revision,p_expected,p_content,p_selection,v_receipt);
  PERFORM app_private.audit('revision.synthetic_references_saved','listing',p_id,v_version,jsonb_build_object('revision',p_revision));
  RETURN v_receipt;
END $$;

CREATE FUNCTION app_api.read_synthetic_reference_draft(p_id uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); PERFORM app_private.lock_listing(p_id);
  SELECT receipt INTO v_result FROM app_private.synthetic_reference_draft_receipts WHERE tenant_id=app_private.context_tenant()
    AND listing_id=p_id AND operation_id=p_operation AND actor_id=app_private.context_actor();
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_synthetic_reference_draft(),
  app_api.save_synthetic_reference_draft(uuid,integer,bigint,uuid,jsonb,jsonb),app_api.read_synthetic_reference_draft(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.save_synthetic_reference_draft(uuid,integer,bigint,uuid,jsonb,jsonb),
  app_api.read_synthetic_reference_draft(uuid,uuid) TO api_runtime;
RESET ROLE;
COMMIT;

-- Explicit second isolated candidate, loaded after listing-reference-draft.sql.
-- Migration-owner ingestion only: never a runtime route or catalogue supplied by a listing caller.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.install_synthetic_reference_catalogue(p_expected bigint,p_catalogue jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_version bigint; v_current bigint; v_prior jsonb; v_row jsonb; v_ids uuid[]:=ARRAY[]::uuid[];
  v_codes text[]:=ARRAY[]::text[]; v_id uuid; v_types text[];
BEGIN
  -- Serializes activation even for two independent owner transactions.
  SELECT version INTO v_current FROM app_private.synthetic_reference_catalogue_current WHERE singleton FOR UPDATE;
  IF p_expected IS NULL OR p_expected<0 OR jsonb_typeof(p_catalogue) IS DISTINCT FROM 'object'
    OR NOT (p_catalogue ?& ARRAY['policy','version','country','locations','amenities'])
    OR p_catalogue-ARRAY['policy','version','country','locations','amenities']<>'{}'::jsonb
    OR p_catalogue->'policy' IS DISTINCT FROM '"synthetic-reference-catalogue-v1"'::jsonb
    OR p_catalogue->'country' IS DISTINCT FROM '"KE"'::jsonb
    OR jsonb_typeof(p_catalogue->'version') IS DISTINCT FROM 'string'
    OR p_catalogue->>'version' !~ '^[1-9][0-9]{0,15}$'
    OR jsonb_typeof(p_catalogue->'locations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_catalogue->'amenities') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Invalid synthetic catalogue' USING ERRCODE='23514'; END IF;
  v_version:=(p_catalogue->>'version')::bigint;
  IF v_version>9007199254740991 OR jsonb_array_length(p_catalogue->'locations')>5000
    OR jsonb_array_length(p_catalogue->'amenities')>100
    THEN RAISE EXCEPTION 'Catalogue bounds exceeded' USING ERRCODE='23514'; END IF;
  SELECT payload INTO v_prior FROM app_private.synthetic_reference_catalogues WHERE version=v_version;
  IF FOUND THEN
    IF v_prior IS DISTINCT FROM p_catalogue THEN RAISE EXCEPTION 'Catalogue version conflict' USING ERRCODE='40001'; END IF;
    -- Replay retains its original installation; never reactivate a superseded version.
    RETURN v_version;
  END IF;
  IF coalesce(v_current,0)<>p_expected OR v_version<=coalesce(v_current,0)
    THEN RAISE EXCEPTION 'Catalogue activation conflict' USING ERRCODE='40001'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_catalogue->'locations') LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' OR NOT (v_row ?& ARRAY['id','kind','parentId','label'])
      OR v_row-ARRAY['id','kind','parentId','label']<>'{}'::jsonb
      OR jsonb_typeof(v_row->'id') IS DISTINCT FROM 'string'
      OR v_row->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(v_row->'kind') IS DISTINCT FROM 'string'
      OR v_row->>'kind' NOT IN ('county','locality','neighbourhood')
      OR NOT coalesce(app_private.disclosure_text_valid(v_row->'label',160),false)
      OR v_row->>'label' IS DISTINCT FROM normalize(v_row->>'label',NFC)
      THEN RAISE EXCEPTION 'Invalid catalogue location' USING ERRCODE='23514'; END IF;
    IF v_row->'parentId'<>'null'::jsonb AND (jsonb_typeof(v_row->'parentId')<>'string'
      OR v_row->>'parentId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      THEN RAISE EXCEPTION 'Invalid location parent ID' USING ERRCODE='23514'; END IF;
    v_id:=(v_row->>'id')::uuid;
    IF v_id=ANY(v_ids) THEN RAISE EXCEPTION 'Duplicate reference ID' USING ERRCODE='23514'; END IF;
    v_ids:=array_append(v_ids,v_id);
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_catalogue->'amenities') LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' OR NOT (v_row ?& ARRAY['id','code','label','propertyTypes'])
      OR v_row-ARRAY['id','code','label','propertyTypes']<>'{}'::jsonb
      OR jsonb_typeof(v_row->'id') IS DISTINCT FROM 'string'
      OR v_row->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(v_row->'code') IS DISTINCT FROM 'string' OR length(v_row->>'code')>64
      OR v_row->>'code' !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
      OR NOT coalesce(app_private.disclosure_text_valid(v_row->'label',160),false)
      OR v_row->>'label' IS DISTINCT FROM normalize(v_row->>'label',NFC)
      OR jsonb_typeof(v_row->'propertyTypes') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'Invalid catalogue amenity' USING ERRCODE='23514'; END IF;
    IF jsonb_array_length(v_row->'propertyTypes') NOT BETWEEN 1 AND 9 OR EXISTS
      (SELECT 1 FROM jsonb_array_elements(v_row->'propertyTypes') e WHERE jsonb_typeof(e.value)<>'string'
        OR e.value #>> '{}' NOT IN ('apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land'))
      THEN RAISE EXCEPTION 'Invalid amenity property types' USING ERRCODE='23514'; END IF;
    SELECT array_agg(value) INTO v_types FROM jsonb_array_elements_text(v_row->'propertyTypes');
    v_id:=(v_row->>'id')::uuid;
    IF v_id=ANY(v_ids) OR v_row->>'code'=ANY(v_codes)
      OR cardinality(v_types)<>(SELECT count(DISTINCT t) FROM unnest(v_types) t)
      THEN RAISE EXCEPTION 'Duplicate amenity facts' USING ERRCODE='23514'; END IF;
    v_ids:=array_append(v_ids,v_id);v_codes:=array_append(v_codes,v_row->>'code');
  END LOOP;
  INSERT INTO app_private.synthetic_reference_catalogues VALUES(v_version,p_catalogue);
  -- A single statement allows valid child-before-parent input; typed self-FKs enforce every edge.
  INSERT INTO app_private.synthetic_reference_locations
    SELECT v_version,(value->>'id')::uuid,value->>'kind',(value->>'parentId')::uuid,
      CASE value->>'kind' WHEN 'locality' THEN 'county' WHEN 'neighbourhood' THEN 'locality' ELSE NULL END,value->>'label'
      FROM jsonb_array_elements(p_catalogue->'locations');
  INSERT INTO app_private.synthetic_reference_amenities
    SELECT v_version,(value->>'id')::uuid,value->>'code',value->>'label',
      ARRAY(SELECT jsonb_array_elements_text(value->'propertyTypes'))
      FROM jsonb_array_elements(p_catalogue->'amenities');
  UPDATE app_private.synthetic_reference_catalogue_current SET version=v_version WHERE singleton;
  RETURN v_version;
END $$;
REVOKE ALL ON FUNCTION app_private.install_synthetic_reference_catalogue(bigint,jsonb) FROM PUBLIC,api_runtime;
RESET ROLE;
COMMIT;

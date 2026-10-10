-- Ordered extension of 0001; no cloud/provider changes or legacy-data completeness claim.
BEGIN;
SET LOCAL ROLE realtor_owner;

-- New v2 string bounds count Unicode code points, matching PostgreSQL char_length.
-- Require canonical input rather than silently trimming it. The trim set matches
-- ECMAScript whitespace; C0/DEL/C1 controls are rejected everywhere in these fields.
CREATE FUNCTION app_private.disclosure_text_valid(p_value jsonb,p_max integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_text text; v_whitespace text := E' \t\n\r\f' || chr(11) || chr(160) || chr(5760)
  || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198)
  || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233)
  || chr(8239) || chr(8287) || chr(12288) || chr(65279);
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  v_text := p_value #>> '{}';
  RETURN char_length(v_text) BETWEEN 1 AND p_max AND v_text=btrim(v_text,v_whitespace)
    AND v_text !~ U&'[\0001-\001f\007f-\009f]';
END $$;

CREATE FUNCTION app_private.pricing_disclosure_valid(p_pricing jsonb,p_purpose text,p_base bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_charge jsonb; v_id text; v_ids text[] := ARRAY[]::text[]; v_amount numeric;
  v_mandatory numeric := coalesce(p_base,0); v_optional numeric := 0;
BEGIN
  IF jsonb_typeof(p_pricing) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (p_pricing ?& ARRAY['declaration','charges']) OR p_pricing-ARRAY['declaration','charges']<>'{}'::jsonb
    OR jsonb_typeof(p_pricing->'declaration') IS DISTINCT FROM 'string'
    OR p_pricing->>'declaration' NOT IN ('not_declared','incomplete','complete')
    OR jsonb_typeof(p_pricing->'charges') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_pricing->'charges')>32 OR (p_purpose IS NULL AND jsonb_array_length(p_pricing->'charges')<>0)
    OR (p_purpose IS NOT NULL AND p_purpose NOT IN ('rent','sale')) THEN RETURN false; END IF;
  FOR v_charge IN SELECT value FROM jsonb_array_elements(p_pricing->'charges') LOOP
    IF jsonb_typeof(v_charge) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (v_charge ?& ARRAY['id','name','amountStatus','amountMinor','timing','classification','mandatory'])
      OR v_charge-ARRAY['id','name','amountStatus','amountMinor','timing','classification','mandatory']<>'{}'::jsonb
      OR NOT app_private.disclosure_text_valid(v_charge->'id',64)
      OR NOT app_private.disclosure_text_valid(v_charge->'name',160)
      OR jsonb_typeof(v_charge->'mandatory') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(v_charge->'timing') IS DISTINCT FROM 'string'
      OR v_charge->>'timing' NOT IN ('one_off','per_rental_period')
      OR jsonb_typeof(v_charge->'classification') IS DISTINCT FROM 'string'
      OR v_charge->>'classification' NOT IN ('fee','refundable_deposit')
      OR jsonb_typeof(v_charge->'amountStatus') IS DISTINCT FROM 'string'
      OR v_charge->>'amountStatus' NOT IN ('known','quote_required') THEN RETURN false; END IF;
    v_id := v_charge->>'id';
    IF v_id=ANY(v_ids) THEN RETURN false; END IF;
    v_ids := array_append(v_ids,v_id);
    IF (v_charge->>'timing'='per_rental_period' AND p_purpose IS DISTINCT FROM 'rent')
      OR (v_charge->>'classification'='refundable_deposit' AND v_charge->>'timing'<>'one_off') THEN RETURN false; END IF;
    IF v_charge->>'amountStatus'='quote_required' THEN
      IF v_charge->'amountMinor' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(v_charge->'amountMinor') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      v_amount := (v_charge->>'amountMinor')::numeric;
      IF v_amount<1 OR v_amount>9007199254740991 OR v_amount<>trunc(v_amount) THEN RETURN false; END IF;
      IF (v_charge->>'mandatory')::boolean THEN v_mandatory:=v_mandatory+v_amount;
      ELSE v_optional:=v_optional+v_amount; END IF;
    END IF;
  END LOOP;
  -- All known mandatory costs contribute to the first period/base payment; optional
  -- extras are a separate subtotal. Numeric arithmetic prevents pre-check precision loss.
  RETURN v_mandatory BETWEEN 0 AND 9007199254740991 AND v_optional BETWEEN 0 AND 9007199254740991;
END $$;

CREATE FUNCTION app_private.public_location_valid(p_location jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_key text;
BEGIN
  IF jsonb_typeof(p_location) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (p_location ?& ARRAY['county','town','area']) OR p_location-ARRAY['county','town','area']<>'{}'::jsonb THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['county','town','area'] LOOP
    IF p_location->v_key IS DISTINCT FROM 'null'::jsonb AND NOT app_private.disclosure_text_valid(p_location->v_key,160) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE app_private.listing_revisions
  ADD COLUMN pricing jsonb NOT NULL DEFAULT '{"declaration":"not_declared","charges":[]}'::jsonb,
  ADD COLUMN location jsonb NOT NULL DEFAULT '{"county":null,"town":null,"area":null}'::jsonb,
  ADD CONSTRAINT revision_pricing_valid CHECK (app_private.pricing_disclosure_valid(pricing,purpose,amount_minor)),
  ADD CONSTRAINT revision_location_valid CHECK (app_private.public_location_valid(location));
ALTER TABLE app_private.public_snapshots
  ADD COLUMN pricing jsonb NOT NULL DEFAULT '{"declaration":"not_declared","charges":[]}'::jsonb,
  ADD COLUMN location jsonb NOT NULL DEFAULT '{"county":null,"town":null,"area":null}'::jsonb,
  ADD CONSTRAINT snapshot_pricing_valid CHECK (app_private.pricing_disclosure_valid(pricing,purpose,amount_minor)),
  ADD CONSTRAINT snapshot_location_valid CHECK (app_private.public_location_valid(location));

-- Keep 0001's decision command, availability/role/version rules and pause/archive
-- behavior intact. Its positional INSERT uses the original columns; these trailing
-- columns have defaults and this trigger copies the exact decided revision instead.
CREATE FUNCTION app_private.copy_snapshot_disclosure() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  SELECT r.pricing,r.location INTO NEW.pricing,NEW.location FROM app_private.listing_revisions r
    WHERE r.tenant_id=NEW.tenant_id AND r.listing_id=NEW.listing_id AND r.revision_no=NEW.revision_no AND r.state='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved revision required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_snapshot_disclosure BEFORE INSERT OR UPDATE ON app_private.public_snapshots
  FOR EACH ROW EXECUTE FUNCTION app_private.copy_snapshot_disclosure();

-- A separate single UPDATE is intentional: applying the legacy base/purpose first
-- would validate it against stale pricing and reject a valid atomic rent-to-sale edit.
-- This retains the bounded v1 locking, authorization, sequencing and scalar validation.
CREATE FUNCTION app_api.save_draft_v2(p_id uuid,p_revision integer,p_expected bigint,p_content jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_current app_private.listing_revisions; v_next integer; v_version bigint; v_base jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); PERFORM app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected,true);
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' OR NOT (p_content ?& ARRAY['pricing','location']) THEN
    RAISE EXCEPTION 'Pricing and location required' USING ERRCODE='23514'; END IF;
  v_base := p_content-ARRAY['pricing','location'];
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_base) k WHERE k NOT IN
    ('title','description','purpose','propertyType','currency','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','country','locality','publicPrecision','latitude','longitude','privateAddress'))
    THEN RAISE EXCEPTION 'Invalid content fields' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(v_base) e WHERE
    CASE WHEN e.key IN ('amountMinor','bedrooms','privateBathrooms','sharedBathrooms','latitude','longitude')
      THEN jsonb_typeof(e.value) NOT IN ('number','null') ELSE jsonb_typeof(e.value) NOT IN ('string','null') END)
    THEN RAISE EXCEPTION 'Invalid content types' USING ERRCODE='23514'; END IF;
  IF (v_base->>'amountMinor') IS NOT NULL AND (v_base->>'amountMinor') !~ '^[0-9]+$'
    THEN RAISE EXCEPTION 'Money must use integer minor units' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_current FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
  IF FOUND THEN
    IF v_current.state<>'draft' THEN RAISE EXCEPTION 'Only drafts may be edited' USING ERRCODE='23514'; END IF;
    IF v_current.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  ELSE
    SELECT coalesce(max(revision_no),0)+1 INTO v_next FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id;
    IF p_expected<>0 OR p_revision<>v_next THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
    INSERT INTO app_private.listing_revisions(tenant_id,listing_id,revision_no) VALUES(app_private.context_tenant(),p_id,p_revision);
  END IF;
  UPDATE app_private.listing_revisions SET title=nullif(btrim(v_base->>'title'),''),description=nullif(btrim(v_base->>'description'),''),
    purpose=v_base->>'purpose',property_type=v_base->>'propertyType',currency=coalesce(v_base->>'currency','KES'),
    amount_minor=(v_base->>'amountMinor')::bigint,rent_period=v_base->>'rentPeriod',bedrooms=(v_base->>'bedrooms')::integer,
    private_bathrooms=(v_base->>'privateBathrooms')::integer,shared_bathrooms=(v_base->>'sharedBathrooms')::integer,
    country=coalesce(v_base->>'country','KE'),locality=nullif(btrim(v_base->>'locality'),''),
    public_precision=coalesce(v_base->>'publicPrecision','area'),latitude=(v_base->>'latitude')::numeric,
    longitude=(v_base->>'longitude')::numeric,private_address=v_base->>'privateAddress',
    pricing=p_content->'pricing',location=p_content->'location'
    WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision RETURNING version INTO v_version;
  PERFORM app_private.audit('revision.saved','listing',p_id,v_version,jsonb_build_object('revision',p_revision,'contract','v2'));
  RETURN v_version;
END $$;

CREATE VIEW app_api.public_listings_v2 WITH (security_barrier=true) AS
  SELECT p.*,s.pricing,s.location FROM app_api.public_listings p
  JOIN app_private.public_snapshots s ON s.tenant_id=p.tenant_id AND s.listing_id=p.listing_id AND s.revision_no=p.revision_no;
REVOKE ALL ON FUNCTION app_private.disclosure_text_valid(jsonb,integer),app_private.pricing_disclosure_valid(jsonb,text,bigint),
  app_private.public_location_valid(jsonb),app_private.copy_snapshot_disclosure(),app_api.save_draft_v2(uuid,integer,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.save_draft_v2(uuid,integer,bigint,jsonb) TO api_runtime;
GRANT SELECT ON app_api.public_listings_v2 TO api_runtime;
RESET ROLE;
COMMIT;

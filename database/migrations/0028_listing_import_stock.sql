-- Read-only candidate intersection. Preview does not reserve or create stock.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.read_listing_import_stock(p_slugs text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_slug text; v_result jsonb;
BEGIN
  IF app_private.staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  IF p_slugs IS NULL OR coalesce(array_ndims(p_slugs),0)<>1
    OR array_lower(p_slugs,1)<>1 OR cardinality(p_slugs) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid import candidates' USING ERRCODE='23514';
  END IF;
  FOREACH v_slug IN ARRAY p_slugs LOOP
    IF v_slug IS NULL OR length(v_slug) NOT BETWEEN 1 AND 160
      OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'Invalid import candidates' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT s) FROM unnest(p_slugs) AS s)<>cardinality(p_slugs) THEN
    RAISE EXCEPTION 'Invalid import candidates' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(l.slug ORDER BY l.slug COLLATE "C"),'[]'::jsonb)
    INTO v_result FROM app_private.listings l
    WHERE l.tenant_id=app_private.context_tenant() AND l.slug=ANY(p_slugs);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION app_api.read_listing_import_stock(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_import_stock(text[]) TO api_runtime;
COMMIT;

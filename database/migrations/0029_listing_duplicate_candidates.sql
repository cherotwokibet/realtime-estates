-- Conservative current-work duplicate hints only. Never merge, reserve or mutate.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.listing_duplicate_key(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT translate(btrim(regexp_replace(p_text,'[[:space:]]+',' ','g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
$$;
REVOKE ALL ON FUNCTION app_private.listing_duplicate_key(text) FROM PUBLIC;
CREATE FUNCTION app_api.read_listing_duplicate_candidates(
  p_listing uuid,p_listing_version bigint,p_revision integer,p_revision_version bigint,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_target record; v_matches jsonb; v_more boolean; v_complete boolean;
BEGIN
  IF app_private.staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  IF p_listing IS NULL OR p_listing_version IS NULL OR p_listing_version NOT BETWEEN 1 AND 9007199254740991
    OR p_revision IS NULL OR p_revision<1 OR p_revision_version IS NULL
    OR p_revision_version NOT BETWEEN 1 AND 9007199254740991
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'Invalid duplicate request' USING ERRCODE='23514';
  END IF;
  SELECT l.version AS listing_version,r.revision_no,r.version AS revision_version,
    r.purpose,r.property_type,app_private.listing_duplicate_key(r.title) AS title_key,
    app_private.listing_duplicate_key(r.locality) AS locality_key
    INTO v_target FROM app_private.listings l
    JOIN LATERAL (SELECT x.* FROM app_private.listing_revisions x
      WHERE x.tenant_id=l.tenant_id AND x.listing_id=l.id ORDER BY x.revision_no DESC LIMIT 1) r ON true
    WHERE l.tenant_id=app_private.context_tenant() AND l.id=p_listing;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
  IF v_target.listing_version<>p_listing_version OR v_target.revision_no<>p_revision
    OR v_target.revision_version<>p_revision_version THEN
    RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';
  END IF;
  v_complete:=coalesce(length(v_target.title_key)>=8 AND length(v_target.locality_key)>0
    AND v_target.purpose IS NOT NULL AND v_target.property_type IS NOT NULL,false);
  WITH candidates AS (
    SELECT l.id,l.slug,l.version AS listing_version,l.availability,l.publication_status,
      r.revision_no,r.version AS revision_version,r.state
    FROM app_private.listings l
    JOIN LATERAL (SELECT x.* FROM app_private.listing_revisions x
      WHERE x.tenant_id=l.tenant_id AND x.listing_id=l.id ORDER BY x.revision_no DESC LIMIT 1) r ON true
    WHERE v_complete AND l.tenant_id=app_private.context_tenant() AND l.id<>p_listing
      AND r.purpose=v_target.purpose AND r.property_type=v_target.property_type
      AND app_private.listing_duplicate_key(r.title)=v_target.title_key
      AND app_private.listing_duplicate_key(r.locality)=v_target.locality_key
    ORDER BY l.id LIMIT p_limit+1
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY id) AS n FROM candidates)
  SELECT coalesce(jsonb_agg(jsonb_build_object('listingId',id,'slug',slug,
    'listingVersion',listing_version::text,'revision',revision_no,'revisionVersion',revision_version::text,
    'revisionState',state,'availability',availability,'publicationStatus',publication_status)
    ORDER BY id) FILTER(WHERE n<=p_limit),'[]'::jsonb),coalesce(bool_or(n>p_limit),false)
    INTO v_matches,v_more FROM numbered;
  RETURN jsonb_build_object('kind','listing_duplicate_candidates','policy','exact-current-work-v1',
    'target',jsonb_build_object('listingId',p_listing,'listingVersion',p_listing_version::text,
      'revision',p_revision,'revisionVersion',p_revision_version::text),
    'comparison',CASE WHEN v_complete THEN 'compared' ELSE 'insufficient_facts' END,
    'matches',v_matches,'hasMore',v_more);
END $$;
REVOKE ALL ON FUNCTION app_api.read_listing_duplicate_candidates(uuid,bigint,integer,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_duplicate_candidates(uuid,bigint,integer,bigint,integer) TO api_runtime;
COMMIT;

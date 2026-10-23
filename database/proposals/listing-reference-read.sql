-- Isolated reference API candidate. Load after draft and catalogue installation proposals.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_api.read_synthetic_reference_catalogue(p_version bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_payload jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  IF p_version IS NOT NULL AND (p_version<1 OR p_version>9007199254740991) THEN
    RAISE EXCEPTION 'Invalid catalogue version' USING ERRCODE='23514'; END IF;
  SELECT payload INTO v_payload FROM app_private.synthetic_reference_catalogues WHERE version=coalesce(p_version,
    (SELECT version FROM app_private.synthetic_reference_catalogue_current WHERE singleton));
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  RETURN v_payload;
END $$;
CREATE FUNCTION app_api.read_synthetic_reference_draft_context(p_id uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_request app_private.synthetic_reference_draft_receipts; v_selection jsonb; v_ids jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);PERFORM app_private.lock_listing(p_id);
  SELECT * INTO v_request FROM app_private.synthetic_reference_draft_receipts WHERE tenant_id=app_private.context_tenant()
    AND listing_id=p_id AND operation_id=p_operation AND actor_id=app_private.context_actor();
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO v_ids FROM jsonb_array_elements_text(v_request.selection->'amenityIds');
  v_selection:=jsonb_set(v_request.selection,'{amenityIds}',v_ids);
  RETURN jsonb_build_object('command',jsonb_build_object('policy','synthetic-reference-draft-v1',
    'operationId',v_request.operation_id,'listingId',v_request.listing_id,'revision',v_request.revision_no,
    'expectedVersion',v_request.expected_version::text,'content',v_request.content,'selection',v_selection),
    'receipt',v_request.receipt,'catalogue',app_api.read_synthetic_reference_catalogue((v_request.selection->>'catalogueVersion')::bigint));
END $$;
REVOKE ALL ON FUNCTION app_api.read_synthetic_reference_catalogue(bigint),app_api.read_synthetic_reference_draft_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_reference_catalogue(bigint),app_api.read_synthetic_reference_draft_context(uuid,uuid) TO api_runtime;
RESET ROLE;
COMMIT;

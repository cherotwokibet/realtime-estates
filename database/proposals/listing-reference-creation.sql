-- ISOLATED SYNTHETIC CANDIDATE. Load after the four reference proposals.
-- Compose existing guarded allocation and reference save in one transaction.
-- No new default migration, runtime DML, media acceptance or publication authority.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.synthetic_reference_creation_receipts (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL, listing_id uuid NOT NULL,
  actor_id uuid NOT NULL, slug text NOT NULL, content jsonb NOT NULL,
  selection jsonb NOT NULL, receipt jsonb NOT NULL,
  PRIMARY KEY(tenant_id,operation_id),
  FOREIGN KEY(tenant_id,operation_id,listing_id)
    REFERENCES app_private.listing_creation_requests(tenant_id,operation_id,listing_id),
  FOREIGN KEY(tenant_id,operation_id)
    REFERENCES app_private.synthetic_reference_draft_receipts(tenant_id,operation_id)
);
ALTER TABLE app_private.synthetic_reference_creation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_reference_creation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.synthetic_reference_creation_receipts TO realtor_owner
  USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_reference_creation_receipt BEFORE UPDATE OR DELETE
  ON app_private.synthetic_reference_creation_receipts FOR EACH ROW
  EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_reference_creation_receipts FROM PUBLIC,api_runtime;

CREATE FUNCTION app_api.create_synthetic_reference_listing(
  p_listing uuid,p_operation uuid,p_slug text,p_content jsonb,p_selection jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_creation jsonb; v_saved jsonb; v_receipt jsonb;
  v_prior app_private.synthetic_reference_creation_receipts;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  SELECT * INTO v_prior FROM app_private.synthetic_reference_creation_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
  IF FOUND THEN
    -- Re-check the original actor's current role and assignment before returning
    -- private facts, even when a fully matching original is retained.
    PERFORM app_api.read_listing_creation(p_listing,p_operation);
    IF v_prior.listing_id IS DISTINCT FROM p_listing
      OR v_prior.actor_id IS DISTINCT FROM app_private.context_actor()
      OR v_prior.slug IS DISTINCT FROM p_slug OR v_prior.content IS DISTINCT FROM p_content
      OR v_prior.selection IS DISTINCT FROM p_selection THEN
      RAISE EXCEPTION 'Operation payload conflict' USING ERRCODE='40001';
    END IF;
    RETURN v_prior.receipt;
  END IF;
  v_creation:=app_api.create_listing_draft_v2(p_listing,p_operation,p_slug,p_content);
  -- A target collision aborts the entire composed command. It cannot retain a
  -- v2-only refusal lacking this command's full reference selection.
  IF v_creation->>'outcome' IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'Reference creation target unavailable' USING ERRCODE='40001';
  END IF;
  -- The existing append-only original binds actor, listing, content and exact
  -- selection before any replay. New selection validation locks the current
  -- catalogue through the transaction. Any failure rolls allocation back too.
  v_saved:=app_api.save_synthetic_reference_draft(
    p_listing,1,2,p_operation,p_content,p_selection);
  v_receipt:=jsonb_build_object('policy','synthetic-reference-creation-v1',
    'creation',v_creation,'referenceDraft',v_saved);
  INSERT INTO app_private.synthetic_reference_creation_receipts VALUES(
    app_private.context_tenant(),p_operation,p_listing,app_private.context_actor(),
    p_slug,p_content,p_selection,v_receipt) ON CONFLICT(tenant_id,operation_id) DO NOTHING;
  -- The existing v2 unique operation reservation serializes concurrent matching
  -- calls. Its original and the reference original must both agree before here.
  SELECT receipt INTO v_receipt FROM app_private.synthetic_reference_creation_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
  RETURN v_receipt;
END $$;

CREATE FUNCTION app_api.read_synthetic_reference_creation(p_listing uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_receipt jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  -- The existing read requires the original actor's current role/assignment.
  -- This is observation only: no allocation, save, replay or current-pointer lookup.
  PERFORM app_api.read_listing_creation(p_listing,p_operation);
  SELECT receipt INTO v_receipt FROM app_private.synthetic_reference_creation_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation
      AND listing_id=p_listing AND actor_id=app_private.context_actor();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';
  END IF;
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_api.create_synthetic_reference_listing(uuid,uuid,text,jsonb,jsonb),
  app_api.read_synthetic_reference_creation(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.create_synthetic_reference_listing(uuid,uuid,text,jsonb,jsonb),
  app_api.read_synthetic_reference_creation(uuid,uuid) TO api_runtime;
COMMIT;

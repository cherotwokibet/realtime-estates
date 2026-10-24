-- ISOLATED SYNTHETIC CANDIDATE; load after reference draft/catalogue/read/moderation.
-- Not a default migration. Guarded successor and reference adoption share a transaction.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE TABLE app_private.synthetic_reference_successor_receipts (
  tenant_id uuid NOT NULL, operation_id uuid NOT NULL, listing_id uuid NOT NULL,
  actor_id uuid NOT NULL, expected_listing_version bigint NOT NULL,
  predecessor_revision integer NOT NULL, predecessor_version bigint NOT NULL,
  predecessor_state text NOT NULL, content jsonb NOT NULL, selection jsonb NOT NULL,
  receipt jsonb NOT NULL, PRIMARY KEY(tenant_id,operation_id),
  FOREIGN KEY(tenant_id,operation_id,listing_id)
    REFERENCES app_private.listing_successor_requests(tenant_id,operation_id,listing_id),
  FOREIGN KEY(tenant_id,operation_id)
    REFERENCES app_private.synthetic_reference_draft_receipts(tenant_id,operation_id)
);
ALTER TABLE app_private.synthetic_reference_successor_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_reference_successor_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.synthetic_reference_successor_receipts TO realtor_owner
  USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_reference_successor_receipt BEFORE UPDATE OR DELETE
  ON app_private.synthetic_reference_successor_receipts FOR EACH ROW
  EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_reference_successor_receipts FROM PUBLIC,api_runtime;

CREATE FUNCTION app_api.start_synthetic_reference_successor(
  p_listing uuid,p_operation uuid,p_listing_version bigint,p_predecessor integer,
  p_predecessor_version bigint,p_predecessor_state text,p_content jsonb,p_selection jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_successor jsonb; v_saved jsonb; v_receipt jsonb; v_revision integer;
  v_prior app_private.synthetic_reference_successor_receipts;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  -- Serialize against assignment changes before reading any private original.
  PERFORM app_private.lock_listing(p_listing);
  SELECT * INTO v_prior FROM app_private.synthetic_reference_successor_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
  IF FOUND THEN
    PERFORM app_api.read_listing_successor(p_listing,p_operation);
    IF v_prior.listing_id IS DISTINCT FROM p_listing
      OR v_prior.actor_id IS DISTINCT FROM app_private.context_actor()
      OR v_prior.expected_listing_version IS DISTINCT FROM p_listing_version
      OR v_prior.predecessor_revision IS DISTINCT FROM p_predecessor
      OR v_prior.predecessor_version IS DISTINCT FROM p_predecessor_version
      OR v_prior.predecessor_state IS DISTINCT FROM p_predecessor_state
      OR v_prior.content IS DISTINCT FROM p_content OR v_prior.selection IS DISTINCT FROM p_selection THEN
      RAISE EXCEPTION 'Operation payload conflict' USING ERRCODE='40001';
    END IF;
    RETURN v_prior.receipt;
  END IF;
  v_successor:=app_api.start_listing_revision_v2(p_listing,p_operation,p_listing_version,
    p_predecessor,p_predecessor_version,p_predecessor_state,p_content);
  -- A conflict/refusal cannot retain an incomplete reference-less operation.
  -- The caller must roll back this failed statement/transaction, as for creation.
  IF v_successor->'decision'->>'outcome' IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'Reference successor predecessor unavailable' USING ERRCODE='40001';
  END IF;
  v_revision:=(v_successor->'decision'->'result'->>'revision')::integer;
  IF v_successor->'decision'->'result'->>'revisionVersion' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'Unexpected initial successor revision' USING ERRCODE='23514';
  END IF;
  v_saved:=app_api.save_synthetic_reference_draft(
    p_listing,v_revision,2,p_operation,p_content,p_selection);
  v_receipt:=jsonb_build_object('policy','synthetic-reference-successor-v1',
    'successor',v_successor,'referenceDraft',v_saved);
  INSERT INTO app_private.synthetic_reference_successor_receipts VALUES(
    app_private.context_tenant(),p_operation,p_listing,app_private.context_actor(),
    p_listing_version,p_predecessor,p_predecessor_version,p_predecessor_state,
    p_content,p_selection,v_receipt) ON CONFLICT(tenant_id,operation_id) DO NOTHING;
  -- Underlying operation reservation and listing lock serialize matching calls.
  SELECT receipt INTO v_receipt FROM app_private.synthetic_reference_successor_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation;
  RETURN v_receipt;
END $$;

CREATE FUNCTION app_api.read_synthetic_reference_successor(p_listing uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_receipt jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  PERFORM app_private.lock_listing(p_listing);
  PERFORM app_api.read_listing_successor(p_listing,p_operation);
  SELECT receipt INTO v_receipt FROM app_private.synthetic_reference_successor_receipts
    WHERE tenant_id=app_private.context_tenant() AND operation_id=p_operation
      AND listing_id=p_listing AND actor_id=app_private.context_actor();
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION app_api.start_synthetic_reference_successor(uuid,uuid,bigint,integer,bigint,text,jsonb,jsonb),
  app_api.read_synthetic_reference_successor(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.start_synthetic_reference_successor(uuid,uuid,bigint,integer,bigint,text,jsonb,jsonb),
  app_api.read_synthetic_reference_successor(uuid,uuid) TO api_runtime;
COMMIT;

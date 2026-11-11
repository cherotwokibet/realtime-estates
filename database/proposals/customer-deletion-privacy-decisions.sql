-- Disposable privacy decision ledger. Apply after customer-deletion-follow-up.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;

-- Fixture provisioning designates reviewers. Runtime roles cannot manage designation.
CREATE TABLE app_private.synthetic_deletion_privacy_reviewers (
  tenant_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, reviewer_id),
  FOREIGN KEY (tenant_id, reviewer_id) REFERENCES app_private.memberships (tenant_id, user_id)
);
CREATE TABLE app_private.synthetic_deletion_privacy_decisions (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  request_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('plan_review', 'hold')),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, customer_id),
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, customer_id, request_id)
    REFERENCES app_private.customer_deletion_requests (tenant_id, customer_id, request_id),
  FOREIGN KEY (tenant_id, reviewer_id) REFERENCES app_private.memberships (tenant_id, user_id)
);
ALTER TABLE app_private.synthetic_deletion_privacy_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_deletion_privacy_reviewers FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_deletion_privacy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_deletion_privacy_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.synthetic_deletion_privacy_reviewers TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON app_private.synthetic_deletion_privacy_decisions TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE TRIGGER immutable_synthetic_deletion_privacy_decision BEFORE UPDATE OR DELETE
  ON app_private.synthetic_deletion_privacy_decisions FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_deletion_privacy_reviewers, app_private.synthetic_deletion_privacy_decisions
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_private.synthetic_deletion_privacy_receipt(d app_private.synthetic_deletion_privacy_decisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'policy', 'synthetic-deletion-privacy-decision-v1',
    'retentionProfile', 'synthetic-retention-review-v1',
    'tenantId', d.tenant_id, 'customerId', d.customer_id, 'requestId', d.request_id,
    'operationId', d.operation_id, 'reviewerId', d.reviewer_id, 'decision', d.decision,
    'decidedAt', to_char(d.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

CREATE FUNCTION app_api.record_synthetic_deletion_privacy_decision(
  p_customer uuid, p_request uuid, p_operation uuid, p_decision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  actor uuid := app_private.context_actor();
  saved app_private.synthetic_deletion_privacy_decisions;
  triage app_private.customer_deletion_reviews;
  returned_by uuid;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  PERFORM 1 FROM app_private.tenants WHERE id = company FOR SHARE;
  PERFORM 1 FROM app_private.memberships
    WHERE tenant_id = company AND user_id = actor FOR SHARE;
  PERFORM app_private.assert_staff(ARRAY['admin']);
  PERFORM 1 FROM app_private.synthetic_deletion_privacy_reviewers
    WHERE tenant_id = company AND reviewer_id = actor FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Privacy reviewer access is required' USING ERRCODE = '42501';
  END IF;
  IF p_customer IS NULL OR p_request IS NULL OR p_operation IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('plan_review', 'hold') THEN
    RAISE EXCEPTION 'Invalid privacy decision' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM app_private.customer_deletion_requests
    WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO saved FROM app_private.synthetic_deletion_privacy_decisions
    WHERE tenant_id = company AND customer_id = p_customer;
  IF FOUND THEN
    IF (saved.reviewer_id, saved.operation_id, saved.decision) IS DISTINCT FROM (actor, p_operation, p_decision) THEN
      RAISE EXCEPTION 'Privacy decision conflicts with saved operation' USING ERRCODE = '23505';
    END IF;
    RETURN app_private.synthetic_deletion_privacy_receipt(saved);
  END IF;
  SELECT * INTO triage FROM app_private.customer_deletion_reviews
    WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request;
  SELECT reviewer_id INTO returned_by FROM app_private.customer_deletion_review_returns
    WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request;
  IF triage.disposition IS DISTINCT FROM 'ready_for_privacy_review' AND returned_by IS NULL THEN
    RAISE EXCEPTION 'Request is not ready for privacy review' USING ERRCODE = '23514';
  END IF;
  IF actor = triage.reviewer_id OR actor = returned_by THEN
    RAISE EXCEPTION 'An independent privacy reviewer is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO app_private.synthetic_deletion_privacy_decisions
    (tenant_id, customer_id, request_id, operation_id, reviewer_id, decision)
    VALUES (company, p_customer, p_request, p_operation, actor, p_decision)
    RETURNING * INTO saved;
  PERFORM app_private.audit('customer.deletion_privacy_decided', 'customer_deletion_privacy_decision',
    p_operation, 1, jsonb_build_object('decision', p_decision, 'retentionProfile', 'synthetic-retention-review-v1'));
  RETURN app_private.synthetic_deletion_privacy_receipt(saved);
END $$;

CREATE FUNCTION app_api.read_synthetic_deletion_privacy_decision(p_customer uuid, p_request uuid, p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved app_private.synthetic_deletion_privacy_decisions;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  IF NOT EXISTS (
    SELECT 1 FROM app_private.synthetic_deletion_privacy_reviewers
    WHERE tenant_id = app_private.context_tenant() AND reviewer_id = app_private.context_actor()
  ) THEN
    RAISE EXCEPTION 'Privacy reviewer access is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO saved FROM app_private.synthetic_deletion_privacy_decisions
    WHERE tenant_id = app_private.context_tenant() AND reviewer_id = app_private.context_actor()
      AND customer_id = p_customer AND request_id = p_request AND operation_id = p_operation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Privacy decision unavailable' USING ERRCODE = 'P0002';
  END IF;
  RETURN app_private.synthetic_deletion_privacy_receipt(saved);
END $$;


CREATE FUNCTION app_api.list_synthetic_deletion_privacy_queue(p_limit integer, p_after uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  actor uuid := app_private.context_actor();
  result jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  IF NOT EXISTS (
    SELECT 1 FROM app_private.synthetic_deletion_privacy_reviewers
    WHERE tenant_id = company AND reviewer_id = actor
  ) THEN
    RAISE EXCEPTION 'Privacy reviewer access is required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid privacy queue page' USING ERRCODE = '23514';
  END IF;
  WITH page AS (
    SELECT d.customer_id, d.request_id, coalesce(r.returned_at, d.reviewed_at) AS ready_at
    FROM app_private.customer_deletion_reviews d
    LEFT JOIN app_private.customer_deletion_review_returns r
      USING (tenant_id, customer_id, request_id)
    WHERE d.tenant_id = company AND (p_after IS NULL OR d.customer_id > p_after)
      AND (d.disposition = 'ready_for_privacy_review' OR r.operation_id IS NOT NULL)
      AND d.reviewer_id IS DISTINCT FROM actor AND r.reviewer_id IS DISTINCT FROM actor
      AND NOT EXISTS (
        SELECT 1 FROM app_private.synthetic_deletion_privacy_decisions saved
        WHERE saved.tenant_id = company AND saved.customer_id = d.customer_id
      )
    ORDER BY d.customer_id LIMIT p_limit + 1
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY customer_id) AS rn FROM page
  )
  SELECT jsonb_build_object(
    'policy', 'synthetic-deletion-privacy-queue-v1', 'tenantId', company, 'reviewerId', actor,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'customerId', customer_id, 'requestId', request_id,
      'readyAt', to_char(ready_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY rn) FILTER (WHERE rn <= p_limit), '[]'::jsonb),
    'hasMore', count(*) > p_limit
  ) INTO result FROM numbered;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app_api.list_synthetic_deletion_privacy_queue(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_synthetic_deletion_privacy_queue(integer, uuid) TO api_runtime;

REVOKE ALL ON FUNCTION app_private.synthetic_deletion_privacy_receipt(app_private.synthetic_deletion_privacy_decisions),
  app_api.record_synthetic_deletion_privacy_decision(uuid, uuid, uuid, text),
  app_api.read_synthetic_deletion_privacy_decision(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.record_synthetic_deletion_privacy_decision(uuid, uuid, uuid, text),
  app_api.read_synthetic_deletion_privacy_decision(uuid, uuid, uuid) TO api_runtime;
COMMIT;

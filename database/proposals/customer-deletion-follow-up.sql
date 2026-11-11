-- Synthetic follow-up workflow after customer-deletion-reviews.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;


CREATE TABLE app_private.customer_deletion_review_returns (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  request_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  returned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, customer_id),
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, customer_id, request_id)
    REFERENCES app_private.customer_deletion_requests (tenant_id, customer_id, request_id),
  FOREIGN KEY (tenant_id, reviewer_id)
    REFERENCES app_private.memberships (tenant_id, user_id)
);
ALTER TABLE app_private.customer_deletion_review_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_deletion_review_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.customer_deletion_review_returns TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE TRIGGER immutable_customer_deletion_review_return BEFORE UPDATE OR DELETE
  ON app_private.customer_deletion_review_returns FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.customer_deletion_review_returns
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_private.customer_deletion_return_receipt(r app_private.customer_deletion_review_returns)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-deletion-return-v1', 'tenantId', r.tenant_id,
    'customerId', r.customer_id, 'requestId', r.request_id, 'operationId', r.operation_id,
    'reviewerId', r.reviewer_id,
    'returnedAt', to_char(r.returned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

CREATE FUNCTION app_api.return_customer_deletion_to_review(p_customer uuid, p_request uuid, p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  reviewer uuid := app_private.context_actor();
  original app_private.customer_deletion_review_returns;
  decision text;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  PERFORM 1 FROM app_private.tenants WHERE id = company FOR SHARE;
  PERFORM 1 FROM app_private.memberships
    WHERE tenant_id = company AND user_id = reviewer FOR SHARE;
  PERFORM app_private.assert_staff(ARRAY['admin']);
  IF p_customer IS NULL OR p_request IS NULL OR p_operation IS NULL THEN
    RAISE EXCEPTION 'Invalid return to review' USING ERRCODE = '23514';
  END IF;
  -- Match the original triage lock order and serialize actions on the same request.
  PERFORM 1 FROM app_private.customer_deletion_requests
    WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO original FROM app_private.customer_deletion_review_returns
    WHERE tenant_id = company AND customer_id = p_customer;
  IF FOUND THEN
    IF (original.reviewer_id, original.operation_id) IS DISTINCT FROM (reviewer, p_operation) THEN
      RAISE EXCEPTION 'Return to review conflicts with saved operation' USING ERRCODE = '23505';
    END IF;
    RETURN app_private.customer_deletion_return_receipt(original);
  END IF;
  SELECT disposition INTO decision FROM app_private.customer_deletion_reviews
    WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request;
  IF decision IS DISTINCT FROM 'needs_information' THEN
    RAISE EXCEPTION 'Only requests needing information can return to review' USING ERRCODE = '23514';
  END IF;
  INSERT INTO app_private.customer_deletion_review_returns
    (tenant_id, customer_id, request_id, operation_id, reviewer_id)
    VALUES (company, p_customer, p_request, p_operation, reviewer)
    RETURNING * INTO original;
  PERFORM app_private.audit('customer.deletion_returned_to_review', 'customer_deletion_review_return',
    p_operation, 1, jsonb_build_object('from', 'needs_information', 'to', 'ready_for_privacy_review'));
  RETURN app_private.customer_deletion_return_receipt(original);
END $$;

CREATE FUNCTION app_api.read_customer_deletion_review_return(p_customer uuid, p_request uuid, p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE original app_private.customer_deletion_review_returns;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  SELECT * INTO original FROM app_private.customer_deletion_review_returns
    WHERE tenant_id = app_private.context_tenant() AND reviewer_id = app_private.context_actor()
      AND customer_id = p_customer AND request_id = p_request AND operation_id = p_operation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return to review unavailable' USING ERRCODE = 'P0002';
  END IF;
  RETURN app_private.customer_deletion_return_receipt(original);
END $$;

REVOKE ALL ON FUNCTION app_private.customer_deletion_return_receipt(app_private.customer_deletion_review_returns),
  app_api.return_customer_deletion_to_review(uuid, uuid, uuid),
  app_api.read_customer_deletion_review_return(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.return_customer_deletion_to_review(uuid, uuid, uuid),
  app_api.read_customer_deletion_review_return(uuid, uuid, uuid) TO api_runtime;

CREATE FUNCTION app_api.list_customer_deletion_follow_up(p_disposition text, p_limit integer, p_after uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  result jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_disposition IS NULL
    OR p_disposition NOT IN ('ready_for_privacy_review', 'needs_information') THEN
    RAISE EXCEPTION 'Invalid deletion follow-up page' USING ERRCODE = '23514';
  END IF;

  WITH page AS (
    SELECT d.customer_id, d.request_id, coalesce(r.returned_at, d.reviewed_at) AS reviewed_at
    FROM app_private.customer_deletion_reviews d
    LEFT JOIN app_private.customer_deletion_review_returns r
      ON (r.tenant_id, r.customer_id, r.request_id) = (d.tenant_id, d.customer_id, d.request_id)
    WHERE d.tenant_id = company
      AND (CASE WHEN r.operation_id IS NULL THEN d.disposition ELSE 'ready_for_privacy_review' END) = p_disposition
      AND (p_after IS NULL OR d.customer_id > p_after)
    ORDER BY d.customer_id
    LIMIT p_limit + 1
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY customer_id) AS rn FROM page
  )
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-deletion-follow-up-v1', 'tenantId', company,
    'disposition', p_disposition,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'customerId', customer_id, 'requestId', request_id,
      'reviewedAt', to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY rn) FILTER (WHERE rn <= p_limit), '[]'::jsonb),
    'hasMore', count(*) > p_limit
  ) INTO result FROM numbered;
  RETURN result;
END $$;

CREATE FUNCTION app_api.read_customer_deletion_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app_private.assert_customer();
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-deletion-progress-v1',
    'tenantId', r.tenant_id, 'customerId', r.customer_id, 'requestId', r.request_id,
    'status', CASE
      WHEN f.operation_id IS NOT NULL OR d.disposition = 'ready_for_privacy_review' THEN 'privacy_review_pending'
      WHEN d.disposition = 'needs_information' THEN 'staff_follow_up_pending'
      ELSE 'pending_review'
    END
  ) INTO result
  FROM app_private.customer_deletion_requests r
  LEFT JOIN app_private.customer_deletion_reviews d
    ON (d.tenant_id, d.customer_id, d.request_id) = (r.tenant_id, r.customer_id, r.request_id)
  LEFT JOIN app_private.customer_deletion_review_returns f
    ON (f.tenant_id, f.customer_id, f.request_id) = (r.tenant_id, r.customer_id, r.request_id)
  WHERE r.tenant_id = app_private.context_tenant() AND r.customer_id = app_private.context_actor();
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app_api.list_customer_deletion_follow_up(text, integer, uuid),
  app_api.read_customer_deletion_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_customer_deletion_follow_up(text, integer, uuid),
  app_api.read_customer_deletion_progress() TO api_runtime;
COMMIT;

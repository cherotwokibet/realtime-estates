-- Synthetic internal triage only. Apply after customer-deletion-requests.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;

ALTER TABLE app_private.customer_deletion_requests
  ADD UNIQUE (tenant_id, customer_id, request_id);

CREATE TABLE app_private.customer_deletion_reviews (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  request_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('ready_for_privacy_review', 'needs_information')),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, customer_id),
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, customer_id, request_id)
    REFERENCES app_private.customer_deletion_requests (tenant_id, customer_id, request_id),
  FOREIGN KEY (tenant_id, reviewer_id)
    REFERENCES app_private.memberships (tenant_id, user_id)
);
ALTER TABLE app_private.customer_deletion_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_deletion_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.customer_deletion_reviews TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE TRIGGER immutable_customer_deletion_review BEFORE UPDATE OR DELETE
  ON app_private.customer_deletion_reviews FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.customer_deletion_reviews
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_private.customer_deletion_review_receipt(r app_private.customer_deletion_reviews)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-deletion-review-v1', 'tenantId', r.tenant_id,
    'customerId', r.customer_id, 'requestId', r.request_id, 'operationId', r.operation_id,
    'reviewerId', r.reviewer_id, 'disposition', r.disposition,
    'reviewedAt', to_char(r.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

CREATE FUNCTION app_api.list_customer_deletion_triage(p_limit integer, p_after uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  result jsonb;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid deletion triage page' USING ERRCODE = '23514';
  END IF;

  WITH page AS (
    SELECT r.customer_id, r.request_id, r.requested_at
    FROM app_private.customer_deletion_requests r
    WHERE r.tenant_id = company AND (p_after IS NULL OR r.customer_id > p_after)
      AND NOT EXISTS (
        SELECT 1 FROM app_private.customer_deletion_reviews d
        WHERE d.tenant_id = company AND d.customer_id = r.customer_id
      )
    ORDER BY r.customer_id
    LIMIT p_limit + 1
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY customer_id) AS rn FROM page
  )
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-deletion-triage-v1',
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'customerId', customer_id, 'requestId', request_id,
      'requestedAt', to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY rn) FILTER (WHERE rn <= p_limit), '[]'::jsonb),
    'hasMore', count(*) > p_limit
  ) INTO result FROM numbered;
  RETURN result;
END $$;

CREATE FUNCTION app_api.read_customer_deletion_review(p_customer uuid, p_request uuid, p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE review app_private.customer_deletion_reviews;
BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  SELECT * INTO review FROM app_private.customer_deletion_reviews
    WHERE tenant_id = app_private.context_tenant() AND customer_id = p_customer
      AND request_id = p_request AND operation_id = p_operation
      AND reviewer_id = app_private.context_actor();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review unavailable' USING ERRCODE = 'P0002';
  END IF;
  RETURN app_private.customer_deletion_review_receipt(review);
END $$;

CREATE FUNCTION app_api.review_customer_deletion(
  p_customer uuid, p_request uuid, p_operation uuid, p_disposition text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  reviewer uuid := app_private.context_actor();
  review app_private.customer_deletion_reviews;
BEGIN
  -- Keep current reviewer authority stable through both the disposition and audit insert.
  PERFORM app_private.assert_staff(ARRAY['admin']);
  PERFORM 1 FROM app_private.tenants WHERE id = company FOR SHARE;
  PERFORM 1 FROM app_private.memberships
    WHERE tenant_id = company AND user_id = reviewer FOR SHARE;
  PERFORM app_private.assert_staff(ARRAY['admin']);

  IF p_customer IS NULL OR p_request IS NULL OR p_operation IS NULL OR p_disposition IS NULL
     OR p_disposition NOT IN ('ready_for_privacy_review', 'needs_information') THEN
    RAISE EXCEPTION 'Invalid deletion triage decision' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM app_private.customer_deletion_requests
    WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO review FROM app_private.customer_deletion_reviews
    WHERE tenant_id = company AND customer_id = p_customer;
  IF FOUND THEN
    IF (review.reviewer_id, review.operation_id, review.disposition)
       IS DISTINCT FROM (reviewer, p_operation, p_disposition) THEN
      RAISE EXCEPTION 'Triage decision conflict' USING ERRCODE = '23505';
    END IF;
    RETURN app_private.customer_deletion_review_receipt(review);
  END IF;

  INSERT INTO app_private.customer_deletion_reviews
    (tenant_id, customer_id, request_id, operation_id, reviewer_id, disposition)
    VALUES (company, p_customer, p_request, p_operation, reviewer, p_disposition)
    RETURNING * INTO review;
  PERFORM app_private.audit('customer.deletion_triaged', 'customer_deletion_review', p_operation, 1,
    jsonb_build_object('disposition', p_disposition));
  RETURN app_private.customer_deletion_review_receipt(review);
END $$;

REVOKE ALL ON FUNCTION app_private.customer_deletion_review_receipt(app_private.customer_deletion_reviews),
  app_api.list_customer_deletion_triage(integer, uuid),
  app_api.read_customer_deletion_review(uuid, uuid, uuid),
  app_api.review_customer_deletion(uuid, uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_customer_deletion_triage(integer, uuid),
  app_api.read_customer_deletion_review(uuid, uuid, uuid),
  app_api.review_customer_deletion(uuid, uuid, uuid, text)
  TO api_runtime;
COMMIT;

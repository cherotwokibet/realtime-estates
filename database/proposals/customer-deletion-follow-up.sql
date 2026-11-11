-- Synthetic read projections after customer-deletion-reviews.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;

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
    SELECT customer_id, request_id, reviewed_at
    FROM app_private.customer_deletion_reviews
    WHERE tenant_id = company AND disposition = p_disposition
      AND (p_after IS NULL OR customer_id > p_after)
    ORDER BY customer_id
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
    'status', CASE d.disposition
      WHEN 'ready_for_privacy_review' THEN 'privacy_review_pending'
      WHEN 'needs_information' THEN 'staff_follow_up_pending'
      ELSE 'pending_review'
    END
  ) INTO result
  FROM app_private.customer_deletion_requests r
  LEFT JOIN app_private.customer_deletion_reviews d
    ON (d.tenant_id, d.customer_id, d.request_id) = (r.tenant_id, r.customer_id, r.request_id)
  WHERE r.tenant_id = app_private.context_tenant() AND r.customer_id = app_private.context_actor();
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app_api.list_customer_deletion_follow_up(text, integer, uuid),
  app_api.read_customer_deletion_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.list_customer_deletion_follow_up(text, integer, uuid),
  app_api.read_customer_deletion_progress() TO api_runtime;
COMMIT;

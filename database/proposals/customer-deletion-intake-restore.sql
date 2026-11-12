-- Offline fixture only. Apply after customer-deletion-requests.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;

-- Replay one committed intake onto its immediate pre-intake preference version.
-- Inputs come from the authoritative fixture, never from runtime or a customer.
CREATE FUNCTION app_private.replay_synthetic_deletion_intake(
  p_tenant uuid, p_customer uuid, p_request uuid, p_requested_at timestamptz,
  p_prior_version bigint
) RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  saved app_private.customer_deletion_requests;
  preference app_private.customer_push_preferences;
BEGIN
  IF p_tenant IS NULL OR p_customer IS NULL OR p_request IS NULL
    OR p_requested_at IS NULL OR NOT isfinite(p_requested_at)
    OR p_prior_version IS NULL OR p_prior_version NOT BETWEEN 1 AND 9007199254740990 THEN
    RAISE EXCEPTION 'Invalid synthetic recovery input' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM app_private.memberships
    WHERE tenant_id = p_tenant AND user_id = p_customer AND role = 'customer' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery customer unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO preference FROM app_private.customer_push_preferences
    WHERE tenant_id = p_tenant AND customer_id = p_customer FOR UPDATE;
  SELECT * INTO saved FROM app_private.customer_deletion_requests
    WHERE tenant_id = p_tenant AND customer_id = p_customer;
  IF FOUND THEN
    IF (saved.request_id, saved.requested_at) IS DISTINCT FROM (p_request, p_requested_at)
      OR (preference.version, preference.enabled, preference.consent_changed_at)
        IS DISTINCT FROM (p_prior_version + 1, false, p_requested_at)
      OR EXISTS (SELECT 1 FROM app_private.customer_push_registrations
        WHERE tenant_id = p_tenant AND customer_id = p_customer AND active) THEN
      RAISE EXCEPTION 'Recovery conflicts with restored state' USING ERRCODE = '23505';
    END IF;
    RETURN false;
  END IF;

  IF preference.version IS DISTINCT FROM p_prior_version OR preference.enabled IS DISTINCT FROM true
    OR preference.consent_changed_at > p_requested_at THEN
    RAISE EXCEPTION 'Recovery requires the expected pre-intake consent state' USING ERRCODE = '23514';
  END IF;

  UPDATE app_private.customer_push_preferences
    SET enabled = false, version = version + 1, consent_changed_at = p_requested_at
    WHERE tenant_id = p_tenant AND customer_id = p_customer;
  UPDATE app_private.customer_push_registrations SET active = false
    WHERE tenant_id = p_tenant AND customer_id = p_customer AND active;
  INSERT INTO app_private.customer_deletion_requests (tenant_id, customer_id, request_id, requested_at)
    VALUES (p_tenant, p_customer, p_request, p_requested_at);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app_private.replay_synthetic_deletion_intake(uuid, uuid, uuid, timestamptz, bigint)
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;
COMMIT;

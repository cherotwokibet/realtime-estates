-- Offline synthetic sender. Apply after customer-deletion-requests.sql in a disposable fixture.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.synthetic_customer_push_attempts (
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  preference_version bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'captured', 'deletion_pending', 'customer_unavailable', 'consent_off',
    'stale_preferences', 'registration_unavailable'
  )),
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app_private.memberships (tenant_id, user_id)
);
ALTER TABLE app_private.synthetic_customer_push_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_customer_push_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.synthetic_customer_push_attempts TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE TRIGGER immutable_synthetic_customer_push_attempt BEFORE UPDATE OR DELETE
  ON app_private.synthetic_customer_push_attempts FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_customer_push_attempts FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_private.capture_synthetic_customer_push(
  p_tenant uuid, p_customer uuid, p_operation uuid, p_registration uuid, p_expected_version bigint
) RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  company_enabled boolean;
  member app_private.memberships;
  prefs app_private.customer_push_preferences;
  prior app_private.synthetic_customer_push_attempts;
  result text;
BEGIN
  IF p_tenant IS NULL OR p_customer IS NULL OR p_operation IS NULL OR p_registration IS NULL
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid synthetic push attempt' USING ERRCODE = '23514';
  END IF;

  -- Use the same lock order as consent changes and deletion intake.
  SELECT enabled INTO company_enabled FROM app_private.tenants WHERE id = p_tenant FOR SHARE;
  SELECT * INTO member FROM app_private.memberships
    WHERE tenant_id = p_tenant AND user_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'customer_unavailable';
  END IF;

  SELECT * INTO prior FROM app_private.synthetic_customer_push_attempts
    WHERE tenant_id = p_tenant AND operation_id = p_operation;
  IF FOUND THEN
    IF (prior.customer_id, prior.registration_id, prior.preference_version)
      IS DISTINCT FROM (p_customer, p_registration, p_expected_version) THEN
      RAISE EXCEPTION 'Synthetic push operation conflict' USING ERRCODE = '23505';
    END IF;
    RETURN prior.outcome;
  END IF;

  SELECT * INTO prefs FROM app_private.customer_push_preferences
    WHERE tenant_id = p_tenant AND customer_id = p_customer;
  IF company_enabled IS DISTINCT FROM true OR member.active IS DISTINCT FROM true OR member.role <> 'customer' THEN
    result := 'customer_unavailable';
  ELSIF EXISTS (SELECT 1 FROM app_private.customer_deletion_requests
    WHERE tenant_id = p_tenant AND customer_id = p_customer) THEN
    result := 'deletion_pending';
  ELSIF prefs.enabled IS DISTINCT FROM true THEN
    result := 'consent_off';
  ELSIF prefs.version IS DISTINCT FROM p_expected_version THEN
    result := 'stale_preferences';
  ELSIF NOT EXISTS (SELECT 1 FROM app_private.customer_push_registrations
    WHERE tenant_id = p_tenant AND customer_id = p_customer
      AND registration_id = p_registration AND active) THEN
    result := 'registration_unavailable';
  ELSE
    result := 'captured';
  END IF;

  INSERT INTO app_private.synthetic_customer_push_attempts
    VALUES (p_tenant, p_operation, p_customer, p_registration, p_expected_version, result);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app_private.capture_synthetic_customer_push(uuid, uuid, uuid, uuid, bigint)
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;
COMMIT;

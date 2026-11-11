-- Synthetic intake only. Apply after customer-push-preferences.sql in a disposable fixture.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.customer_deletion_requests (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  request_id uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app_private.memberships (tenant_id, user_id)
);
ALTER TABLE app_private.customer_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.customer_deletion_requests TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE TRIGGER immutable_customer_deletion_request BEFORE UPDATE OR DELETE
  ON app_private.customer_deletion_requests FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.customer_deletion_requests
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_private.guard_pending_deletion_push() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  -- Customer preference writes and intake both hold the same current membership row lock.
  IF NEW.enabled AND EXISTS (
    SELECT 1 FROM app_private.customer_deletion_requests
    WHERE tenant_id = NEW.tenant_id AND customer_id = NEW.customer_id
  ) THEN
    RAISE EXCEPTION 'Notifications unavailable while a deletion request is pending'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pending_deletion_push BEFORE INSERT OR UPDATE
  ON app_private.customer_push_preferences FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_pending_deletion_push();

CREATE FUNCTION app_api.read_customer_deletion_request() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app_private.assert_customer();
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-deletion-request-v1',
    'tenantId', r.tenant_id,
    'customerId', r.customer_id,
    'requestId', r.request_id,
    'status', 'pending_review',
    'requestedAt', to_char(date_trunc('milliseconds', r.requested_at) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) INTO result
  FROM app_private.customer_deletion_requests r
  WHERE r.tenant_id = app_private.context_tenant() AND r.customer_id = app_private.context_actor();
  RETURN result;
END $$;

CREATE FUNCTION app_api.request_customer_deletion(p_request uuid, p_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  customer uuid := app_private.context_actor();
  previous_request uuid;
  requested timestamptz;
BEGIN
  IF p_request IS NULL OR p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Explicit deletion request confirmation required' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM app_private.tenants WHERE id = company FOR SHARE;
  PERFORM 1 FROM app_private.memberships
    WHERE tenant_id = company AND user_id = customer FOR UPDATE;
  PERFORM app_private.assert_customer();

  SELECT request_id INTO previous_request FROM app_private.customer_deletion_requests
    WHERE tenant_id = company AND customer_id = customer;
  IF FOUND THEN
    IF previous_request IS DISTINCT FROM p_request THEN
      RAISE EXCEPTION 'A deletion request is already pending' USING ERRCODE = '23505';
    END IF;
    RETURN app_api.read_customer_deletion_request();
  END IF;

  requested := clock_timestamp();
  UPDATE app_private.customer_push_preferences
    SET enabled = false, version = version + 1, consent_changed_at = requested
    WHERE tenant_id = company AND customer_id = customer AND enabled;
  UPDATE app_private.customer_push_registrations SET active = false
    WHERE tenant_id = company AND customer_id = customer AND active;
  INSERT INTO app_private.customer_deletion_requests
    VALUES (company, customer, p_request, requested);
  RETURN app_api.read_customer_deletion_request();
END $$;

REVOKE ALL ON FUNCTION app_private.guard_pending_deletion_push(),
  app_api.read_customer_deletion_request(), app_api.request_customer_deletion(uuid, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_customer_deletion_request(),
  app_api.request_customer_deletion(uuid, boolean) TO api_runtime;
COMMIT;

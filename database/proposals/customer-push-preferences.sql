-- Synthetic customer push preferences. Apply after customer-favourites.sql in a disposable fixture.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.customer_push_preferences (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  enabled boolean NOT NULL,
  consent_changed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app_private.memberships (tenant_id, user_id)
);
CREATE TABLE app_private.customer_push_registrations (
  registration_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  active boolean NOT NULL,
  FOREIGN KEY (tenant_id, customer_id)
    REFERENCES app_private.customer_push_preferences (tenant_id, customer_id)
);
CREATE INDEX customer_push_registration_owner
  ON app_private.customer_push_registrations (tenant_id, customer_id);

ALTER TABLE app_private.customer_push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_push_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_push_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_push_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.customer_push_preferences TO realtor_owner
  USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON app_private.customer_push_registrations TO realtor_owner
  USING (true) WITH CHECK (true);
REVOKE ALL ON app_private.customer_push_preferences, app_private.customer_push_registrations
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_api.read_customer_push_preferences() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  customer uuid := app_private.context_actor();
  result jsonb;
BEGIN
  PERFORM app_private.assert_customer();
  SELECT jsonb_build_object(
    'policy', 'synthetic-customer-push-preferences-v1',
    'tenantId', company,
    'customerId', customer,
    'version', coalesce(p.version, 0)::text,
    'enabled', coalesce(p.enabled, false),
    'consentChangedAt', to_char(date_trunc('milliseconds', p.consent_changed_at) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activeDevices', (
      SELECT count(*) FROM app_private.customer_push_registrations r
      WHERE r.tenant_id = company AND r.customer_id = customer AND r.active
    )
  ) INTO result
  FROM (SELECT 1) anchor
  LEFT JOIN app_private.customer_push_preferences p
    ON p.tenant_id = company AND p.customer_id = customer;
  RETURN result;
END $$;

CREATE FUNCTION app_api.change_customer_push_preferences(
  p_expected bigint, p_action text, p_enabled boolean, p_registration uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  customer uuid := app_private.context_actor();
  current_preferences app_private.customer_push_preferences;
  current_registration app_private.customer_push_registrations;
  actual bigint;
  enabled boolean;
  changed boolean;
BEGIN
  IF p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 9007199254740990
    OR p_action IS NULL OR p_action NOT IN ('consent', 'register', 'revoke')
    OR (p_action = 'consent' AND (p_enabled IS NULL OR p_registration IS NOT NULL))
    OR (p_action <> 'consent' AND (p_enabled IS NOT NULL OR p_registration IS NULL))
  THEN
    RAISE EXCEPTION 'Invalid notification preference command' USING ERRCODE = '23514';
  END IF;

  -- Serialize changes with current membership updates using the existing tenant-first order.
  PERFORM 1 FROM app_private.tenants WHERE id = company FOR SHARE;
  PERFORM 1 FROM app_private.memberships
    WHERE tenant_id = company AND user_id = customer FOR UPDATE;
  PERFORM app_private.assert_customer();

  SELECT * INTO current_preferences FROM app_private.customer_push_preferences
    WHERE tenant_id = company AND customer_id = customer;
  actual := coalesce(current_preferences.version, 0);
  enabled := coalesce(current_preferences.enabled, false);
  IF p_expected <> actual THEN
    RETURN app_api.read_customer_push_preferences() || jsonb_build_object('outcome', 'conflict');
  END IF;

  IF p_action = 'consent' THEN
    changed := enabled IS DISTINCT FROM p_enabled;
    enabled := p_enabled;
    IF changed AND NOT enabled THEN
      UPDATE app_private.customer_push_registrations SET active = false
        WHERE tenant_id = company AND customer_id = customer AND active;
    END IF;
  ELSIF p_action = 'register' THEN
    IF NOT enabled THEN
      RAISE EXCEPTION 'Registration unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO current_registration FROM app_private.customer_push_registrations
      WHERE registration_id = p_registration;
    IF FOUND AND (current_registration.tenant_id, current_registration.customer_id)
      IS DISTINCT FROM (company, customer) THEN
      RAISE EXCEPTION 'Registration unavailable' USING ERRCODE = '42501';
    END IF;
    changed := NOT coalesce(current_registration.active, false);
    IF changed THEN
      IF (SELECT count(*) FROM app_private.customer_push_registrations
          WHERE tenant_id = company AND customer_id = customer AND active) >= 10 THEN
        RAISE EXCEPTION 'Registration limit reached' USING ERRCODE = '54000';
      END IF;
      IF current_registration.registration_id IS NULL AND
        (SELECT count(*) FROM app_private.customer_push_registrations
          WHERE tenant_id = company AND customer_id = customer) >= 50 THEN
        RAISE EXCEPTION 'Registration history limit reached' USING ERRCODE = '54000';
      END IF;
      INSERT INTO app_private.customer_push_registrations AS r
        (registration_id, tenant_id, customer_id, active)
        VALUES (p_registration, company, customer, true)
      ON CONFLICT (registration_id) DO UPDATE SET active = true
        WHERE r.tenant_id = company AND r.customer_id = customer;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration unavailable' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    UPDATE app_private.customer_push_registrations SET active = false
      WHERE registration_id = p_registration AND tenant_id = company AND customer_id = customer AND active;
    changed := FOUND;
  END IF;

  IF changed THEN
    INSERT INTO app_private.customer_push_preferences
      (tenant_id, customer_id, version, enabled, consent_changed_at)
      VALUES (company, customer, actual + 1, enabled,
        CASE WHEN p_action = 'consent' THEN statement_timestamp()
             ELSE current_preferences.consent_changed_at END)
    ON CONFLICT (tenant_id, customer_id) DO UPDATE
      SET version = excluded.version, enabled = excluded.enabled,
        consent_changed_at = excluded.consent_changed_at;
  END IF;
  RETURN app_api.read_customer_push_preferences() ||
    jsonb_build_object('outcome', CASE WHEN changed THEN 'applied' ELSE 'unchanged' END);
END $$;

REVOKE ALL ON FUNCTION app_api.read_customer_push_preferences(),
  app_api.change_customer_push_preferences(bigint, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_customer_push_preferences(),
  app_api.change_customer_push_preferences(bigint, text, boolean, uuid) TO api_runtime;
COMMIT;

-- Offline synthetic queue. Apply after synthetic-customer-push-capture.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE TABLE app_private.synthetic_customer_push_jobs (
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  preference_version bigint NOT NULL CHECK (preference_version BETWEEN 0 AND 9007199254740991),
  due_at timestamptz NOT NULL CHECK (isfinite(due_at)),
  viewing_admission_id uuid,
  finished_operation_id uuid CHECK (finished_operation_id = operation_id),
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app_private.memberships (tenant_id, user_id),
  UNIQUE (tenant_id, viewing_admission_id, registration_id),
  FOREIGN KEY (tenant_id, viewing_admission_id)
    REFERENCES app_private.viewing_reminder_admissions (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, finished_operation_id)
    REFERENCES app_private.synthetic_customer_push_attempts (tenant_id, operation_id)
);
ALTER TABLE app_private.synthetic_customer_push_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_customer_push_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app_private.synthetic_customer_push_jobs TO realtor_owner
  USING (true) WITH CHECK (true);
REVOKE ALL ON app_private.synthetic_customer_push_jobs FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;

CREATE FUNCTION app_private.enqueue_synthetic_customer_push(
  p_tenant uuid, p_customer uuid, p_operation uuid, p_registration uuid,
  p_expected_version bigint, p_due_at timestamptz, p_viewing_admission uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE job app_private.synthetic_customer_push_jobs;
BEGIN
  INSERT INTO app_private.synthetic_customer_push_jobs
    (tenant_id, operation_id, customer_id, registration_id, preference_version, due_at, viewing_admission_id)
    VALUES (p_tenant, p_operation, p_customer, p_registration, p_expected_version, p_due_at, p_viewing_admission)
    ON CONFLICT (tenant_id, operation_id) DO NOTHING;
  IF FOUND THEN
    RETURN true;
  END IF;
  SELECT * INTO STRICT job FROM app_private.synthetic_customer_push_jobs
    WHERE tenant_id = p_tenant AND operation_id = p_operation;
  IF (job.customer_id, job.registration_id, job.preference_version, job.due_at, job.viewing_admission_id)
    IS DISTINCT FROM (p_customer, p_registration, p_expected_version, p_due_at, p_viewing_admission) THEN
    RAISE EXCEPTION 'Synthetic push job conflicts with existing schedule' USING ERRCODE = '23505';
  END IF;
  RETURN false;
END $$;

CREATE FUNCTION app_private.run_synthetic_customer_push(
  p_tenant uuid, p_operation uuid, p_as_of timestamptz
) RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  job app_private.synthetic_customer_push_jobs;
  result text;
  admission app_private.viewing_reminder_admissions;
  recipient uuid;
  viewing_state text;
BEGIN
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION 'Invalid synthetic queue clock' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO job FROM app_private.synthetic_customer_push_jobs
    WHERE tenant_id = p_tenant AND operation_id = p_operation FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synthetic push job unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF job.finished_operation_id IS NOT NULL THEN
    SELECT outcome INTO STRICT result FROM app_private.synthetic_customer_push_attempts
      WHERE tenant_id = p_tenant AND operation_id = job.finished_operation_id;
    RETURN result;
  END IF;
  IF job.due_at > p_as_of THEN
    RETURN 'not_due';
  END IF;

  IF job.viewing_admission_id IS NOT NULL THEN
    SELECT * INTO STRICT admission FROM app_private.viewing_reminder_admissions
      WHERE tenant_id = p_tenant AND operation_id = job.viewing_admission_id;
    SELECT requested_by_id INTO recipient FROM app_private.enquiries
      WHERE tenant_id = p_tenant AND id = admission.enquiry_id FOR UPDATE;
    IF admission.receipt->>'outcome' = 'admitted' AND recipient = job.customer_id THEN
      viewing_state := app_private.viewing_reminder_capture_state(admission, p_as_of)->'decision'->>'state';
    END IF;
    IF viewing_state IS DISTINCT FROM 'eligible' THEN
      INSERT INTO app_private.synthetic_customer_push_attempts
        VALUES (p_tenant, p_operation, job.customer_id, job.registration_id, job.preference_version, 'viewing_obsolete');
      result := 'viewing_obsolete';
    END IF;
  END IF;
  IF result IS NULL THEN
    result := app_private.capture_synthetic_customer_push(
      p_tenant, job.customer_id, p_operation, job.registration_id, job.preference_version
    );
  END IF;
  UPDATE app_private.synthetic_customer_push_jobs SET finished_operation_id = p_operation
    WHERE tenant_id = p_tenant AND operation_id = p_operation;
  RETURN result;
END $$;

-- Enqueue from admitted viewing facts and the authenticated enquiry owner.
CREATE FUNCTION app_private.enqueue_synthetic_viewing_push(
  p_tenant uuid, p_admission uuid, p_operation uuid, p_registration uuid
) RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  admission app_private.viewing_reminder_admissions;
  recipient uuid;
  saved app_private.synthetic_customer_push_jobs;
  current_version bigint;
BEGIN
  SELECT * INTO admission FROM app_private.viewing_reminder_admissions
    WHERE tenant_id = p_tenant AND operation_id = p_admission;
  IF NOT FOUND OR admission.receipt->>'outcome' IS DISTINCT FROM 'admitted' THEN
    RAISE EXCEPTION 'Admitted viewing reminder unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT requested_by_id INTO recipient FROM app_private.enquiries
    WHERE tenant_id = p_tenant AND id = admission.enquiry_id FOR UPDATE;
  SELECT * INTO saved FROM app_private.synthetic_customer_push_jobs
    WHERE tenant_id = p_tenant AND operation_id = p_operation;
  IF FOUND THEN
    IF (saved.viewing_admission_id, saved.customer_id, saved.registration_id)
      IS DISTINCT FROM (p_admission, recipient, p_registration) THEN
      RAISE EXCEPTION 'Viewing push operation conflict' USING ERRCODE = '23505';
    END IF;
    RETURN false;
  END IF;
  SELECT prefs.version INTO current_version FROM app_private.customer_push_preferences prefs
    JOIN app_private.customer_push_registrations device USING (tenant_id, customer_id)
    WHERE prefs.tenant_id = p_tenant AND prefs.customer_id = recipient AND prefs.enabled
      AND device.registration_id = p_registration AND device.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viewing notification recipient unavailable' USING ERRCODE = 'P0002';
  END IF;
  RETURN app_private.enqueue_synthetic_customer_push(
    p_tenant, recipient, p_operation, p_registration, current_version, admission.due_at, p_admission
  );
END $$;

REVOKE ALL ON FUNCTION
  app_private.enqueue_synthetic_viewing_push(uuid, uuid, uuid, uuid),
  app_private.enqueue_synthetic_customer_push(uuid, uuid, uuid, uuid, bigint, timestamptz, uuid),
  app_private.run_synthetic_customer_push(uuid, uuid, timestamptz)
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;
COMMIT;

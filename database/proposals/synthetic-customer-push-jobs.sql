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
  finished_operation_id uuid CHECK (finished_operation_id = operation_id),
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app_private.memberships (tenant_id, user_id),
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
  p_expected_version bigint, p_due_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE job app_private.synthetic_customer_push_jobs;
BEGIN
  INSERT INTO app_private.synthetic_customer_push_jobs
    (tenant_id, operation_id, customer_id, registration_id, preference_version, due_at)
    VALUES (p_tenant, p_operation, p_customer, p_registration, p_expected_version, p_due_at)
    ON CONFLICT (tenant_id, operation_id) DO NOTHING;
  IF FOUND THEN
    RETURN true;
  END IF;
  SELECT * INTO STRICT job FROM app_private.synthetic_customer_push_jobs
    WHERE tenant_id = p_tenant AND operation_id = p_operation;
  IF (job.customer_id, job.registration_id, job.preference_version, job.due_at)
    IS DISTINCT FROM (p_customer, p_registration, p_expected_version, p_due_at) THEN
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

  result := app_private.capture_synthetic_customer_push(
    p_tenant, job.customer_id, p_operation, job.registration_id, job.preference_version
  );
  UPDATE app_private.synthetic_customer_push_jobs SET finished_operation_id = p_operation
    WHERE tenant_id = p_tenant AND operation_id = p_operation;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION
  app_private.enqueue_synthetic_customer_push(uuid, uuid, uuid, uuid, bigint, timestamptz),
  app_private.run_synthetic_customer_push(uuid, uuid, timestamptz)
  FROM PUBLIC, api_runtime, media_coordinator, media_maintenance;
COMMIT;

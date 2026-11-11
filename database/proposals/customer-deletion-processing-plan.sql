-- Disposable processing-plan inventory. Apply after customer-deletion-privacy-decisions.sql.
BEGIN;
SET LOCAL ROLE realtor_owner;

CREATE FUNCTION app_api.read_synthetic_deletion_processing_plan(
  p_customer uuid, p_request uuid, p_operation uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  company uuid := app_private.context_tenant();
  decision jsonb;
  inventory jsonb;
BEGIN
  -- Keep plan access bound to the original reviewer and current designation.
  decision := app_api.read_synthetic_deletion_privacy_decision(p_customer, p_request, p_operation);
  IF decision->>'decision' <> 'plan_review' THEN
    RAISE EXCEPTION 'Processing plan unavailable' USING ERRCODE = 'P0002';
  END IF;

  WITH linked_enquiries AS (
    SELECT e.id FROM app_private.enquiries e
    WHERE e.tenant_id = company AND e.requested_by_id = p_customer
  )
  SELECT jsonb_build_object(
    'favouriteStates', (SELECT count(*) FROM app_private.customer_favourites
      WHERE tenant_id = company AND customer_id = p_customer),
    'favouriteReceipts', (SELECT count(*) FROM app_private.customer_favourite_operations
      WHERE tenant_id = company AND customer_id = p_customer),
    'pushPreferences', (SELECT count(*) FROM app_private.customer_push_preferences
      WHERE tenant_id = company AND customer_id = p_customer),
    'pushRegistrations', (SELECT count(*) FROM app_private.customer_push_registrations
      WHERE tenant_id = company AND customer_id = p_customer),
    'activePushRegistrations', (SELECT count(*) FROM app_private.customer_push_registrations
      WHERE tenant_id = company AND customer_id = p_customer AND active),
    'pushReceipts', (SELECT count(*) FROM app_private.customer_push_operations
      WHERE tenant_id = company AND customer_id = p_customer),
    'linkedEnquiries', (SELECT count(*) FROM linked_enquiries),
    'linkedViewings', (SELECT count(*) FROM app_private.viewings v
      WHERE v.tenant_id = company AND
        (v.requested_by_id = p_customer OR v.enquiry_id IN (SELECT id FROM linked_enquiries))),
    'returnReceipts', (SELECT count(*) FROM app_private.customer_deletion_review_returns
      WHERE tenant_id = company AND customer_id = p_customer AND request_id = p_request)
  ) INTO inventory;

  RETURN jsonb_build_object(
    'policy', 'synthetic-deletion-processing-plan-v1',
    'decision', decision,
    'inventory', inventory,
    'requirements', jsonb_build_object(
      'accountScope', 'verify_identity_and_linked_memberships',
      'operationalHistory', 'review_retention_reason_and_expiry',
      'privacyEvidence', 'review_minimum_audit_and_receipt_evidence',
      'unlinkedEnquiries', 'manual_identity_review_required',
      'holds', 'verify_no_applicable_hold',
      'providers', 'verify_provider_control_and_disposition',
      'backups', 'verify_expiry_custody_and_restore_reapplication'
    )
  );
END $$;

REVOKE ALL ON FUNCTION app_api.read_synthetic_deletion_processing_plan(uuid, uuid, uuid)
  FROM PUBLIC, media_coordinator, media_maintenance;
GRANT EXECUTE ON FUNCTION app_api.read_synthetic_deletion_processing_plan(uuid, uuid, uuid)
  TO api_runtime;
COMMIT;

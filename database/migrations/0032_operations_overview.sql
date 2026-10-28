BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE INDEX listing_availability_work ON app_private.listings(tenant_id,last_availability_confirmed_at,id) WHERE publication_status='published' AND availability='available';
CREATE INDEX revision_pending_work ON app_private.listing_revisions(tenant_id,submitted_at,listing_id,revision_no) WHERE state='pending';
CREATE INDEX enquiry_due_work ON app_private.enquiries(tenant_id,next_action_at,id) WHERE status IN ('new','assigned','contacted','qualified') AND next_action_at IS NOT NULL;
CREATE INDEX viewing_outcome_work ON app_private.viewings(tenant_id,id) WHERE status='confirmed';
-- No raw table permission is added. Current admin membership is checked inside SQL.
CREATE FUNCTION app_api.read_operations_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;tenant uuid:=app_private.context_tenant();queue_name text;items jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);

    WITH clock AS MATERIALIZED (SELECT date_trunc('milliseconds',statement_timestamp()) AS captured),
    stale AS MATERIALIZED (
      SELECT l.id AS "listingId",r.title,
        CASE WHEN l.last_availability_confirmed_at IS NULL THEN NULL ELSE
          to_char(l.last_availability_confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "lastCheckedAt"
      FROM app_private.listings l JOIN app_private.listing_revisions r
        ON r.tenant_id=l.tenant_id AND r.listing_id=l.id AND r.revision_no=l.published_revision_no CROSS JOIN clock
      WHERE l.tenant_id=tenant AND l.publication_status='published' AND l.availability='available'
        AND (l.last_availability_confirmed_at IS NULL OR l.last_availability_confirmed_at<clock.captured-interval '720 hours')
      ORDER BY date_trunc('milliseconds',l.last_availability_confirmed_at) ASC NULLS FIRST,l.id ASC LIMIT 11
    ), reviews AS MATERIALIZED (
      SELECT r.listing_id AS "listingId",r.revision_no AS revision,r.title,
        to_char(r.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt"
      FROM app_private.listing_revisions r JOIN app_private.listings l ON l.tenant_id=r.tenant_id AND l.id=r.listing_id
      WHERE r.tenant_id=tenant AND r.state='pending' AND l.publication_status<>'archived'
      ORDER BY date_trunc('milliseconds',r.submitted_at) ASC,r.listing_id ASC,r.revision_no ASC LIMIT 11
    ), overdue AS MATERIALIZED (
      SELECT e.id AS "enquiryId",e.contact_name AS name,
        to_char(e.next_action_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextActionAt"
      FROM app_private.enquiries e CROSS JOIN clock WHERE e.tenant_id=tenant
        AND e.status IN ('new','assigned','contacted','qualified') AND e.next_action_at<clock.captured
      ORDER BY date_trunc('milliseconds',e.next_action_at) ASC,e.id ASC LIMIT 11
    ), outcomes AS MATERIALIZED (
      SELECT v.enquiry_id AS "enquiryId",v.id AS "viewingId",v.listing_id AS "listingId",coalesce(r.title,l.slug) AS title,
        to_char((coalesce(v.current_cycle->'slot',v.proposed_slot)->>'endAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endedAt"
      FROM app_private.viewings v JOIN app_private.listings l ON l.tenant_id=v.tenant_id AND l.id=v.listing_id
      LEFT JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id AND r.revision_no=l.published_revision_no CROSS JOIN clock
      WHERE v.tenant_id=tenant AND v.status='confirmed'
        AND (coalesce(v.current_cycle->'slot',v.proposed_slot)->>'endAt')::timestamptz<=clock.captured
      ORDER BY date_trunc('milliseconds',(coalesce(v.current_cycle->'slot',v.proposed_slot)->>'endAt')::timestamptz) ASC,v.id ASC LIMIT 11
    )

 SELECT jsonb_build_object('policy','staff-operations-overview-v1','asOf',to_char(clock.captured AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'freshnessDays',30,'limit',10,
 'staleStock',(SELECT coalesce(jsonb_agg(to_jsonb(stale) ORDER BY "lastCheckedAt" ASC NULLS FIRST,"listingId" ASC),'[]'::jsonb) FROM stale),
'pendingReviews',(SELECT coalesce(jsonb_agg(to_jsonb(reviews) ORDER BY "submittedAt" ASC,"listingId" ASC,revision ASC),'[]'::jsonb) FROM reviews),
'overdueEnquiries',(SELECT coalesce(jsonb_agg(to_jsonb(overdue) ORDER BY "nextActionAt" ASC,"enquiryId" ASC),'[]'::jsonb) FROM overdue),
'viewingOutcomes',(SELECT coalesce(jsonb_agg(to_jsonb(outcomes) ORDER BY "endedAt" ASC,"viewingId" ASC),'[]'::jsonb) FROM outcomes)) INTO result FROM clock;
 FOREACH queue_name IN ARRAY ARRAY['staleStock','pendingReviews','overdueEnquiries','viewingOutcomes'] LOOP
  items:=result->queue_name;
  result:=jsonb_set(result,ARRAY[queue_name],jsonb_build_object('items',
   (SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(items) WITH ORDINALITY WHERE ordinality<=10),
   'hasMore',jsonb_array_length(items)>10));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_api.read_operations_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_operations_overview() TO api_runtime;
COMMIT;

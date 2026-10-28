BEGIN;
SET LOCAL ROLE realtor_owner;
-- Slot strings are canonical UTC instants enforced by viewing_slot_valid; C ordering is exact.
CREATE INDEX viewing_calendar_slot_lookup ON app_private.viewings(tenant_id,
 ((coalesce(nullif(current_cycle->'slot','null'::jsonb),proposed_slot)->>'startAt') COLLATE "C"),id)
 WHERE status IN('proposed','confirmed','cancelled','declined','completed','no_show');
CREATE INDEX viewing_calendar_requested_lookup ON app_private.viewings(tenant_id,created_at,id) WHERE status='requested';
-- Narrow projection only. Raw viewing tables retain their existing denied runtime access.
CREATE FUNCTION app_api.read_viewing_calendar(p_from timestamptz,p_until timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid:=app_private.context_tenant();result jsonb;scheduled jsonb;unscheduled jsonb;
 from_text text;until_text text;lower_text text;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin','agent']);
 IF NOT app_private.enquiry_time_valid(p_from) OR NOT app_private.enquiry_time_valid(p_until)
    OR p_until<=p_from OR p_until-p_from>interval '744 hours'
    OR date_trunc('milliseconds',p_from)<>p_from OR date_trunc('milliseconds',p_until)<>p_until
 THEN RAISE EXCEPTION 'Invalid calendar range' USING ERRCODE='22023';END IF;
 from_text:=app_private.enquiry_utc(p_from);until_text:=app_private.enquiry_utc(p_until);
 lower_text:=app_private.enquiry_utc(greatest(p_from-interval '4 hours','0001-01-01T00:00:00.000Z'::timestamptz));
 WITH clock AS MATERIALIZED(SELECT date_trunc('milliseconds',statement_timestamp()) captured),
 visible AS NOT MATERIALIZED(
   SELECT v.id,v.enquiry_id,v.listing_id,v.status,v.version,v.created_at,
     coalesce(nullif(v.current_cycle->'slot','null'::jsonb),v.proposed_slot) slot,
     coalesce(r.title,l.slug) title,e.status NOT IN('new','assigned','contacted','qualified') closed
   FROM app_private.viewings v JOIN app_private.enquiries e ON e.tenant_id=v.tenant_id AND e.id=v.enquiry_id
   JOIN app_private.listings l ON l.tenant_id=v.tenant_id AND l.id=v.listing_id
   LEFT JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id AND r.revision_no=l.published_revision_no
   WHERE v.tenant_id=tenant AND app_private.may_work(tenant,e.assigned_agent_id)
 ), scheduled_rows AS MATERIALIZED(
   SELECT * FROM visible WHERE slot IS NOT NULL AND slot<>'null'::jsonb
    AND status IN('proposed','confirmed','cancelled','declined','completed','no_show')
    AND (slot->>'startAt') COLLATE "C">=lower_text COLLATE "C"
    AND (slot->>'startAt') COLLATE "C"<until_text COLLATE "C" AND (slot->>'endAt') COLLATE "C">from_text COLLATE "C"
   ORDER BY (slot->>'startAt') COLLATE "C",id LIMIT 101
 ), requested_rows AS MATERIALIZED(
   SELECT * FROM visible WHERE status='requested' ORDER BY created_at,id LIMIT 26
 )
 SELECT jsonb_build_object('policy','staff-viewing-calendar-v1',
   'asOf',to_char(clock.captured AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'window',jsonb_build_object('fromAt',to_char(p_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'untilAt',to_char(p_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone','Africa/Nairobi'),
   'scheduled',(SELECT coalesce(jsonb_agg(jsonb_build_object('viewingId',id,'enquiryId',enquiry_id,'listingId',listing_id,
     'title',title,'version',version::text,'status',status,'slot',slot,'enquiryClosed',closed) ORDER BY (slot->>'startAt')::timestamptz,id),'[]'::jsonb) FROM scheduled_rows),
   'unscheduled',(SELECT coalesce(jsonb_agg(jsonb_build_object('viewingId',id,'enquiryId',enquiry_id,'listingId',listing_id,
     'title',title,'version',version::text,'status',status,'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'enquiryClosed',closed) ORDER BY date_trunc('milliseconds',created_at),id),'[]'::jsonb) FROM requested_rows)
 ) INTO result FROM clock;
 scheduled:=result->'scheduled';unscheduled:=result->'unscheduled';
 RETURN jsonb_set(jsonb_set(result,'{scheduled}',jsonb_build_object('limit',100,'hasMore',jsonb_array_length(scheduled)>100,
  'items',(SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(scheduled) WITH ORDINALITY WHERE ordinality<=100))),
  '{unscheduled}',jsonb_build_object('limit',25,'hasMore',jsonb_array_length(unscheduled)>25,
  'items',(SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(unscheduled) WITH ORDINALITY WHERE ordinality<=25)));
END $$;
REVOKE ALL ON FUNCTION app_api.read_viewing_calendar(timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_viewing_calendar(timestamptz,timestamptz) TO api_runtime;
COMMIT;

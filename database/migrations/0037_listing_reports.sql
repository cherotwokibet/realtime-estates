-- Independent anonymous capture and reasoned admin triage; never changes publication.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.listing_report_text_valid(v text,maximum integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT v IS NOT NULL AND length(v) BETWEEN 1 AND maximum AND v=btrim(v) AND v=normalize(v,NFC)
   AND v !~ '[[:cntrl:]<>]' AND v !~ U&'[\202A-\202E\2066-\2069]'
$$;
CREATE FUNCTION app_private.listing_report_request_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key) IS DISTINCT FROM ARRAY['details','listingId','operationId','policy','reason']::text[] THEN RETURN false;END IF;
 RETURN coalesce(v->>'policy'='listing-report-command-v1' AND jsonb_typeof(v->'policy')='string'
  AND jsonb_typeof(v->'operationId')='string' AND (v->>'operationId')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(v->'listingId')='string' AND (v->>'listingId')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(v->'reason')='string' AND v->>'reason' IN ('suspected_fraud','wrong_price','unavailable','other')
  AND (v->'details'='null'::jsonb OR (jsonb_typeof(v->'details')='string' AND app_private.listing_report_text_valid(v->>'details',1200))),false);
END $$;
CREATE TABLE app_private.listing_reports (
 tenant_id uuid NOT NULL REFERENCES app_private.tenants(id),id uuid NOT NULL,operation_id uuid NOT NULL,
 listing_id uuid NOT NULL,contacted_revision integer NOT NULL CHECK(contacted_revision>=1),
 request jsonb NOT NULL CHECK(app_private.listing_report_request_valid(request)),
 notice_version text NOT NULL CHECK(notice_version~'^[a-z0-9][a-z0-9.-]{0,119}$'),
 recorded_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',statement_timestamp()),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),
 CHECK(listing_id=(request->>'listingId')::uuid AND operation_id=(request->>'operationId')::uuid)
);
CREATE INDEX listing_reports_queue ON app_private.listing_reports(tenant_id,recorded_at DESC,id DESC);
CREATE TABLE app_private.listing_report_decisions (
 tenant_id uuid NOT NULL,report_id uuid NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 2 AND 9007199254740991),
 operation_id uuid NOT NULL,actor_id uuid NOT NULL,request jsonb NOT NULL,
 decision text NOT NULL CHECK(decision IN ('reviewed','dismissed')),reason text NOT NULL CHECK(app_private.listing_report_text_valid(reason,500)),
 recorded_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',statement_timestamp()),
 PRIMARY KEY(tenant_id,report_id,version),UNIQUE(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,report_id) REFERENCES app_private.listing_reports(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
ALTER TABLE app_private.listing_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_report_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_report_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.listing_reports TO realtor_owner USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE POLICY owner_context ON app_private.listing_report_decisions TO realtor_owner USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_listing_reports BEFORE UPDATE OR DELETE ON app_private.listing_reports FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
CREATE TRIGGER immutable_listing_report_decisions BEFORE UPDATE OR DELETE ON app_private.listing_report_decisions FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.listing_reports,app_private.listing_report_decisions FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.listing_report_receipt(r app_private.listing_reports) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','listing-report-receipt-v1','operationId',r.operation_id,'listingId',r.listing_id,
  'status','recorded','recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
CREATE FUNCTION app_private.listing_report_decision_receipt(r app_private.listing_report_decisions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','listing-report-decision-receipt-v1','operationId',r.operation_id,'reportId',r.report_id,
  'version',r.version::text,'decision',r.decision,'reason',r.reason,'actorId',r.actor_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
CREATE FUNCTION app_api.capture_listing_report(p_id uuid,p_request jsonb,p_notice text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.listing_reports;op uuid;listing uuid;revision integer;
BEGIN
 IF app_private.context_actor() IS NOT NULL THEN RAISE EXCEPTION 'Anonymous capture required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR NOT app_private.listing_report_request_valid(p_request) OR p_notice IS NULL OR p_notice!~'^[a-z0-9][a-z0-9.-]{0,119}$' THEN
  RAISE EXCEPTION 'Invalid listing report' USING ERRCODE='23514';END IF;
 op:=(p_request->>'operationId')::uuid;listing:=(p_request->>'listingId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':report:'||op::text,0));
 SELECT * INTO r FROM app_private.listing_reports WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 IF FOUND THEN
  IF r.request IS DISTINCT FROM p_request OR r.notice_version<>p_notice THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505';END IF;
  RETURN app_private.listing_report_receipt(r);
 END IF;
 -- Compatible with operational pause/availability/approval row locking. No guest write to the listing.
 PERFORM 1 FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=listing FOR SHARE;
 SELECT revision_no INTO revision FROM app_api.public_listings WHERE listing_id=listing;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 INSERT INTO app_private.listing_reports(tenant_id,id,operation_id,listing_id,contacted_revision,request,notice_version)
 VALUES(app_private.context_tenant(),p_id,op,listing,revision,p_request,p_notice) RETURNING * INTO r;
 PERFORM app_private.audit('listing.report_received','listing_report',r.id,1,jsonb_build_object('listingId',listing,'revision',revision));
 RETURN app_private.listing_report_receipt(r);
END $$;
CREATE FUNCTION app_api.read_listing_report_receipt(p_listing uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.listing_reports;
BEGIN
 IF app_private.context_actor() IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled) THEN
  RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM app_private.listing_reports WHERE tenant_id=app_private.context_tenant() AND listing_id=p_listing AND operation_id=p_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 -- Only minimal capture facts. No public report details or agency decision are exposed.
 RETURN app_private.listing_report_receipt(r);
END $$;
CREATE FUNCTION app_api.list_listing_reports(p_limit integer DEFAULT 50,p_before uuid DEFAULT NULL,p_status text DEFAULT 'new') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor app_private.listing_reports;payload jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_status IS NULL OR p_status NOT IN ('all','new','reviewed','dismissed') THEN
  RAISE EXCEPTION 'Invalid report queue' USING ERRCODE='23514';END IF;
 IF p_before IS NOT NULL THEN
  SELECT * INTO anchor FROM app_private.listing_reports WHERE tenant_id=app_private.context_tenant() AND id=p_before;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 END IF;
 WITH page AS (
  SELECT r.recorded_at,r.id,jsonb_build_object('reportId',r.id,'listingId',r.listing_id,'revision',r.contacted_revision,
    'reason',r.request->'reason','details',r.request->'details','noticeVersion',r.notice_version,
    'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'version',coalesce(d.version,1)::text,'status',coalesce(d.decision,'new'),
    'decision',CASE WHEN d.version IS NULL THEN NULL ELSE jsonb_build_object('kind',d.decision,'reason',d.reason,'actorId',d.actor_id,'recordedAt',to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END) AS body
  FROM app_private.listing_reports r LEFT JOIN LATERAL
   (SELECT x.* FROM app_private.listing_report_decisions x WHERE x.tenant_id=r.tenant_id AND x.report_id=r.id ORDER BY version DESC LIMIT 1) d ON true
  WHERE r.tenant_id=app_private.context_tenant() AND (p_before IS NULL OR (r.recorded_at,r.id)<(anchor.recorded_at,anchor.id))
   AND (p_status='all' OR coalesce(d.decision,'new')=p_status)
  ORDER BY r.recorded_at DESC,r.id DESC LIMIT p_limit+1
 ),numbered AS(SELECT *,row_number()OVER(ORDER BY recorded_at DESC,id DESC) AS rn FROM page)
 SELECT jsonb_build_object('policy','listing-report-queue-v1','items',coalesce(jsonb_agg(body ORDER BY rn)FILTER(WHERE rn<=p_limit),'[]'::jsonb),
   'hasMore',count(*)>p_limit,'limit',p_limit,'status',p_status) INTO payload FROM numbered;
 RETURN payload;
END $$;
CREATE FUNCTION app_api.read_listing_report_decision(p_report uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.listing_report_decisions;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 SELECT * INTO r FROM app_private.listing_report_decisions WHERE tenant_id=app_private.context_tenant()
  AND report_id=p_report AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 RETURN app_private.listing_report_decision_receipt(r);
END $$;
CREATE FUNCTION app_api.decide_listing_report(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.listing_report_decisions;op uuid;report uuid;expected bigint;actual bigint;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR
 (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_request) key) IS DISTINCT FROM ARRAY['decision','expectedVersion','operationId','policy','reason','reportId']::text[]
 OR jsonb_typeof(p_request->'policy')<>'string' OR p_request->>'policy'<>'listing-report-decision-command-v1'
 OR jsonb_typeof(p_request->'operationId')<>'string' OR (p_request->>'operationId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_request->'reportId')<>'string' OR (p_request->>'reportId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_request->'expectedVersion')<>'string' OR (p_request->>'expectedVersion')!~'^[1-9][0-9]{0,15}$'
 OR (p_request->>'expectedVersion')::numeric>=9007199254740991
 OR jsonb_typeof(p_request->'decision')<>'string' OR p_request->>'decision' NOT IN ('reviewed','dismissed')
 OR jsonb_typeof(p_request->'reason')<>'string' OR NOT app_private.listing_report_text_valid(p_request->>'reason',500) THEN
  RAISE EXCEPTION 'Invalid report decision' USING ERRCODE='23514';END IF;
 op:=(p_request->>'operationId')::uuid;report:=(p_request->>'reportId')::uuid;expected:=(p_request->>'expectedVersion')::bigint;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':report-decision:'||op::text,0));
 -- Original recovery is current-admin/actor bound, never a replayed publication change.
 SELECT * INTO r FROM app_private.listing_report_decisions WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 IF FOUND THEN
  IF r.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
  IF r.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505';END IF;
  RETURN app_private.listing_report_decision_receipt(r);
 END IF;
 PERFORM 1 FROM app_private.listing_reports WHERE tenant_id=app_private.context_tenant() AND id=report FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 -- Lock the report first, then recheck operation and version for equivalent concurrent retries.
 SELECT * INTO r FROM app_private.listing_report_decisions WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 IF FOUND THEN
  IF r.actor_id<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
  IF r.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505';END IF;
  RETURN app_private.listing_report_decision_receipt(r);
 END IF;
 SELECT coalesce(max(version),1) INTO actual FROM app_private.listing_report_decisions WHERE tenant_id=app_private.context_tenant() AND report_id=report;
 IF expected<>actual THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 IF actual<>1 THEN RAISE EXCEPTION 'Report already reviewed' USING ERRCODE='23514';END IF;
 INSERT INTO app_private.listing_report_decisions(tenant_id,report_id,version,operation_id,actor_id,request,decision,reason)
 VALUES(app_private.context_tenant(),report,actual+1,op,app_private.context_actor(),p_request,p_request->>'decision',p_request->>'reason') RETURNING * INTO r;
 PERFORM app_private.audit('listing.report_'||r.decision,'listing_report',report,r.version);
 RETURN app_private.listing_report_decision_receipt(r);
END $$;
REVOKE ALL ON FUNCTION app_private.listing_report_text_valid(text,integer),app_private.listing_report_request_valid(jsonb),
 app_private.listing_report_receipt(app_private.listing_reports),app_private.listing_report_decision_receipt(app_private.listing_report_decisions),
 app_api.capture_listing_report(uuid,jsonb,text),app_api.read_listing_report_receipt(uuid,uuid),app_api.list_listing_reports(integer,uuid,text),
 app_api.read_listing_report_decision(uuid,uuid),app_api.decide_listing_report(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.capture_listing_report(uuid,jsonb,text),app_api.read_listing_report_receipt(uuid,uuid),
 app_api.list_listing_reports(integer,uuid,text),app_api.read_listing_report_decision(uuid,uuid),app_api.decide_listing_report(jsonb) TO api_runtime;
COMMIT;

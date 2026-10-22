-- Provisional private synthetic assessments only; never confers a public badge.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.listing_verification_note_valid(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p IS NOT NULL AND length(p) BETWEEN 1 AND 600
 AND p=btrim(p,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
 AND p !~ ('['||chr(1)||'-'||chr(31)||chr(127)||'-'||chr(159)||']')
$$;
CREATE TABLE app_private.listing_verification_state (
 tenant_id uuid NOT NULL,listing_id uuid NOT NULL,version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),last_recorded_at timestamptz,
 PRIMARY KEY(tenant_id,listing_id),FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),
 CHECK((version=0)=(last_recorded_at IS NULL)),CHECK(last_recorded_at IS NULL OR (isfinite(last_recorded_at) AND extract(year FROM last_recorded_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999))
);
CREATE TABLE app_private.listing_verification_operations (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,listing_id uuid NOT NULL,requester_id uuid NOT NULL,request jsonb NOT NULL,receipt jsonb NOT NULL,
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,operation_id,listing_id),
 FOREIGN KEY(tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),FOREIGN KEY(tenant_id,requester_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK(jsonb_typeof(request)='object' AND jsonb_typeof(receipt)='object')
);
CREATE TABLE app_private.listing_verification_records (
 tenant_id uuid NOT NULL,listing_id uuid NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),operation_id uuid NOT NULL,actor_id uuid NOT NULL,
 listing_version bigint NOT NULL CHECK(listing_version BETWEEN 1 AND 9007199254740991),revision_no integer NOT NULL CHECK(revision_no>0),revision_version bigint NOT NULL CHECK(revision_version BETWEEN 1 AND 9007199254740991),
 subject text NOT NULL CHECK(subject IN ('identity','advertising_authority','availability')),outcome text NOT NULL CHECK(outcome IN ('supported','not_supported','inconclusive')),
 evidence_reference text,note text NOT NULL CHECK(app_private.listing_verification_note_valid(note)),observed_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,listing_id,version),UNIQUE(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,operation_id,listing_id) REFERENCES app_private.listing_verification_operations(tenant_id,operation_id,listing_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 CHECK(evidence_reference IS NULL OR evidence_reference ~ '^synthetic:[a-z0-9][a-z0-9-]{0,79}$'),CHECK(outcome='inconclusive' OR evidence_reference IS NOT NULL),
 CHECK(isfinite(observed_at) AND isfinite(recorded_at) AND observed_at<=recorded_at AND extract(year FROM observed_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 AND extract(year FROM recorded_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)
);
ALTER TABLE app_private.listing_verification_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_verification_state FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_verification_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_verification_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_verification_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.listing_verification_records FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON app_private.listing_verification_state TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_access ON app_private.listing_verification_operations TO realtor_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_access ON app_private.listing_verification_records TO realtor_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_verification_operation BEFORE UPDATE OR DELETE ON app_private.listing_verification_operations FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
CREATE TRIGGER immutable_verification_record BEFORE UPDATE OR DELETE ON app_private.listing_verification_records FOR EACH ROW EXECUTE FUNCTION app_private.immutable_enquiry_operation();
REVOKE ALL ON app_private.listing_verification_state,app_private.listing_verification_operations,app_private.listing_verification_records FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.listing_verification_record_json(p app_private.listing_verification_records) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('kind','listing_verification_record','policy','synthetic-check-record-v1','operationId',p.operation_id,'target',jsonb_build_object('listingId',p.listing_id,'listingVersion',p.listing_version::text,'revision',p.revision_no,'revisionVersion',p.revision_version::text),
 'subject',p.subject,'outcome',p.outcome,'evidenceReference',p.evidence_reference,'note',p.note,'observedAt',to_char(p.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'actorId',p.actor_id,'recordedAt',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'verificationVersion',p.version::text)
$$;
CREATE FUNCTION app_api.read_listing_verification(p_listing uuid,p_operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF app_private.staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT q.receipt INTO result FROM app_private.listing_verification_operations q JOIN app_private.listings l ON l.tenant_id=q.tenant_id AND l.id=q.listing_id
 WHERE q.tenant_id=app_private.context_tenant() AND q.listing_id=p_listing AND q.operation_id=p_operation AND q.requester_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;RETURN result;
END $$;
CREATE FUNCTION app_api.record_synthetic_listing_verification(p_listing uuid,p_operation uuid,p_listing_version bigint,p_revision integer,p_revision_version bigint,p_expected bigint,p_subject text,p_outcome text,p_reference text,p_note text,p_observed text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;s app_private.listing_verification_state;q app_private.listing_verification_operations;v app_private.listing_verification_records;
 observed timestamptz;completed timestamptz;original jsonb;receipt jsonb;result jsonb;decision text:='recorded';reason text;
BEGIN
 IF app_private.staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 -- Keep the authorized membership/company stable until this transaction finishes.
 PERFORM m.user_id FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=app_private.context_tenant() AND m.user_id=app_private.context_actor() AND m.role='admin' AND m.active AND t.enabled FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF p_listing IS NULL OR p_operation IS NULL OR p_listing::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_operation::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR p_listing_version IS NULL OR p_listing_version NOT BETWEEN 1 AND 9007199254740991 OR p_revision IS NULL OR p_revision<1 OR p_revision_version IS NULL OR p_revision_version NOT BETWEEN 1 AND 9007199254740991 OR p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 9007199254740991
 OR p_subject IS NULL OR p_subject NOT IN ('identity','advertising_authority','availability') OR p_outcome IS NULL OR p_outcome NOT IN ('supported','not_supported','inconclusive')
 OR (p_reference IS NOT NULL AND p_reference !~ '^synthetic:[a-z0-9][a-z0-9-]{0,79}$') OR (p_outcome<>'inconclusive' AND p_reference IS NULL)
 OR NOT app_private.listing_verification_note_valid(p_note) OR p_observed IS NULL OR p_observed !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 THEN RAISE EXCEPTION 'Invalid synthetic check' USING ERRCODE='23514';END IF;
 BEGIN observed:=p_observed::timestamptz;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Invalid observation time' USING ERRCODE='23514';END;
 IF NOT isfinite(observed) OR extract(year FROM observed AT TIME ZONE 'UTC') NOT BETWEEN 1 AND 9999 OR to_char(observed AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_observed THEN RAISE EXCEPTION 'Invalid observation time' USING ERRCODE='23514';END IF;
 original:=jsonb_build_object('operationId',p_operation,'policy','synthetic-check-record-v1','target',jsonb_build_object('listingId',p_listing,'listingVersion',p_listing_version::text,'revision',p_revision,'revisionVersion',p_revision_version::text),'expectedVerificationVersion',p_expected::text,'subject',p_subject,'outcome',p_outcome,'evidenceReference',p_reference,'note',p_note,'observedAt',p_observed);
 -- Same operation across different target listings cannot race into separate requests.
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':'||p_operation::text,30));
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO q FROM app_private.listing_verification_operations WHERE tenant_id=l.tenant_id AND operation_id=p_operation;
 IF FOUND THEN
  IF q.listing_id<>p_listing OR q.requester_id<>app_private.context_actor() OR q.request<>original THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='40001';END IF;
  RETURN app_api.read_listing_verification(p_listing,p_operation);
 END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id ORDER BY revision_no DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 INSERT INTO app_private.listing_verification_state(tenant_id,listing_id) VALUES(l.tenant_id,l.id) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM app_private.listing_verification_state WHERE tenant_id=l.tenant_id AND listing_id=l.id FOR UPDATE;
 completed:=date_trunc('milliseconds',clock_timestamp());
 IF l.version<>p_listing_version OR r.revision_no<>p_revision OR r.version<>p_revision_version THEN decision:='conflict';reason:='LISTING_CHANGED';
 ELSIF s.version<>p_expected THEN decision:='conflict';reason:='VERIFICATION_CHANGED';
 ELSIF s.version=9007199254740991 THEN decision:='refused';reason:='VERSION_LIMIT';
 ELSIF observed>completed THEN decision:='refused';reason:='OBSERVATION_IN_FUTURE';
 ELSIF s.last_recorded_at>completed THEN decision:='refused';reason:='RECORD_CLOCK_INVALID';
 ELSE
  INSERT INTO app_private.listing_verification_records VALUES(l.tenant_id,l.id,s.version+1,p_operation,app_private.context_actor(),p_listing_version,p_revision,p_revision_version,p_subject,p_outcome,p_reference,p_note,observed,completed) RETURNING * INTO v;
  UPDATE app_private.listing_verification_state SET version=v.version,last_recorded_at=completed WHERE tenant_id=l.tenant_id AND listing_id=l.id;
  PERFORM app_private.audit('listing.synthetic_check_recorded','listing_verification',l.id,v.version,jsonb_build_object('operationId',p_operation,'policy','synthetic-check-record-v1','subject',p_subject,'outcome',p_outcome));
  result:=app_private.listing_verification_record_json(v);
 END IF;
 receipt:=jsonb_build_object('kind','listing_verification_receipt','operationId',p_operation,'listingId',p_listing,'actorId',app_private.context_actor(),'request',original,'decision',jsonb_build_object('outcome',decision,'reason',reason,'record',result),'completedAt',to_char(completed AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 INSERT INTO app_private.listing_verification_operations VALUES(l.tenant_id,p_operation,l.id,app_private.context_actor(),original,receipt);
 RETURN app_api.read_listing_verification(p_listing,p_operation);
END $$;
CREATE FUNCTION app_api.read_listing_verification_history(p_listing uuid,p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE records jsonb;more boolean;v bigint;
BEGIN
 IF app_private.staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid history limit' USING ERRCODE='23514';END IF;
 SELECT version INTO v FROM app_private.listing_verification_state WHERE tenant_id=app_private.context_tenant() AND listing_id=p_listing;
 WITH page AS (SELECT x.*,row_number() OVER(ORDER BY x.version DESC) AS n FROM app_private.listing_verification_records x WHERE tenant_id=app_private.context_tenant() AND listing_id=p_listing ORDER BY version DESC LIMIT p_limit+1)
 SELECT coalesce(jsonb_agg(app_private.listing_verification_record_json(ROW(p.tenant_id,p.listing_id,p.version,p.operation_id,p.actor_id,p.listing_version,p.revision_no,p.revision_version,p.subject,p.outcome,p.evidence_reference,p.note,p.observed_at,p.recorded_at)::app_private.listing_verification_records) ORDER BY p.version DESC) FILTER(WHERE p.n<=p_limit),'[]'::jsonb),coalesce(bool_or(p.n>p_limit),false) INTO records,more FROM page p;
 RETURN jsonb_build_object('kind','listing_verification_history','listingId',p_listing,'verificationVersion',coalesce(v,0)::text,'records',records,'hasMore',more);
END $$;
REVOKE ALL ON FUNCTION app_private.listing_verification_record_json(app_private.listing_verification_records),app_api.read_listing_verification(uuid,uuid),app_api.record_synthetic_listing_verification(uuid,uuid,bigint,integer,bigint,bigint,text,text,text,text,text),app_api.read_listing_verification_history(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.listing_verification_note_valid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_listing_verification(uuid,uuid),app_api.record_synthetic_listing_verification(uuid,uuid,bigint,integer,bigint,bigint,text,text,text,text,text),app_api.read_listing_verification_history(uuid,integer) TO api_runtime;
COMMIT;

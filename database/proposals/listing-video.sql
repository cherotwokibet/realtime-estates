-- Isolated private metadata preparation only. No public read, embed, remote fetch,
-- video bytes, approval change or production migration installation.
BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE FUNCTION app_private.synthetic_listing_video_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF v='null'::jsonb THEN RETURN true;END IF;
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key)
   IS DISTINCT FROM ARRAY['provider','title','videoId']::text[] THEN RETURN false;END IF;
 RETURN coalesce(jsonb_typeof(v->'provider')='string' AND jsonb_typeof(v->'videoId')='string'
  AND ((v->>'provider'='youtube' AND v->>'videoId'~'^[A-Za-z0-9_-]{11}$')
    OR (v->>'provider'='vimeo' AND v->>'videoId'~'^[1-9][0-9]{0,11}$'))
  AND jsonb_typeof(v->'title')='string' AND app_private.listing_report_text_valid(v->>'title',120)
  AND v->>'title' !~ U&'[\0080-\009F]'
  AND v->>'title' !~ U&'^[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]|[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]$',false);
END $$;
CREATE FUNCTION app_private.synthetic_listing_video_command_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key)
  IS DISTINCT FROM ARRAY['expectedVersion','listingId','operationId','policy','revision','video']::text[] THEN RETURN false;END IF;
 RETURN coalesce(v->>'policy'='synthetic-listing-video-command-v1' AND jsonb_typeof(v->'policy')='string'
  AND jsonb_typeof(v->'operationId')='string' AND v->>'operationId'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(v->'listingId')='string' AND v->>'listingId'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND jsonb_typeof(v->'revision')='number' AND v->>'revision'~'^[1-9][0-9]{0,9}$' AND (v->>'revision')::numeric<=2147483647
  AND jsonb_typeof(v->'expectedVersion')='string' AND v->>'expectedVersion'~'^[1-9][0-9]{0,15}$'
  AND (v->>'expectedVersion')::numeric<9007199254740991 AND app_private.synthetic_listing_video_valid(v->'video'),false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
CREATE TABLE app_private.synthetic_listing_video_operations (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,listing_id uuid NOT NULL,revision_no integer NOT NULL,
 actor_id uuid NOT NULL,command jsonb NOT NULL CHECK(app_private.synthetic_listing_video_command_valid(command)),
 result_version bigint NOT NULL CHECK(result_version BETWEEN 2 AND 9007199254740991),
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,listing_id,revision_no,result_version),
 FOREIGN KEY(tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id),
 CHECK(operation_id=(command->>'operationId')::uuid AND listing_id=(command->>'listingId')::uuid
  AND revision_no=(command->>'revision')::integer AND result_version=(command->>'expectedVersion')::bigint+1)
);
ALTER TABLE app_private.synthetic_listing_video_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.synthetic_listing_video_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON app_private.synthetic_listing_video_operations TO realtor_owner
 USING(tenant_id=app_private.context_tenant()) WITH CHECK(tenant_id=app_private.context_tenant());
CREATE TRIGGER immutable_video_original BEFORE UPDATE OR DELETE ON app_private.synthetic_listing_video_operations
 FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
REVOKE ALL ON app_private.synthetic_listing_video_operations FROM PUBLIC,api_runtime,media_coordinator;
CREATE FUNCTION app_private.synthetic_listing_video_record(r app_private.synthetic_listing_video_operations) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy','synthetic-listing-video-record-v1','command',r.command,'actorId',r.actor_id,'resultVersion',r.result_version::text)
$$;
CREATE FUNCTION app_api.save_synthetic_listing_video(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;prior app_private.synthetic_listing_video_operations;
 op uuid;id uuid;rev integer;expected bigint;result bigint;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 IF NOT app_private.synthetic_listing_video_command_valid(p_command) THEN RAISE EXCEPTION 'Invalid video command' USING ERRCODE='23514';END IF;
 op:=(p_command->>'operationId')::uuid;id:=(p_command->>'listingId')::uuid;rev:=(p_command->>'revision')::integer;expected:=(p_command->>'expectedVersion')::bigint;
 l:=app_private.lock_listing(id);
 PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||':listing-video:'||op::text,0));
 SELECT * INTO prior FROM app_private.synthetic_listing_video_operations WHERE tenant_id=app_private.context_tenant() AND operation_id=op;
 IF FOUND THEN
  IF prior.actor_id<>app_private.context_actor() OR prior.command IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'Original differs' USING ERRCODE='40001';END IF;
  RETURN app_private.synthetic_listing_video_record(prior);
 END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant() AND listing_id=id AND revision_no=rev FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 IF l.publication_status='archived' OR r.state<>'draft' OR EXISTS(SELECT 1 FROM app_private.listing_revisions
  WHERE tenant_id=r.tenant_id AND listing_id=r.listing_id AND revision_no>rev) THEN RAISE EXCEPTION 'Current draft required' USING ERRCODE='23514';END IF;
 IF r.version<>expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 -- Shared revision version serializes video preparation against normal draft/media/transition writes.
 UPDATE app_private.listing_revisions SET description=description WHERE tenant_id=r.tenant_id AND listing_id=id AND revision_no=rev RETURNING version INTO result;
 INSERT INTO app_private.synthetic_listing_video_operations(tenant_id,operation_id,listing_id,revision_no,actor_id,command,result_version)
 VALUES(app_private.context_tenant(),op,id,rev,app_private.context_actor(),p_command,result) RETURNING * INTO prior;
 PERFORM app_private.audit('listing.private_video_saved','listing',id,result,jsonb_build_object('revision',rev,'operationId',op));
 RETURN app_private.synthetic_listing_video_record(prior);
END $$;
CREATE FUNCTION app_api.read_synthetic_listing_video_original(p_listing uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.synthetic_listing_video_operations;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.synthetic_listing_video_operations WHERE tenant_id=l.tenant_id AND listing_id=l.id AND operation_id=p_operation AND actor_id=app_private.context_actor();
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='P0002';END IF;
 RETURN app_private.synthetic_listing_video_record(r);
END $$;
CREATE FUNCTION app_api.read_synthetic_listing_video(p_listing uuid,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app_private.listings;r app_private.listing_revisions;video jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['agent','admin']);
 SELECT * INTO l FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_listing;
 IF NOT FOUND OR NOT app_private.may_work(l.tenant_id,l.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM app_private.listing_revisions WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Revision unavailable' USING ERRCODE='P0002';END IF;
 SELECT command->'video' INTO video FROM app_private.synthetic_listing_video_operations WHERE tenant_id=l.tenant_id AND listing_id=l.id AND revision_no=p_revision ORDER BY result_version DESC LIMIT 1;
 RETURN jsonb_build_object('policy','synthetic-listing-video-state-v1','listingId',l.id,'revision',p_revision,'version',r.version::text,'video',coalesce(video,'null'::jsonb));
END $$;
REVOKE ALL ON FUNCTION app_private.synthetic_listing_video_valid(jsonb),app_private.synthetic_listing_video_command_valid(jsonb),
 app_private.synthetic_listing_video_record(app_private.synthetic_listing_video_operations) FROM PUBLIC,api_runtime,media_coordinator;
REVOKE ALL ON FUNCTION app_api.save_synthetic_listing_video(jsonb),app_api.read_synthetic_listing_video_original(uuid,uuid),app_api.read_synthetic_listing_video(uuid,integer) FROM PUBLIC,media_coordinator;
GRANT EXECUTE ON FUNCTION app_api.save_synthetic_listing_video(jsonb),app_api.read_synthetic_listing_video_original(uuid,uuid),app_api.read_synthetic_listing_video(uuid,integer) TO api_runtime;
COMMIT;

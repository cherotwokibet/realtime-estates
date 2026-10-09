-- Independently written replacement foundation. Bootstrap with a migration administrator.
-- API connections must SET ROLE api_runtime and set transaction-local, verified identity.
BEGIN;
CREATE ROLE realtor_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE ROLE api_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA app_private AUTHORIZATION realtor_owner;
CREATE SCHEMA app_api AUTHORIZATION realtor_owner;
REVOKE ALL ON SCHEMA app_private, app_api FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private, app_api TO api_runtime;
SET LOCAL ROLE realtor_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE app_private.tenants (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.memberships (
  tenant_id uuid NOT NULL REFERENCES app_private.tenants(id), user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('customer','agent','admin')), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  PRIMARY KEY (tenant_id,user_id), CHECK (active OR revoked_at IS NOT NULL)
);
CREATE TABLE app_private.listings (
  tenant_id uuid NOT NULL REFERENCES app_private.tenants(id), id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by_id uuid NOT NULL, assigned_agent_id uuid NOT NULL,
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','reserved','rented','sold','withdrawn')),
  publication_status text NOT NULL DEFAULT 'unpublished' CHECK (publication_status IN ('unpublished','published','paused','archived')),
  published_revision_no integer, last_availability_confirmed_at timestamptz, archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,slug),
  FOREIGN KEY (tenant_id,created_by_id) REFERENCES app_private.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,assigned_agent_id) REFERENCES app_private.memberships(tenant_id,user_id),
  CHECK ((publication_status = 'archived') = (archived_at IS NOT NULL))
);
CREATE TABLE app_private.listing_revisions (
  tenant_id uuid NOT NULL, listing_id uuid NOT NULL, revision_no integer NOT NULL CHECK (revision_no > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pending','approved','rejected')),
  title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 10000),
  purpose text CHECK (purpose IN ('rent','sale')),
  property_type text CHECK (property_type IN ('apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land')),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  amount_minor bigint CHECK (amount_minor BETWEEN 1 AND 100000000000000),
  rent_period text CHECK (rent_period IN ('day','week','month','year')),
  bedrooms integer CHECK (bedrooms BETWEEN 0 AND 100),
  private_bathrooms integer CHECK (private_bathrooms BETWEEN 0 AND 100),
  shared_bathrooms integer CHECK (shared_bathrooms BETWEEN 0 AND 100),
  country text NOT NULL DEFAULT 'KE' CHECK (country = 'KE'),
  locality text CHECK (locality IS NULL OR length(btrim(locality)) BETWEEN 1 AND 160),
  public_precision text NOT NULL DEFAULT 'area' CHECK (public_precision IN ('area','exact')),
  latitude numeric CHECK (latitude BETWEEN -90 AND 90), longitude numeric CHECK (longitude BETWEEN -180 AND 180),
  private_address text CHECK (length(private_address) <= 1000),
  submitted_at timestamptz, submitted_by uuid, decided_at timestamptz, decided_by uuid, decision_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,listing_id,revision_no),
  FOREIGN KEY (tenant_id,listing_id) REFERENCES app_private.listings(tenant_id,id),
  FOREIGN KEY (tenant_id,submitted_by) REFERENCES app_private.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,decided_by) REFERENCES app_private.memberships(tenant_id,user_id),
  CHECK (purpose IS DISTINCT FROM 'sale' OR rent_period IS NULL),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (property_type IS DISTINCT FROM 'land' OR bedrooms IS NULL),
  CHECK (property_type NOT IN ('studio','bedsitter') OR bedrooms IS NULL OR bedrooms = 0),
  CHECK (state = 'draft' OR (title IS NOT NULL AND description IS NOT NULL AND purpose IS NOT NULL
    AND property_type IS NOT NULL AND amount_minor IS NOT NULL AND locality IS NOT NULL
    AND (purpose <> 'rent' OR rent_period IS NOT NULL)
    AND (property_type NOT IN ('apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa') OR bedrooms IS NOT NULL))),
  CHECK (state <> 'rejected' OR coalesce(length(btrim(decision_reason)),0) > 0)
);
ALTER TABLE app_private.listings ADD CONSTRAINT published_revision_same_tenant
  FOREIGN KEY (tenant_id,id,published_revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no);

-- Only a future trusted media processor may add accepted assets. The API role has no DML here.
CREATE TABLE app_private.revision_media (
  tenant_id uuid NOT NULL, listing_id uuid NOT NULL, revision_no integer NOT NULL, id uuid NOT NULL,
  public_object_key text NOT NULL CHECK (public_object_key ~ '^[a-zA-Z0-9/_-]+\.(webp|jpg|png)$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  width integer NOT NULL CHECK (width > 0), height integer NOT NULL CHECK (height > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  alt_text text NOT NULL CHECK (length(btrim(alt_text)) BETWEEN 1 AND 300),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 11), accepted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,listing_id,revision_no,position),
  FOREIGN KEY (tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
  CHECK (width::bigint * height::bigint <= 40000000)
);
CREATE TABLE app_private.public_snapshots (
  tenant_id uuid NOT NULL, listing_id uuid NOT NULL, revision_no integer NOT NULL,
  title text NOT NULL, description text NOT NULL, purpose text NOT NULL, property_type text NOT NULL,
  currency text NOT NULL CHECK (currency = 'KES'), amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000000),
  rent_period text, bedrooms integer, private_bathrooms integer, shared_bathrooms integer,
  country text NOT NULL, locality text NOT NULL, public_precision text NOT NULL,
  latitude numeric, longitude numeric, photo_refs jsonb NOT NULL,
  approved_at timestamptz NOT NULL, PRIMARY KEY (tenant_id,listing_id),
  FOREIGN KEY (tenant_id,listing_id,revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no)
);
CREATE TABLE app_private.enquiries (
  tenant_id uuid NOT NULL REFERENCES app_private.tenants(id), id uuid NOT NULL, idempotency_key uuid NOT NULL,
  listing_id uuid, contacted_revision_no integer, requested_by_id uuid, assigned_agent_id uuid,
  contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 1 AND 160),
  phone_e164 text CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text CHECK (length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
  origin text NOT NULL CHECK (origin IN ('web','mobile','staff')),
  notice_version text NOT NULL CHECK (length(btrim(notice_version)) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','assigned','contacted','qualified','closed_won','closed_lost','spam')),
  next_action_at timestamptz, closure_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,listing_id,contacted_revision_no) REFERENCES app_private.listing_revisions(tenant_id,listing_id,revision_no),
  FOREIGN KEY (tenant_id,requested_by_id) REFERENCES app_private.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,assigned_agent_id) REFERENCES app_private.memberships(tenant_id,user_id),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL),
  CHECK ((listing_id IS NULL) = (contacted_revision_no IS NULL)),
  CHECK (status NOT IN ('contacted','qualified') OR next_action_at IS NOT NULL),
  CHECK (status NOT IN ('closed_lost','spam') OR coalesce(length(btrim(closure_reason)),0) > 0)
);
CREATE TABLE app_private.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app_private.tenants(id), actor_id uuid,
  action text NOT NULL, object_type text NOT NULL, object_id uuid NOT NULL, object_version bigint,
  correlation_id text, summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES app_private.memberships(tenant_id,user_id)
);
CREATE INDEX listing_assignee ON app_private.listings(tenant_id,assigned_agent_id,id);
CREATE INDEX enquiry_assignee ON app_private.enquiries(tenant_id,assigned_agent_id,status);
CREATE INDEX audit_tenant_time ON app_private.audit_events(tenant_id,occurred_at DESC);

CREATE FUNCTION app_private.context_tenant() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('realtor.tenant_id',true),'')::uuid $$;
CREATE FUNCTION app_private.context_actor() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('realtor.actor_id',true),'')::uuid $$;
CREATE FUNCTION app_private.staff_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog AS $$
  SELECT m.role FROM app_private.memberships m JOIN app_private.tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=app_private.context_tenant() AND m.user_id=app_private.context_actor()
     AND m.active AND t.enabled
$$;
CREATE FUNCTION app_private.may_work(p_tenant uuid,p_assigned uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$
  SELECT coalesce(p_tenant=app_private.context_tenant() AND
    (app_private.staff_role()='admin' OR (app_private.staff_role()='agent' AND p_assigned=app_private.context_actor())),false)
$$;
CREATE FUNCTION app_private.assert_staff(p_roles text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog AS $$ BEGIN
  IF NOT coalesce(app_private.staff_role()=ANY(p_roles),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app_private.touch_version() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog AS $$ BEGIN
  NEW.version := OLD.version+1; NEW.updated_at := now(); RETURN NEW;
END $$;
CREATE TRIGGER touch_listing BEFORE UPDATE ON app_private.listings FOR EACH ROW EXECUTE FUNCTION app_private.touch_version();
CREATE TRIGGER touch_revision BEFORE UPDATE ON app_private.listing_revisions FOR EACH ROW EXECUTE FUNCTION app_private.touch_version();
CREATE TRIGGER touch_enquiry BEFORE UPDATE ON app_private.enquiries FOR EACH ROW EXECUTE FUNCTION app_private.touch_version();
CREATE FUNCTION app_private.immutable_revision() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state<>'draft' THEN RAISE EXCEPTION 'Submitted revisions are immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('approved','rejected') THEN RAISE EXCEPTION 'Decided revisions are immutable' USING ERRCODE='23514'; END IF;
  IF OLD.state='pending' AND (to_jsonb(NEW)-ARRAY['state','submitted_at','submitted_by','decided_at','decided_by','decision_reason','updated_at','version'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','submitted_at','submitted_by','decided_at','decided_by','decision_reason','updated_at','version'])
    THEN RAISE EXCEPTION 'Pending content is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON app_private.listing_revisions FOR EACH ROW EXECUTE FUNCTION app_private.immutable_revision();
CREATE FUNCTION app_private.immutable_media() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_state text; BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT state INTO v_state FROM app_private.listing_revisions WHERE tenant_id=OLD.tenant_id
      AND listing_id=OLD.listing_id AND revision_no=OLD.revision_no FOR UPDATE;
    IF v_state <> 'draft' THEN RAISE EXCEPTION 'Submitted media is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT state INTO v_state FROM app_private.listing_revisions WHERE tenant_id=NEW.tenant_id
      AND listing_id=NEW.listing_id AND revision_no=NEW.revision_no FOR UPDATE;
    IF v_state <> 'draft' THEN RAISE EXCEPTION 'Submitted media is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_media BEFORE INSERT OR UPDATE OR DELETE ON app_private.revision_media FOR EACH ROW EXECUTE FUNCTION app_private.immutable_media();
CREATE FUNCTION app_private.immutable_audit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Audit events are append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.immutable_audit();
CREATE FUNCTION app_private.audit(p_action text,p_type text,p_id uuid,p_version bigint,p_summary jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO app_private.audit_events(tenant_id,actor_id,action,object_type,object_id,object_version,correlation_id,summary)
  VALUES(app_private.context_tenant(),app_private.context_actor(),p_action,p_type,p_id,p_version,
    left(nullif(current_setting('realtor.correlation_id',true),''),100),p_summary)
$$;

-- FORCE RLS also applies to the table owner; its explicit owner policy supports the
-- narrowly granted SECURITY DEFINER commands. api_runtime never has owner membership.
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['tenants','memberships','listings','listing_revisions','revision_media','public_snapshots','enquiries','audit_events'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY',v_table);
    EXECUTE format('CREATE POLICY owner_access ON app_private.%I TO realtor_owner USING (true) WITH CHECK (true)',v_table);
  END LOOP;
END $$;
CREATE POLICY own_tenant ON app_private.tenants FOR SELECT TO api_runtime USING (id=app_private.context_tenant() AND app_private.staff_role() IS NOT NULL);
CREATE POLICY own_membership ON app_private.memberships FOR SELECT TO api_runtime USING (tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor() AND app_private.staff_role() IS NOT NULL);
CREATE POLICY assigned_listing ON app_private.listings FOR SELECT TO api_runtime USING (app_private.may_work(tenant_id,assigned_agent_id));
CREATE POLICY assigned_revision ON app_private.listing_revisions FOR SELECT TO api_runtime USING (
  EXISTS(SELECT 1 FROM app_private.listings l WHERE l.tenant_id=listing_revisions.tenant_id AND l.id=listing_revisions.listing_id));
CREATE POLICY assigned_media ON app_private.revision_media FOR SELECT TO api_runtime USING (
  EXISTS(SELECT 1 FROM app_private.listings l WHERE l.tenant_id=revision_media.tenant_id AND l.id=revision_media.listing_id));
CREATE POLICY assigned_enquiry ON app_private.enquiries FOR SELECT TO api_runtime USING (app_private.may_work(tenant_id,assigned_agent_id));
CREATE POLICY tenant_admin_audit ON app_private.audit_events FOR SELECT TO api_runtime USING (
  tenant_id=app_private.context_tenant() AND app_private.staff_role()='admin');
GRANT SELECT ON app_private.tenants,app_private.memberships,app_private.listings,app_private.listing_revisions,
  app_private.revision_media,app_private.enquiries,app_private.audit_events TO api_runtime;
GRANT EXECUTE ON FUNCTION app_private.context_tenant(),app_private.context_actor(),app_private.staff_role(),app_private.may_work(uuid,uuid) TO api_runtime;

CREATE VIEW app_api.public_listings WITH (security_barrier=true) AS
 SELECT s.tenant_id,s.listing_id,s.revision_no,s.title,s.description,s.purpose,s.property_type,
   s.currency,s.amount_minor,s.rent_period,s.bedrooms,s.private_bathrooms,s.shared_bathrooms,
   s.country,s.locality,s.public_precision,s.latitude,s.longitude,s.photo_refs,s.approved_at,l.slug
 FROM app_private.public_snapshots s
 JOIN app_private.listings l ON l.tenant_id=s.tenant_id AND l.id=s.listing_id AND l.published_revision_no=s.revision_no
 JOIN app_private.tenants t ON t.id=l.tenant_id
 WHERE t.enabled AND l.tenant_id=app_private.context_tenant() AND l.publication_status='published'
   AND l.availability='available' AND l.last_availability_confirmed_at > now()-interval '30 days';
GRANT SELECT ON app_api.public_listings TO api_runtime;

CREATE FUNCTION app_private.lock_listing(p_id uuid,p_expected bigint DEFAULT NULL) RETURNS app_private.listings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_listing app_private.listings; BEGIN
  SELECT * INTO v_listing FROM app_private.listings WHERE tenant_id=app_private.context_tenant() AND id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.may_work(v_listing.tenant_id,v_listing.assigned_agent_id) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF p_expected IS NOT NULL AND v_listing.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  RETURN v_listing;
END $$;
CREATE FUNCTION app_private.require_version(p_version bigint,p_allow_new boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN
  IF p_version IS NULL OR p_version < (CASE WHEN p_allow_new THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'Expected version required' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION app_api.create_listing(p_id uuid,p_slug text,p_assigned uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_assigned uuid; BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  v_assigned:=coalesce(p_assigned,app_private.context_actor());
  IF app_private.staff_role()='agent' AND v_assigned<>app_private.context_actor() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=v_assigned AND active AND role IN ('agent','admin'))
    THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id)
    VALUES(app_private.context_tenant(),p_id,p_slug,app_private.context_actor(),v_assigned);
  PERFORM app_private.audit('listing.created','listing',p_id,1); RETURN p_id;
END $$;
CREATE FUNCTION app_api.save_draft(p_id uuid,p_revision integer,p_expected bigint,p_content jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_current app_private.listing_revisions; v_next integer; v_version bigint; BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); PERFORM app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected,true);
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid content fields' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_content) k WHERE k NOT IN
    ('title','description','purpose','propertyType','currency','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','country','locality','publicPrecision','latitude','longitude','privateAddress'))
    THEN RAISE EXCEPTION 'Invalid content fields' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_content) e WHERE
    CASE WHEN e.key IN ('amountMinor','bedrooms','privateBathrooms','sharedBathrooms','latitude','longitude')
      THEN jsonb_typeof(e.value) NOT IN ('number','null') ELSE jsonb_typeof(e.value) NOT IN ('string','null') END)
    THEN RAISE EXCEPTION 'Invalid content types' USING ERRCODE='23514'; END IF;
  IF (p_content->>'amountMinor') IS NOT NULL AND (p_content->>'amountMinor') !~ '^[0-9]+$'
    THEN RAISE EXCEPTION 'Money must use integer minor units' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_current FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
  IF FOUND THEN
    IF v_current.state<>'draft' THEN RAISE EXCEPTION 'Only drafts may be edited' USING ERRCODE='23514'; END IF;
    IF v_current.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  ELSE
    SELECT coalesce(max(revision_no),0)+1 INTO v_next FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id;
    IF p_expected<>0 OR p_revision<>v_next THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
    INSERT INTO app_private.listing_revisions(tenant_id,listing_id,revision_no) VALUES(app_private.context_tenant(),p_id,p_revision);
  END IF;
  UPDATE app_private.listing_revisions SET title=nullif(btrim(p_content->>'title'),''),description=nullif(btrim(p_content->>'description'),''),
    purpose=p_content->>'purpose',property_type=p_content->>'propertyType',currency=coalesce(p_content->>'currency','KES'),
    amount_minor=(p_content->>'amountMinor')::bigint,rent_period=p_content->>'rentPeriod',bedrooms=(p_content->>'bedrooms')::integer,
    private_bathrooms=(p_content->>'privateBathrooms')::integer,shared_bathrooms=(p_content->>'sharedBathrooms')::integer,
    country=coalesce(p_content->>'country','KE'),locality=nullif(btrim(p_content->>'locality'),''),
    public_precision=coalesce(p_content->>'publicPrecision','area'),latitude=(p_content->>'latitude')::numeric,
    longitude=(p_content->>'longitude')::numeric,private_address=p_content->>'privateAddress'
    WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision RETURNING version INTO v_version;
  PERFORM app_private.audit('revision.saved','listing',p_id,v_version,jsonb_build_object('revision',p_revision)); RETURN v_version;
END $$;
CREATE FUNCTION app_api.submit_revision(p_id uuid,p_revision integer,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_revision app_private.listing_revisions; v_count integer; v_version bigint; BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); PERFORM app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF v_revision.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF v_revision.state<>'draft' THEN RAISE EXCEPTION 'Expected draft' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO v_count FROM app_private.revision_media WHERE tenant_id=v_revision.tenant_id AND listing_id=p_id AND revision_no=p_revision AND accepted;
  IF v_count NOT BETWEEN 4 AND 12 THEN RAISE EXCEPTION 'Require 4 to 12 accepted photos' USING ERRCODE='23514'; END IF;
  UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=app_private.context_actor()
    WHERE tenant_id=v_revision.tenant_id AND listing_id=p_id AND revision_no=p_revision RETURNING version INTO v_version;
  PERFORM app_private.audit('revision.submitted','listing',p_id,v_version,jsonb_build_object('revision',p_revision)); RETURN v_version;
END $$;
CREATE FUNCTION app_api.withdraw_revision(p_id uuid,p_revision integer,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ DECLARE v_version bigint; BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); PERFORM app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected);
  UPDATE app_private.listing_revisions SET state='draft',submitted_at=NULL,submitted_by=NULL
    WHERE tenant_id=app_private.context_tenant() AND listing_id=p_id AND revision_no=p_revision AND state='pending' AND version=p_expected RETURNING version INTO v_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'State or version conflict' USING ERRCODE='40001'; END IF;
  PERFORM app_private.audit('revision.withdrawn','listing',p_id,v_version,jsonb_build_object('revision',p_revision)); RETURN v_version;
END $$;
CREATE FUNCTION app_api.decide_revision(p_id uuid,p_revision integer,p_expected bigint,p_approve boolean,p_reason text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_listing app_private.listings; v_revision app_private.listing_revisions; v_version bigint; BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']); v_listing:=app_private.lock_listing(p_id);
  PERFORM app_private.require_version(p_expected);
  SELECT * INTO v_revision FROM app_private.listing_revisions WHERE tenant_id=v_listing.tenant_id AND listing_id=p_id AND revision_no=p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF v_revision.state<>'pending' OR v_revision.version<>p_expected THEN RAISE EXCEPTION 'State or version conflict' USING ERRCODE='40001'; END IF;
  IF p_approve AND coalesce(v_listing.published_revision_no,0)>=p_revision THEN RAISE EXCEPTION 'Superseded review conflict' USING ERRCODE='40001'; END IF;
  IF p_approve IS NULL OR (NOT p_approve AND coalesce(length(btrim(p_reason)),0)=0) THEN RAISE EXCEPTION 'Decision requires a reason' USING ERRCODE='23514'; END IF;
  IF p_approve AND (v_listing.availability<>'available' OR v_listing.last_availability_confirmed_at IS NULL OR v_listing.last_availability_confirmed_at<=now()-interval '30 days')
    THEN RAISE EXCEPTION 'Availability confirmation required' USING ERRCODE='23514'; END IF;
  UPDATE app_private.listing_revisions SET state=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    decided_at=now(),decided_by=app_private.context_actor(),decision_reason=CASE WHEN p_approve THEN NULL ELSE btrim(p_reason) END
    WHERE tenant_id=v_listing.tenant_id AND listing_id=p_id AND revision_no=p_revision RETURNING version INTO v_version;
  IF p_approve THEN
    INSERT INTO app_private.public_snapshots SELECT r.tenant_id,r.listing_id,r.revision_no,r.title,r.description,r.purpose,r.property_type,
      r.currency,r.amount_minor,r.rent_period,r.bedrooms,r.private_bathrooms,r.shared_bathrooms,r.country,r.locality,r.public_precision,
      CASE WHEN r.public_precision='exact' THEN r.latitude END,CASE WHEN r.public_precision='exact' THEN r.longitude END,
      (SELECT jsonb_agg(jsonb_build_object('key',m.public_object_key,'alt',m.alt_text) ORDER BY m.position) FROM app_private.revision_media m
        WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no AND m.accepted),now()
      FROM app_private.listing_revisions r WHERE r.tenant_id=v_listing.tenant_id AND r.listing_id=p_id AND r.revision_no=p_revision
      ON CONFLICT(tenant_id,listing_id) DO UPDATE SET revision_no=EXCLUDED.revision_no,title=EXCLUDED.title,description=EXCLUDED.description,
        purpose=EXCLUDED.purpose,property_type=EXCLUDED.property_type,currency=EXCLUDED.currency,amount_minor=EXCLUDED.amount_minor,
        rent_period=EXCLUDED.rent_period,bedrooms=EXCLUDED.bedrooms,private_bathrooms=EXCLUDED.private_bathrooms,shared_bathrooms=EXCLUDED.shared_bathrooms,
        country=EXCLUDED.country,locality=EXCLUDED.locality,public_precision=EXCLUDED.public_precision,latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude,photo_refs=EXCLUDED.photo_refs,approved_at=EXCLUDED.approved_at;
    -- Reviewing content does not undo an operational pause/archive applied while it was pending.
    -- Keep the approved snapshot ready, but require the explicit admin restoration command.
    UPDATE app_private.listings SET published_revision_no=p_revision,
      publication_status=CASE WHEN publication_status IN ('paused','archived') THEN publication_status ELSE 'published' END
      WHERE tenant_id=v_listing.tenant_id AND id=p_id;
  END IF;
  PERFORM app_private.audit(CASE WHEN p_approve THEN 'revision.approved' ELSE 'revision.rejected' END,'listing',p_id,v_version,
    jsonb_build_object('revision',p_revision,'selfApproval',v_revision.submitted_by=app_private.context_actor())); RETURN v_version;
END $$;
CREATE FUNCTION app_api.confirm_availability(p_id uuid,p_expected bigint,p_availability text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ DECLARE v_listing app_private.listings; v_version bigint; BEGIN
  PERFORM app_private.require_version(p_expected);
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); v_listing:=app_private.lock_listing(p_id,p_expected);
  UPDATE app_private.listings SET availability=p_availability,last_availability_confirmed_at=now(),
    publication_status=CASE WHEN p_availability<>'available' AND publication_status='published' THEN 'paused' ELSE publication_status END
    WHERE tenant_id=v_listing.tenant_id AND id=p_id RETURNING version INTO v_version;
  PERFORM app_private.audit('listing.availability_confirmed','listing',p_id,v_version,jsonb_build_object('availability',p_availability)); RETURN v_version;
END $$;
CREATE FUNCTION app_api.set_publication(p_id uuid,p_expected bigint,p_status text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ DECLARE v_listing app_private.listings; v_version bigint; BEGIN
  PERFORM app_private.require_version(p_expected);
  PERFORM app_private.assert_staff(ARRAY['agent','admin']); v_listing:=app_private.lock_listing(p_id,p_expected);
  IF p_status NOT IN ('paused','published','archived') OR (app_private.staff_role()<>'admin' AND p_status<>'paused')
    THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_status='published' AND (v_listing.published_revision_no IS NULL OR v_listing.availability<>'available' OR
    v_listing.last_availability_confirmed_at IS NULL OR v_listing.last_availability_confirmed_at<=now()-interval '30 days')
    THEN RAISE EXCEPTION 'Valid approved publication required' USING ERRCODE='23514'; END IF;
  IF app_private.staff_role()='agent' AND v_listing.publication_status='archived' THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  UPDATE app_private.listings SET publication_status=p_status,archived_at=CASE WHEN p_status='archived' THEN now() END
    WHERE tenant_id=v_listing.tenant_id AND id=p_id RETURNING version INTO v_version;
  PERFORM app_private.audit('listing.publication_changed','listing',p_id,v_version,jsonb_build_object('status',p_status)); RETURN v_version;
END $$;
CREATE FUNCTION app_api.reassign_listing(p_id uuid,p_expected bigint,p_assigned uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ DECLARE v_listing app_private.listings; v_version bigint; BEGIN
  PERFORM app_private.require_version(p_expected);
  PERFORM app_private.assert_staff(ARRAY['admin']); v_listing:=app_private.lock_listing(p_id,p_expected);
  IF NOT EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=v_listing.tenant_id AND user_id=p_assigned AND active AND role IN ('agent','admin'))
    THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='P0002'; END IF;
  UPDATE app_private.listings SET assigned_agent_id=p_assigned WHERE tenant_id=v_listing.tenant_id AND id=p_id RETURNING version INTO v_version;
  PERFORM app_private.audit('listing.reassigned','listing',p_id,v_version); RETURN v_version;
END $$;
CREATE FUNCTION app_api.record_enquiry(p_id uuid,p_key uuid,p_listing uuid,p_name text,p_phone text,p_email text,p_message text,p_origin text,p_notice text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_revision integer; v_existing app_private.enquiries; BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_private.tenants WHERE id=app_private.context_tenant() AND enabled)
    OR (app_private.context_actor() IS NOT NULL AND app_private.staff_role() IS NULL) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  -- Serialise equivalent retries before checking the unique key, without storing contact data in lock keys.
  PERFORM pg_advisory_xact_lock(hashtextextended(app_private.context_tenant()::text||p_key::text,0));
  SELECT * INTO v_existing FROM app_private.enquiries WHERE tenant_id=app_private.context_tenant() AND idempotency_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF ROW(v_existing.listing_id,v_existing.contact_name,v_existing.phone_e164,v_existing.email,v_existing.message,v_existing.origin,v_existing.notice_version,v_existing.requested_by_id)
      IS DISTINCT FROM ROW(p_listing,btrim(p_name),nullif(btrim(p_phone),''),nullif(btrim(p_email),''),btrim(p_message),p_origin,p_notice,app_private.context_actor())
      THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505'; END IF;
    RETURN v_existing.id;
  END IF;
  IF p_listing IS NOT NULL THEN
    SELECT revision_no INTO v_revision FROM app_api.public_listings WHERE listing_id=p_listing;
    IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,listing_id,contacted_revision_no,requested_by_id,
    contact_name,phone_e164,email,message,origin,notice_version)
    VALUES(app_private.context_tenant(),p_id,p_key,p_listing,v_revision,app_private.context_actor(),btrim(p_name),nullif(btrim(p_phone),''),nullif(btrim(p_email),''),btrim(p_message),p_origin,p_notice);
  PERFORM app_private.audit('enquiry.received','enquiry',p_id,1); RETURN p_id;
END $$;
CREATE FUNCTION app_api.assign_enquiry(p_id uuid,p_expected bigint,p_assigned uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ DECLARE v_version bigint; BEGIN
  PERFORM app_private.assert_staff(ARRAY['admin']);
  PERFORM app_private.require_version(p_expected);
  IF NOT EXISTS(SELECT 1 FROM app_private.memberships WHERE tenant_id=app_private.context_tenant() AND user_id=p_assigned AND active AND role IN ('agent','admin'))
    THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='P0002'; END IF;
  UPDATE app_private.enquiries SET assigned_agent_id=p_assigned,status=CASE WHEN status='new' THEN 'assigned' ELSE status END
    WHERE tenant_id=app_private.context_tenant() AND id=p_id AND version=p_expected RETURNING version INTO v_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource or version unavailable' USING ERRCODE='40001'; END IF;
  PERFORM app_private.audit('enquiry.assigned','enquiry',p_id,v_version); RETURN v_version;
END $$;
CREATE FUNCTION app_api.transition_enquiry(p_id uuid,p_expected bigint,p_status text,p_next timestamptz DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ DECLARE v_enquiry app_private.enquiries; v_version bigint; BEGIN
  PERFORM app_private.assert_staff(ARRAY['agent','admin']);
  PERFORM app_private.require_version(p_expected);
  SELECT * INTO v_enquiry FROM app_private.enquiries WHERE tenant_id=app_private.context_tenant() AND id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.may_work(v_enquiry.tenant_id,v_enquiry.assigned_agent_id) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='P0002'; END IF;
  IF v_enquiry.version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF NOT ((v_enquiry.status='assigned' AND p_status='contacted') OR (v_enquiry.status='contacted' AND p_status='qualified')
    OR (v_enquiry.status IN ('new','assigned','contacted','qualified') AND p_status IN ('closed_lost','spam'))
    OR (v_enquiry.status='qualified' AND p_status='closed_won')
    OR (v_enquiry.status IN ('closed_won','closed_lost','spam') AND p_status=CASE WHEN v_enquiry.assigned_agent_id IS NULL THEN 'new' ELSE 'assigned' END AND coalesce(length(btrim(p_reason)),0)>0))
    THEN RAISE EXCEPTION 'Invalid enquiry transition' USING ERRCODE='23514'; END IF;
  UPDATE app_private.enquiries SET status=p_status,next_action_at=p_next,closure_reason=nullif(btrim(p_reason),'')
    WHERE tenant_id=v_enquiry.tenant_id AND id=p_id RETURNING version INTO v_version;
  PERFORM app_private.audit('enquiry.transitioned','enquiry',p_id,v_version,jsonb_build_object('from',v_enquiry.status,'to',p_status)); RETURN v_version;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_api TO api_runtime;
RESET ROLE;
COMMIT;

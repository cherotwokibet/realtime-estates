import assert from 'node:assert/strict';
import test from 'node:test';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const content = {
  title: 'Synthetic private preview apartment',
  description: 'SQL-only authorization and relational provenance; no image bytes exist.',
  purpose: 'rent',
  propertyType: 'apartment',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 2,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic Nairobi',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
};
const manifest = (n) => ({
  pipeline: 'synthetic-codec-v1',
  sourceFormat: 'png',
  inputSha256: hash(`input/${n}`),
  inputBytes: 100,
  format: 'webp',
  mimeType: 'image/webp',
  sha256: hash(`output/${n}`),
  width: 800,
  height: 600,
  bytes: 1000,
  encoder: { sharp: '0.35.5', vips: '8.18.7' },
  operations: [
    'auto-orient',
    'resize-inside-1920-without-enlargement',
    'strip-metadata',
    'webp-quality-82-effort-4',
  ],
});
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
const denied = (operation, code = 'P0002') =>
  assert.rejects(operation, (error) => error.code === code);
async function snapshot(db) {
  const result = {};
  for (const table of [
    'tenants',
    'memberships',
    'listings',
    'listing_revisions',
    'revision_media',
    'media_operations',
    'media_jobs',
    'media_input_captures',
    'media_processing_leases',
    'media_verified_outputs',
    'media_attach_intents',
    'media_attach_results',
    'media_attachments',
    'audit_events',
    'public_snapshots',
  ])
    result[table] = (
      await db.query(
        `SELECT to_jsonb(x) AS value FROM app_private.${table} x ORDER BY to_jsonb(x)::text`,
      )
    ).rows;
  return result;
}
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  const bootstrap = '"' + (await scalar(db, 'SELECT session_user')).replaceAll('"', '""') + '"';
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES
    ($1,'private-preview-a','Synthetic A'),($2,'private-preview-b','Synthetic B')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [T, CUSTOMER, 'customer'],
    [OTHER, OTHERADMIN, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  await db.exec(`CREATE ROLE synthetic_media_preview_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    GRANT api_runtime TO synthetic_media_preview_api;
    CREATE ROLE synthetic_media_preview_coordinator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    GRANT media_coordinator TO synthetic_media_preview_coordinator;`);
  async function transaction(login, role, actor, operation, tenant = T) {
    await db.exec(`SET SESSION AUTHORIZATION ${login};BEGIN;SET LOCAL ROLE ${role};`);
    try {
      await db.query(
        `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
        set_config('realtor.correlation_id','synthetic-private-preview',true)`,
        [tenant ?? '', actor ?? ''],
      );
      const result = await operation();
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    } finally {
      await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
    }
  }
  const api = (actor, operation, tenant = T) =>
    transaction('synthetic_media_preview_api', 'api_runtime', actor, operation, tenant);
  // Wrong context deliberately cannot choose the coordinator's original job.
  const coordinator = (operation) =>
    transaction(
      'synthetic_media_preview_coordinator',
      'media_coordinator',
      OTHERADMIN,
      operation,
      OTHER,
    );
  async function listing(n, { actor = AGENT, tenant = T } = {}) {
    const x = { listing: id(n), actor, tenant, revision: 1, version: '2' };
    await api(
      actor,
      async () => {
        await seedGuardedListingDraft(db, {
          listingId: x.listing,
          slug: `synthetic-private-preview-${n}`,
          content: {
            ...content,
            pricing: { declaration: 'not_declared', charges: [] },
            location: { county: null, town: null, area: null },
          },
          actorId: actor,
        });
      },
      tenant,
    );
    return x;
  }
  async function attached(n, options = {}) {
    const x = await listing(n, options),
      value = manifest(n),
      operation = id(n + 4000),
      generation = id(n + 3000),
      claim = id(n + 2000);
    const registration = await api(
      x.actor,
      () =>
        scalar(db, 'SELECT app_api.register_media_upload($1,1,2,$2,$3)', [
          x.listing,
          id(n + 1000),
          'Synthetic SQL-only saved photo',
        ]),
      x.tenant,
    );
    const capture = await coordinator(() =>
      scalar(db, 'SELECT app_media.capture_input($1,$2,$3,$4)', [
        registration.jobId,
        generation,
        value.inputBytes,
        value.inputSha256,
      ]),
    );
    const lease = await coordinator(() =>
      scalar(db, 'SELECT app_media.claim_processing($1,$2)', [registration.jobId, claim]),
    );
    const verified = await coordinator(() =>
      scalar(db, 'SELECT app_media.seal_output($1,$2,$3,$4::jsonb)', [
        registration.jobId,
        lease.attempt,
        lease.leaseNonce,
        JSON.stringify(value),
      ]),
    );
    await api(
      x.actor,
      () =>
        scalar(db, 'SELECT app_api.create_media_attach_intent($1,1,2,$2,$3)', [
          x.listing,
          operation,
          registration.jobId,
        ]),
      x.tenant,
    );
    const finalized = await coordinator(() =>
      scalar(db, 'SELECT app_media.finalize_media($1)', [operation]),
    );
    assert.equal(finalized.status, 'applied');
    const result = finalized.receipt;
    assert.equal(result.outcome, 'applied');
    assert.equal(result.version, '3');
    return {
      ...x,
      version: result.version,
      media: result.mediaId,
      operation,
      job: registration.jobId,
      capture,
      lease,
      verified,
      registration,
    };
  }
  const preview = (
    x,
    {
      actor = x.actor,
      tenant = x.tenant,
      listing = x.listing,
      revision = x.revision,
      media = x.media,
      version = x.version,
    } = {},
  ) =>
    api(
      actor,
      () =>
        scalar(
          db,
          'SELECT app_api.read_private_media_preview($1::uuid,$2::integer,$3::uuid,$4::bigint)',
          [listing, revision, media, version],
        ),
      tenant,
    );
  return { db, api, coordinator, listing, attached, preview };
}

// Relational synthetic provenance only: no native image bytes or network delivery.
async function pending(f, n) {
  const x = await f.attached(n);
  for (let position = 1; position < 4; position++)
    await seedSyntheticSealedMedia(f.db, {
      tenantId: T,
      listingId: x.listing,
      revision: 1,
      position,
    });
  x.version = String(
    await f.api(AGENT, () =>
      scalar(f.db, 'SELECT app_api.submit_revision($1,1,$2)', [x.listing, x.version]),
    ),
  );
  return x;
}
const review = (f, x, actor = ADMIN, version = x.version, tenant = T) =>
  f.api(
    actor,
    () =>
      scalar(f.db, 'SELECT app_api.read_review_media_preview($1,1,$2,$3)', [
        x.listing,
        x.media,
        version,
      ]),
    tenant,
  );

const gallery = (f, x, actor = ADMIN, version = x.version, tenant = T) =>
  f.api(
    actor,
    () => scalar(f.db, 'SELECT app_api.read_review_media_gallery($1,1,$2)', [x.listing, version]),
    tenant,
  );

test('review gallery projects only ordered current pending sealed media identities without mutation', async () => {
  const f = await fixture();
  try {
    const x = await pending(f, 940),
      before = await snapshot(f.db),
      g = await gallery(f, x);
    assert.deepEqual(Object.keys(g).sort(), [
      'kind',
      'listingId',
      'photos',
      'revision',
      'state',
      'version',
    ]);
    assert.equal(g.kind, 'review_media_gallery');
    assert.equal(g.listingId, x.listing);
    assert.equal(g.revision, 1);
    assert.equal(g.version, x.version);
    assert.equal(g.state, 'pending');
    assert.equal(g.photos.length, 4);
    assert.equal(g.photos[0].id, x.media);
    for (const [position, photo] of g.photos.entries()) {
      assert.deepEqual(Object.keys(photo).sort(), ['alt', 'id', 'position']);
      assert.equal(photo.position, position);
      assert.match(photo.id, /^[a-f0-9-]{36}$/);
      assert.equal(typeof photo.alt, 'string');
    }
    assert.equal(new Set(g.photos.map((p) => p.id)).size, 4);
    assert.deepEqual(await snapshot(f.db), before);
    await denied(() => gallery(f, x, AGENT));
    await denied(() => gallery(f, x, CUSTOMER));
    await denied(() => gallery(f, x, OTHERADMIN, x.version, OTHER));
    await denied(() => gallery(f, x, ADMIN, '2'), '40001');
    await denied(() => gallery(f, x, AGENT, '2'));
    await f.api(ADMIN, () =>
      scalar(f.db, "SELECT app_api.decide_revision($1,1,$2,false,'Synthetic changes')", [
        x.listing,
        x.version,
      ]),
    );
    await denied(() => gallery(f, x));
  } finally {
    await f.db.close();
  }
});

test('one unsealed historical association denies the entire gallery before stale currency', async () => {
  const f = await fixture();
  try {
    const x = await f.attached(950);
    for (let position = 1; position < 3; position++)
      await seedSyntheticSealedMedia(f.db, {
        tenantId: T,
        listingId: x.listing,
        revision: 1,
        position,
      });
    await f.db.query(
      "INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted) VALUES($1,$2,1,$3,'legacy-gallery/3.webp','image/webp',100,100,100,$4,'Historical unsealed reference',3,true)",
      [T, x.listing, id(95003), hash('legacy')],
    );
    await denied(
      () =>
        f.api(AGENT, () =>
          scalar(f.db, 'SELECT app_api.submit_revision($1,1,$2)', [x.listing, x.version]),
        ),
      '23514',
    );
    // Historical inconsistent pending row, inserted by the fixture owner only.
    // Normal submission refuses it; no immutability trigger is disabled.
    x.version = String(
      await scalar(
        f.db,
        "UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$1 WHERE tenant_id=$2 AND listing_id=$3 AND revision_no=1 RETURNING version",
        [AGENT, T, x.listing],
      ),
    );
    const before = await snapshot(f.db);
    await denied(() => gallery(f, x));
    await denied(() => gallery(f, x, ADMIN, '2'));
    assert.deepEqual(await snapshot(f.db), before);
  } finally {
    await f.db.close();
  }
});

test('review gallery checks present authority and isolated privilege on every read', async () => {
  const f = await fixture();
  try {
    const x = await pending(f, 960),
      g = await gallery(f, x);
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, AGENT],
    );
    assert.deepEqual(await gallery(f, x), g);
    await f.db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await denied(() => gallery(f, x));
    await f.db.query(
      "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    const flags = (
      await f.db.query(
        "SELECT pg_get_userbyid(proowner) owner,prosecdef,proconfig FROM pg_proc WHERE oid='app_api.read_review_media_gallery(uuid,integer,bigint)'::regprocedure",
      )
    ).rows[0];
    assert.deepEqual(flags, {
      owner: 'realtor_owner',
      prosecdef: true,
      proconfig: ['search_path=pg_catalog'],
    });
    await denied(
      () =>
        f.coordinator(() =>
          scalar(f.db, 'SELECT app_api.read_review_media_gallery($1,1,$2)', [x.listing, x.version]),
        ),
      '42501',
    );
    await denied(() => gallery(f, x, ADMIN, '0'), '23514');
    await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await denied(() => gallery(f, x));
  } finally {
    await f.db.close();
  }
});
test('review image policy requires current admin and exact pending version without mutation or draft-authority reuse', async () => {
  const f = await fixture();
  try {
    const draft = await f.attached(900);
    await denied(() => review(f, draft));
    const x = await pending(f, 901),
      before = await snapshot(f.db),
      r = await review(f, x);
    assert.equal(r.kind, 'review_media_preview');
    assert.equal(r.state, 'pending');
    assert.equal(r.actorRole, 'admin');
    assert.equal(r.version, x.version);
    assert.equal(r.mediaId, x.media);
    assert.deepEqual(r.verified, x.verified);
    await denied(() => review(f, x, AGENT));
    await denied(() => review(f, x, PEER));
    await denied(() => review(f, x, CUSTOMER));
    await denied(() => review(f, x, OTHERADMIN, x.version, OTHER));
    await denied(() => review(f, x, ADMIN, '2'), '40001');
    await denied(() => review(f, x, AGENT, '2'));
    await denied(() => f.preview(x, { actor: ADMIN }));
    assert.deepEqual(await review(f, x), r);
    assert.deepEqual(await snapshot(f.db), before);
    await f.api(ADMIN, () =>
      scalar(f.db, "SELECT app_api.decide_revision($1,1,$2,false,'Synthetic changes required')", [
        x.listing,
        x.version,
      ]),
    );
    await denied(() => review(f, x));
    await denied(() => review(f, x, ADMIN, '2'));
  } finally {
    await f.db.close();
  }
});
test('reviewer access loss denies bytes context while uploader revocation does not erase current-admin inspection', async () => {
  const f = await fixture();
  try {
    const x = await pending(f, 910),
      r = await review(f, x);
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, AGENT],
    );
    assert.deepEqual(await review(f, x), r);
    await f.db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await denied(() => review(f, x));
    await f.db.query(
      "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    assert.deepEqual(await review(f, x), r);
    await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await denied(() => review(f, x));
  } finally {
    await f.db.close();
  }
});
test('review provenance function has isolated execute privilege and rejects malformed context before reads', async () => {
  const f = await fixture();
  try {
    const x = await pending(f, 920),
      before = await snapshot(f.db);
    for (const args of [
      [null, 1, x.media, x.version],
      [x.listing, 0, x.media, x.version],
      [x.listing, 1, null, x.version],
      [x.listing, 1, x.media, '0'],
    ])
      await denied(
        () =>
          f.api(ADMIN, () =>
            scalar(f.db, 'SELECT app_api.read_review_media_preview($1,$2,$3,$4)', args),
          ),
        '23514',
      );
    const flags = (
      await f.db.query(
        "SELECT pg_get_userbyid(proowner) owner,prosecdef,proconfig FROM pg_proc WHERE oid='app_api.read_review_media_preview(uuid,integer,uuid,bigint)'::regprocedure",
      )
    ).rows[0];
    assert.equal(flags.owner, 'realtor_owner');
    assert.equal(flags.prosecdef, true);
    assert.deepEqual(flags.proconfig, ['search_path=pg_catalog']);
    await denied(
      () =>
        f.coordinator(() =>
          scalar(f.db, 'SELECT app_api.read_review_media_preview($1,1,$2,$3)', [
            x.listing,
            x.media,
            x.version,
          ]),
        ),
      '42501',
    );
    assert.deepEqual(await snapshot(f.db), before);
  } finally {
    await f.db.close();
  }
});
test('pending accepted legacy references cannot authorize reviewer image context', async () => {
  const f = await fixture();
  try {
    const x = await f.listing(930);
    for (let position = 0; position < 4; position++)
      await f.db.query(
        "INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted) VALUES($1,$2,1,$3,$4,'image/webp',100,100,100,$5,'Legacy metadata only',$6,true)",
        [
          T,
          x.listing,
          id(9300 + position),
          `legacy-review/${position}.webp`,
          hash(position),
          position,
        ],
      );
    await denied(
      () => f.api(AGENT, () => scalar(f.db, 'SELECT app_api.submit_revision($1,1,2)', [x.listing])),
      '23514',
    );
    // Privileged historical synthetic row only; normal submission rejects these
    // references. No trigger is disabled and this is not native-byte evidence.
    x.version = String(
      await scalar(
        f.db,
        "UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$1 WHERE tenant_id=$2 AND listing_id=$3 AND revision_no=1 RETURNING version",
        [AGENT, T, x.listing],
      ),
    );
    x.media = id(9300);
    const before = await snapshot(f.db);
    await denied(() => review(f, x));
    await denied(() => review(f, x, ADMIN, '1'));
    assert.deepEqual(await snapshot(f.db), before);
  } finally {
    await f.db.close();
  }
});

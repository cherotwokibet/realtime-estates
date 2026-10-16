import assert from 'node:assert/strict';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const LISTING = id(100),
  SECOND = id(101),
  OTHERLISTING = id(200),
  ENQUIRY = id(300);
const content = {
  title: 'Synthetic Langata apartment',
  description: 'Synthetic replacement test content only.',
  purpose: 'rent',
  propertyType: 'apartment',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 8,
  privateBathrooms: 2,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Langata',
  publicPrecision: 'area',
  latitude: -1.366,
  longitude: 36.75,
  privateAddress: 'PRIVATE TEST ADDRESS',
};
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES ($1,'realtime-test','Synthetic Realtime'),($2,'other-test','Synthetic Other')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [T, CUSTOMER, 'customer'],
    [OTHER, OTHERADMIN, 'admin'],
  ]) {
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  }
  return db;
}
async function asActor(db, tenant, actor, callback) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  await db.query(
    `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-db-test',true)`,
    [tenant ?? '', actor ?? ''],
  );
  try {
    const result = await callback(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function scalar(db, sql, args = []) {
  const result = await db.query(sql, args);
  return Object.values(result.rows[0])[0];
}
async function createDraft(db, listing = LISTING, actor = AGENT) {
  return asActor(db, T, actor, async () => {
    await db.query('SELECT app_api.create_listing($1,$2)', [
      listing,
      `synthetic-${listing.slice(-3)}`,
    ]);
    return scalar(db, 'SELECT app_api.save_draft($1,1,0,$2::jsonb)', [
      listing,
      JSON.stringify(content),
    ]);
  });
}
async function seedMedia(db, listing = LISTING, revision = 1, count = 4) {
  for (let position = 0; position < count; position++) {
    await seedSyntheticSealedMedia(db, {
      tenantId: T,
      listingId: listing,
      revision,
      position,
      mediaId: id(Number(listing.slice(-3)) * 100 + revision * 10 + position),
    });
  }
}
async function publish(db) {
  const version = await createDraft(db);
  await seedMedia(db);
  const pending = await asActor(db, T, AGENT, async () => {
    await db.query(`SELECT app_api.confirm_availability($1,1,'available')`, [LISTING]);
    return scalar(db, 'SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]);
  });
  await asActor(db, T, ADMIN, () =>
    db.query('SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, pending]),
  );
}
const denied = (fn, code = '42501') => assert.rejects(fn, (error) => error.code === code);

test('migration forces RLS and API role has neither owner membership nor direct writes', async () => {
  const db = await fixture();
  try {
    const tables = await db.query(
      `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app_private' AND relkind='r'`,
    );
    assert.deepEqual(tables.rows.map((row) => row.relname).sort(), [
      'audit_events',
      'enquiries',
      'enquiry_contacts',
      'enquiry_operations',
      'listing_creation_requests',
      'listing_creation_results',
      'listing_revisions',
      'listings',
      'media_attach_intents',
      'media_attach_results',
      'media_attachments',
      'media_input_captures',
      'media_jobs',
      'media_operations',
      'media_processing_leases',
      'media_verified_outputs',
      'memberships',
      'public_snapshots',
      'revision_media',
      'tenants',
      'viewing_operations',
      'viewing_reminder_admissions',
      'viewing_reminder_attempts',
      'viewings',
    ]);
    assert.ok(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
    const flags = await db.query(
      `SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='api_runtime'`,
    );
    assert.deepEqual(flags.rows[0], { rolsuper: false, rolbypassrls: false, rolinherit: false });
    assert.equal(
      await scalar(db, `SELECT pg_has_role('api_runtime','realtor_owner','MEMBER')`),
      false,
    );
    await denied(() =>
      asActor(db, T, ADMIN, () =>
        db.query(
          `INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id) VALUES($1,$2,'forged',$3,$3)`,
          [T, LISTING, ADMIN],
        ),
      ),
    );
    await denied(() =>
      asActor(db, T, ADMIN, () =>
        db.query(`UPDATE app_private.memberships SET role='admin' WHERE user_id=$1`, [CUSTOMER]),
      ),
    );
    await denied(() =>
      asActor(db, T, ADMIN, () =>
        db.query(`SELECT app_private.audit('forged','listing',$1,1)`, [LISTING]),
      ),
    );
  } finally {
    await db.close();
  }
});
test('missing context and customer cannot create; agents cannot choose another assignee', async () => {
  const db = await fixture();
  try {
    for (const [tenant, actor] of [
      [null, null],
      [T, null],
      [T, CUSTOMER],
      [OTHER, AGENT],
    ])
      await denied(() =>
        asActor(db, tenant, actor, () =>
          db.query(`SELECT app_api.create_listing($1,'forged')`, [LISTING]),
        ),
      );
    await denied(() =>
      asActor(db, T, AGENT, () =>
        db.query(`SELECT app_api.create_listing($1,'forged',$2)`, [LISTING, PEER]),
      ),
    );
    await createDraft(db);
    await denied(() =>
      asActor(db, T, CUSTOMER, () =>
        db.query(`SELECT app_api.save_draft($1,1,2,$2::jsonb)`, [LISTING, JSON.stringify(content)]),
      ),
    );
  } finally {
    await db.close();
  }
});
test('runtime private reads, edits, and reassignments respect company and assignment', async () => {
  const db = await fixture();
  try {
    await createDraft(db);
    await createDraft(db, SECOND, PEER);
    await asActor(db, OTHER, OTHERADMIN, () =>
      db.query(`SELECT app_api.create_listing($1,'other-stock')`, [OTHERLISTING]),
    );
    assert.equal(
      await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.listings'),
      ),
      1,
    );
    assert.equal(
      await asActor(db, T, ADMIN, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.listings'),
      ),
      2,
    );
    assert.equal(
      await asActor(db, T, CUSTOMER, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.listing_revisions'),
      ),
      0,
    );
    await denied(
      () =>
        asActor(db, T, PEER, () =>
          db.query(`SELECT app_api.save_draft($1,1,2,$2::jsonb)`, [
            LISTING,
            JSON.stringify(content),
          ]),
        ),
      'P0002',
    );
    await denied(
      () =>
        asActor(db, OTHER, OTHERADMIN, () =>
          db.query(`SELECT app_api.save_draft($1,1,2,$2::jsonb)`, [
            LISTING,
            JSON.stringify(content),
          ]),
        ),
      'P0002',
    );
    await denied(() =>
      asActor(db, T, AGENT, () =>
        db.query('SELECT app_api.reassign_listing($1,1,$2)', [LISTING, PEER]),
      ),
    );
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.reassign_listing($1,1,$2)', [LISTING, PEER]),
    );
    assert.equal(
      await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.listings'),
      ),
      0,
    );
    assert.equal(
      await asActor(db, T, PEER, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.listings'),
      ),
      2,
    );
    const creator = await scalar(db, 'SELECT created_by_id FROM app_private.listings WHERE id=$1', [
      LISTING,
    ]);
    assert.equal(creator, AGENT);
  } finally {
    await db.close();
  }
});
test('revoked membership and disabled tenant fail the next protected request', async () => {
  const db = await fixture();
  try {
    await createDraft(db);
    await db.query(
      `UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2`,
      [T, AGENT],
    );
    assert.equal(
      await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.listings'),
      ),
      0,
    );
    await denied(() =>
      asActor(db, T, AGENT, () =>
        db.query(`SELECT app_api.confirm_availability($1,1,'available')`, [LISTING]),
      ),
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await denied(() =>
      asActor(db, T, ADMIN, () =>
        db.query(`SELECT app_api.create_listing($1,'disabled')`, [SECOND]),
      ),
    );
  } finally {
    await db.close();
  }
});
test('composite foreign keys reject cross-company listing and revision relationships', async () => {
  const db = await fixture();
  try {
    await denied(
      () =>
        db.query(
          `INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id) VALUES($1,$2,'wrong-company',$3,$4)`,
          [T, LISTING, ADMIN, OTHERADMIN],
        ),
      '23503',
    );
    await createDraft(db);
    await denied(
      () =>
        db.query(
          `INSERT INTO app_private.listing_revisions(tenant_id,listing_id,revision_no) VALUES($1,$2,1)`,
          [OTHER, LISTING],
        ),
      '23503',
    );
  } finally {
    await db.close();
  }
});
test('money, periods, canonical types, rooms and unknown privileged fields fail closed', async () => {
  const db = await fixture();
  try {
    await createDraft(db);
    const bad = [
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.5 },
      { amountMinor: 100000000000001 },
      { currency: 'USD' },
      { purpose: 'sale', rentPeriod: 'month' },
      { rentPeriod: 'fortnight' },
      { propertyType: 'unknown' },
      { propertyType: 'land', bedrooms: 0 },
      { propertyType: 'studio', bedrooms: 1 },
      { bedrooms: 101 },
      { assignedAgentId: PEER },
      { title: { unexpected: 'object' } },
      { amountMinor: '2000000' },
      { bedrooms: '8' },
    ];
    for (const values of bad)
      await assert.rejects(() =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.save_draft($1,1,2,$2::jsonb)', [
            LISTING,
            JSON.stringify({ ...content, ...values }),
          ]),
        ),
      );
    assert.equal(
      await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT bedrooms FROM app_private.listing_revisions'),
      ),
      8,
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.save_draft($1,1,1,$2::jsonb)', [
            LISTING,
            JSON.stringify(content),
          ]),
        ),
      '40001',
    );
  } finally {
    await db.close();
  }
});
test('omitted concurrency versions cannot bypass protected updates', async () => {
  const db = await fixture();
  try {
    await createDraft(db);
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.save_draft($1,1,NULL,$2::jsonb)', [
            LISTING,
            JSON.stringify(content),
          ]),
        ),
      '40001',
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query(`SELECT app_api.confirm_availability($1,NULL,'available')`, [LISTING]),
        ),
      '40001',
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query(`SELECT app_api.set_publication($1,NULL,'archived')`, [LISTING]),
        ),
      '40001',
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query(`SELECT app_api.reassign_listing($1,NULL,$2)`, [LISTING, PEER]),
        ),
      '40001',
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.submit_revision($1,1,NULL)', [LISTING]),
        ),
      '40001',
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT app_api.decide_revision($1,1,NULL,true)', [LISTING]),
        ),
      '40001',
    );
  } finally {
    await db.close();
  }
});
test('accepted photos cannot make an incomplete draft publishable', async () => {
  const db = await fixture();
  try {
    await asActor(db, T, AGENT, async () => {
      await db.query(`SELECT app_api.create_listing($1,'incomplete')`, [LISTING]);
      await db.query(`SELECT app_api.save_draft($1,1,0,'{}'::jsonb)`, [LISTING]);
    });
    await seedMedia(db);
    await denied(
      () =>
        asActor(db, T, AGENT, () => db.query(`SELECT app_api.submit_revision($1,1,2)`, [LISTING])),
      '23514',
    );
    assert.equal(await scalar(db, 'SELECT state FROM app_private.listing_revisions'), 'draft');
  } finally {
    await db.close();
  }
});
test('legacy accepted metadata remains unverified and cannot submit a complete draft', async () => {
  const db = await fixture();
  try {
    const version = await createDraft(db);
    for (let position = 0; position < 4; position++)
      await db.query(
        `INSERT INTO app_private.revision_media
      (tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted)
      VALUES($1,$2,1,$3,$4,'image/webp',100,100,100,$5,'Legacy metadata; no sealed provenance',$6,true)`,
        [
          T,
          LISTING,
          id(25000 + position),
          `legacy/${position}.webp`,
          String(position + 1).repeat(64),
          position,
        ],
      );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]),
        ),
      '23514',
    );
    assert.deepEqual(
      (
        await db.query(
          `SELECT state,version::text FROM app_private.listing_revisions WHERE listing_id=$1`,
          [LISTING],
        )
      ).rows,
      [{ state: 'draft', version: String(version) }],
    );
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::integer FROM app_private.revision_media WHERE sealed_job_id IS NOT NULL',
      ),
      0,
    );
    assert.equal(
      await asActor(db, T, null, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_api.public_listings'),
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
test('submission requires accepted photos and complete content; agent cannot approve', async () => {
  const db = await fixture();
  try {
    const version = await createDraft(db);
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]),
        ),
      '23514',
    );
    await seedMedia(db, LISTING, 1, 3);
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]),
        ),
      '23514',
    );
    await seedSyntheticSealedMedia(db, {
      tenantId: T,
      listingId: LISTING,
      mediaId: id(19999),
      position: 3,
    });
    const pending = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]),
    );
    await denied(() =>
      asActor(db, T, AGENT, () =>
        db.query('SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, pending]),
      ),
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, pending]),
        ),
      '23514',
    );
    await denied(
      () =>
        db.query(
          `UPDATE app_private.listing_revisions SET title='Tampered pending' WHERE listing_id=$1`,
          [LISTING],
        ),
      '23514',
    );
    await denied(
      () =>
        db.query(`UPDATE app_private.revision_media SET alt_text='Tampered' WHERE listing_id=$1`, [
          LISTING,
        ]),
      '23514',
    );
    assert.equal(
      await asActor(db, T, null, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_api.public_listings'),
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
test('approved snapshot excludes private address and precise area coordinates', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const publicRows = await asActor(db, T, null, () =>
      db.query('SELECT * FROM app_api.public_listings'),
    );
    assert.equal(publicRows.rows.length, 1);
    const row = publicRows.rows[0];
    assert.equal(row.latitude, null);
    assert.equal(row.longitude, null);
    assert.equal('private_address' in row, false);
    assert.equal('decision_reason' in row, false);
    assert.equal('assigned_agent_id' in row, false);
    assert.equal(row.photo_refs.length, 4);
    assert.equal(
      await asActor(db, OTHER, null, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_api.public_listings'),
      ),
      0,
    );
    await denied(() =>
      asActor(db, T, ADMIN, () => db.query('SELECT * FROM app_private.public_snapshots')),
    );
    await denied(
      () =>
        db.query(
          `UPDATE app_private.listing_revisions SET title='Tampered approved' WHERE listing_id=$1`,
          [LISTING],
        ),
      '23514',
    );
  } finally {
    await db.close();
  }
});
test('draft editing and rejection preserve published revision; stale review conflicts', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const version = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.save_draft($1,2,0,$2::jsonb)', [
        LISTING,
        JSON.stringify({ ...content, title: 'New unapproved title' }),
      ]),
    );
    await seedMedia(db, LISTING, 2);
    const pending = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.submit_revision($1,2,$2)', [LISTING, version]),
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query("SELECT app_api.decide_revision($1,2,$2,false,'Fix title')", [
            LISTING,
            pending - 1,
          ]),
        ),
      '40001',
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query("SELECT app_api.decide_revision($1,2,$2,false,'   ')", [LISTING, pending]),
        ),
      '23514',
    );
    await asActor(db, T, ADMIN, () =>
      db.query("SELECT app_api.decide_revision($1,2,$2,false,'Fix title')", [LISTING, pending]),
    );
    assert.equal(
      await asActor(db, T, null, () => scalar(db, 'SELECT title FROM app_api.public_listings')),
      content.title,
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query('SELECT app_api.save_draft($1,2,$2,$3::jsonb)', [
            LISTING,
            pending + 1,
            JSON.stringify(content),
          ]),
        ),
      '23514',
    );
    const audit = await asActor(db, T, ADMIN, () =>
      db.query(
        `SELECT action,summary FROM app_private.audit_events WHERE action='revision.approved'`,
      ),
    );
    assert.deepEqual(audit.rows[0].summary, { revision: 1, selfApproval: false });
    await denied(() => db.query(`DELETE FROM app_private.audit_events`), '23514');
  } finally {
    await db.close();
  }
});
test('withdraw and resubmit preserve history; admin self-approval atomically replaces exact snapshot', async () => {
  const db = await fixture();
  try {
    await publish(db);
    let version = await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.save_draft($1,2,0,$2::jsonb)', [
        LISTING,
        JSON.stringify({ ...content, title: 'Approved replacement' }),
      ]),
    );
    await seedMedia(db, LISTING, 2);
    version = await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.submit_revision($1,2,$2)', [LISTING, version]),
    );
    version = await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.withdraw_revision($1,2,$2)', [LISTING, version]),
    );
    version = await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.submit_revision($1,2,$2)', [LISTING, version]),
    );
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.decide_revision($1,2,$2,true)', [LISTING, version]),
    );
    assert.equal(
      await asActor(db, T, null, () => scalar(db, 'SELECT title FROM app_api.public_listings')),
      'Approved replacement',
    );
    assert.equal(
      await asActor(db, T, null, () =>
        scalar(db, 'SELECT revision_no FROM app_api.public_listings'),
      ),
      2,
    );
    assert.equal(
      await scalar(
        db,
        "SELECT count(*)::integer FROM app_private.listing_revisions WHERE state='approved'",
      ),
      2,
    );
    const events = await asActor(db, T, ADMIN, () =>
      db.query(
        `SELECT summary FROM app_private.audit_events WHERE action='revision.approved' ORDER BY id`,
      ),
    );
    assert.equal(events.rows[1].summary.selfApproval, true);
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.save_draft($1,3,0,$2::jsonb)', [LISTING, JSON.stringify(content)]),
    );
    await denied(
      () =>
        db.query(
          'UPDATE app_private.revision_media SET revision_no=3 WHERE listing_id=$1 AND revision_no=2',
          [LISTING],
        ),
      '23514',
    );
    await denied(
      () =>
        db.query(
          'DELETE FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
          [LISTING],
        ),
      '23514',
    );
  } finally {
    await db.close();
  }
});
test('agent can pause/unavailable but only administrator resumes; stale stock excluded', async () => {
  const db = await fixture();
  try {
    await publish(db);
    let version = await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [
      LISTING,
    ]);
    version = await asActor(db, T, AGENT, () =>
      scalar(db, `SELECT app_api.confirm_availability($1,$2,'rented')`, [LISTING, version]),
    );
    assert.equal(
      await asActor(db, T, null, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_api.public_listings'),
      ),
      0,
    );
    version = await asActor(db, T, AGENT, () =>
      scalar(db, `SELECT app_api.confirm_availability($1,$2,'available')`, [LISTING, version]),
    );
    await denied(() =>
      asActor(db, T, AGENT, () =>
        db.query(`SELECT app_api.set_publication($1,$2,'published')`, [LISTING, version]),
      ),
    );
    version = await asActor(db, T, ADMIN, () =>
      scalar(db, `SELECT app_api.set_publication($1,$2,'published')`, [LISTING, version]),
    );
    await db.query(
      `UPDATE app_private.listings SET last_availability_confirmed_at=now()-interval '31 days' WHERE id=$1`,
      [LISTING],
    );
    assert.equal(
      await asActor(db, T, null, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_api.public_listings'),
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

test('approval cannot resurrect a listing paused or archived while its revision was pending', async () => {
  for (const status of ['paused', 'archived']) {
    const db = await fixture();
    try {
      await publish(db);
      const saved = await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT app_api.save_draft($1,2,0,$2::jsonb)', [
          LISTING,
          JSON.stringify({ ...content, title: `Reviewed while ${status}` }),
        ]),
      );
      await seedMedia(db, LISTING, 2);
      const pending = await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT app_api.submit_revision($1,2,$2)', [LISTING, saved]),
      );
      let listingVersion = await scalar(
        db,
        'SELECT version FROM app_private.listings WHERE id=$1',
        [LISTING],
      );
      listingVersion = await asActor(db, T, status === 'paused' ? AGENT : ADMIN, () =>
        scalar(db, 'SELECT app_api.set_publication($1,$2,$3)', [LISTING, listingVersion, status]),
      );
      const archivedAt = await scalar(
        db,
        'SELECT archived_at::text FROM app_private.listings WHERE id=$1',
        [LISTING],
      );

      await asActor(db, T, ADMIN, () =>
        db.query('SELECT app_api.decide_revision($1,2,$2,true)', [LISTING, pending]),
      );
      const result = await db.query(
        'SELECT publication_status,archived_at::text,published_revision_no,version FROM app_private.listings WHERE id=$1',
        [LISTING],
      );
      assert.equal(result.rows[0].publication_status, status);
      assert.equal(result.rows[0].archived_at, archivedAt);
      assert.equal(result.rows[0].published_revision_no, 2);
      assert.equal(
        await asActor(db, T, null, () =>
          scalar(db, 'SELECT count(*)::integer FROM app_api.public_listings'),
        ),
        0,
      );

      listingVersion = result.rows[0].version;
      await denied(() =>
        asActor(db, T, AGENT, () =>
          db.query("SELECT app_api.set_publication($1,$2,'published')", [LISTING, listingVersion]),
        ),
      );
      await asActor(db, T, ADMIN, () =>
        db.query("SELECT app_api.set_publication($1,$2,'published')", [LISTING, listingVersion]),
      );
      assert.equal(
        await asActor(db, T, null, () => scalar(db, 'SELECT title FROM app_api.public_listings')),
        `Reviewed while ${status}`,
      );
      assert.equal(
        await asActor(db, T, null, () =>
          scalar(db, 'SELECT revision_no FROM app_api.public_listings'),
        ),
        2,
      );
      assert.equal(
        await scalar(db, 'SELECT archived_at FROM app_private.listings WHERE id=$1', [LISTING]),
        null,
      );
    } finally {
      await db.close();
    }
  }
});
test('an older pending review cannot overwrite a newer approved snapshot', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const pendingVersions = [];
    for (const revision of [2, 3]) {
      const saved = await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT app_api.save_draft($1,$2,0,$3::jsonb)', [
          LISTING,
          revision,
          JSON.stringify({ ...content, title: `Synthetic revision ${revision}` }),
        ]),
      );
      await seedMedia(db, LISTING, revision);
      pendingVersions.push(
        await asActor(db, T, AGENT, () =>
          scalar(db, 'SELECT app_api.submit_revision($1,$2,$3)', [LISTING, revision, saved]),
        ),
      );
    }
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.decide_revision($1,3,$2,true)', [LISTING, pendingVersions[1]]),
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT app_api.decide_revision($1,2,$2,true)', [LISTING, pendingVersions[0]]),
        ),
      '40001',
    );
    assert.equal(
      await asActor(db, T, null, () =>
        scalar(db, 'SELECT revision_no FROM app_api.public_listings'),
      ),
      3,
    );
  } finally {
    await db.close();
  }
});
test('enquiry receipt is durable/idempotent and never grants guest/customer private reads', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const args = [
      ENQUIRY,
      id(301),
      LISTING,
      'Synthetic customer',
      '+254712345678',
      null,
      'Please request a viewing',
      'web',
      'synthetic-v1',
    ];
    const sql = 'SELECT app_api.record_enquiry($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    const original = await asActor(db, T, null, () => scalar(db, sql, args));
    assert.equal(original, ENQUIRY);
    const replay = await asActor(db, T, null, () => scalar(db, sql, [id(302), ...args.slice(1)]));
    assert.equal(replay, original);
    await denied(
      () =>
        asActor(db, T, null, () =>
          db.query(sql, [...args.slice(0, 6), 'Changed message', ...args.slice(7)]),
        ),
      '23505',
    );
    for (const actor of [null, CUSTOMER, AGENT])
      assert.equal(
        await asActor(db, T, actor, () =>
          scalar(db, 'SELECT count(*)::integer FROM app_private.enquiries'),
        ),
        0,
      );
    assert.equal(
      await scalar(db, 'SELECT contacted_revision_no FROM app_private.enquiries WHERE id=$1', [
        ENQUIRY,
      ]),
      1,
    );
    assert.equal(
      await asActor(db, OTHER, OTHERADMIN, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.enquiries'),
      ),
      0,
    );
    const audit = await asActor(db, T, ADMIN, () =>
      db.query(`SELECT summary FROM app_private.audit_events WHERE action='enquiry.received'`),
    );
    assert.deepEqual(audit.rows[0].summary, {});
  } finally {
    await db.close();
  }
});
test('paused property denies fresh capture while original enquiry replay retains contacted revision', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const args = [
      ENQUIRY,
      id(311),
      LISTING,
      'Synthetic property guest',
      null,
      'property@example.invalid',
      'Fictional property request',
      'web',
      'synthetic-v1',
    ];
    const sql = 'SELECT app_api.record_enquiry($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    assert.equal(await asActor(db, T, null, () => scalar(db, sql, args)), ENQUIRY);
    const version = await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [
      LISTING,
    ]);
    await asActor(db, T, ADMIN, () =>
      db.query("SELECT app_api.set_publication($1,$2,'paused')", [LISTING, version]),
    );
    assert.equal(
      await asActor(db, T, null, () => scalar(db, sql, [id(312), ...args.slice(1)])),
      ENQUIRY,
    );
    await assert.rejects(() =>
      asActor(db, T, null, () => db.query(sql, [id(313), id(314), ...args.slice(2)])),
    );
    assert.equal(
      await asActor(db, T, ADMIN, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.enquiries'),
      ),
      1,
    );
    assert.equal(
      await asActor(db, T, ADMIN, () =>
        scalar(db, 'SELECT contacted_revision_no FROM app_private.enquiries WHERE id=$1', [
          ENQUIRY,
        ]),
      ),
      1,
    );
  } finally {
    await db.close();
  }
});
test('enquiry assignment, next actions, closure and version restrictions', async () => {
  const db = await fixture();
  try {
    await asActor(db, T, null, () =>
      db.query(
        "SELECT app_api.record_enquiry($1,$2,NULL,'Synthetic customer','+254712345678',NULL,'General question','web','synthetic-v1')",
        [ENQUIRY, id(301)],
      ),
    );
    await denied(() =>
      asActor(db, T, AGENT, () =>
        db.query('SELECT app_api.assign_enquiry($1,1,$2)', [ENQUIRY, AGENT]),
      ),
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT app_api.assign_enquiry($1,1,$2)', [ENQUIRY, OTHERADMIN]),
        ),
      'P0002',
    );
    let version = await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.assign_enquiry($1,1,$2)', [ENQUIRY, AGENT]),
    );
    assert.equal(
      await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT count(*)::integer FROM app_private.enquiries'),
      ),
      1,
    );
    await denied(
      () =>
        asActor(db, T, PEER, () =>
          db.query(`SELECT app_api.transition_enquiry($1,$2,'contacted',now()+interval '1 day')`, [
            ENQUIRY,
            version,
          ]),
        ),
      'P0002',
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query(`SELECT app_api.transition_enquiry($1,$2,'contacted')`, [ENQUIRY, version]),
        ),
      '23514',
    );
    version = await asActor(db, T, AGENT, () =>
      scalar(db, `SELECT app_api.transition_enquiry($1,$2,'contacted',now()+interval '1 day')`, [
        ENQUIRY,
        version,
      ]),
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query(`SELECT app_api.transition_enquiry($1,$2,'closed_won')`, [ENQUIRY, version]),
        ),
      '23514',
    );
    version = await asActor(db, T, AGENT, () =>
      scalar(db, `SELECT app_api.transition_enquiry($1,$2,'qualified',now()+interval '1 day')`, [
        ENQUIRY,
        version,
      ]),
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query(`SELECT app_api.transition_enquiry($1,$2,'closed_lost',NULL,'  ')`, [
            ENQUIRY,
            version,
          ]),
        ),
      '23514',
    );
    version = await asActor(db, T, AGENT, () =>
      scalar(db, `SELECT app_api.transition_enquiry($1,$2,'closed_lost',NULL,'Synthetic reason')`, [
        ENQUIRY,
        version,
      ]),
    );
    await denied(
      () =>
        asActor(db, T, AGENT, () =>
          db.query(`SELECT app_api.transition_enquiry($1,$2,'assigned')`, [ENQUIRY, version]),
        ),
      '23514',
    );
    await asActor(db, T, AGENT, () =>
      db.query(`SELECT app_api.transition_enquiry($1,$2,'assigned',NULL,'Customer replied')`, [
        ENQUIRY,
        version,
      ]),
    );
  } finally {
    await db.close();
  }
});
test('transaction-local actor context is cleared on connection reuse', async () => {
  const db = await fixture();
  try {
    await createDraft(db);
    await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
    assert.equal(await scalar(db, 'SELECT count(*)::integer FROM app_private.listings'), 0);
    await denied(() => db.query(`SELECT app_api.create_listing($1,'context-leak')`, [SECOND]));
    await db.exec('ROLLBACK');
  } finally {
    await db.close();
  }
});

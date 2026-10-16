import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration1 = await readFile(
  new URL('../migrations/0001_foundation.sql', import.meta.url),
  'utf8',
);
const migration2 = await readFile(
  new URL('../migrations/0002_listing_disclosure.sql', import.meta.url),
  'utf8',
);
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20),
  LISTING = id(100),
  SECOND = id(101);
const UNKNOWN = { declaration: 'not_declared', charges: [] },
  UNKNOWN_LOCATION = { county: null, town: null, area: null };
const LOCATION = { county: 'Nairobi', town: 'Nairobi', area: 'Synthetic Langata' };
const base = {
  title: 'Synthetic disclosure apartment',
  description: 'Independently written synthetic SQL test only.',
  purpose: 'rent',
  propertyType: 'apartment',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 8,
  privateBathrooms: 2,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic Langata',
  publicPrecision: 'area',
  latitude: -1.366,
  longitude: 36.75,
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
};
const charge = (id, amountMinor, overrides = {}) => ({
  id,
  name: `Named ${id}`,
  amountStatus: 'known',
  amountMinor,
  timing: 'one_off',
  classification: 'fee',
  mandatory: true,
  ...overrides,
});
const quote = (id, overrides = {}) =>
  charge(id, null, { amountStatus: 'quote_required', ...overrides });
const pricing = (charges = [], declaration = 'complete') => ({ declaration, charges });
const content = (overrides = {}) => ({
  ...base,
  pricing: UNKNOWN,
  location: UNKNOWN_LOCATION,
  ...overrides,
});
async function scalar(db, sql, args = []) {
  const result = await db.query(sql, args);
  return Object.values(result.rows[0])[0];
}
async function asActor(db, tenant, actor, callback) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-disclosure-test',true)`,
      [tenant ?? '', actor ?? ''],
    );
    const result = await callback();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function fixture({ legacy = false } = {}) {
  const db = new PGlite();
  await db.exec(migration1);
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'disclosure-test','Synthetic Company'),($2,'other-disclosure','Synthetic Other')`,
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
  if (legacy) {
    await asActor(db, T, AGENT, () =>
      db.query(`SELECT app_api.create_listing($1,'legacy-synthetic')`, [LISTING]),
    );
    const version = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.save_draft($1,1,0,$2::jsonb)', [LISTING, JSON.stringify(base)]),
    );
    await publishDraft(db, LISTING, 1, version);
  }
  await db.exec(migration2);
  return db;
}
async function create(db, listing = LISTING, actor = AGENT) {
  return asActor(db, T, actor, () =>
    db.query('SELECT app_api.create_listing($1,$2)', [listing, `synthetic-${listing.slice(-3)}`]),
  );
}
async function save(
  db,
  value = content(),
  { listing = LISTING, revision = 1, expected = 0, actor = AGENT, tenant = T, legacy = false } = {},
) {
  return asActor(db, tenant, actor, () =>
    scalar(db, `SELECT app_api.${legacy ? 'save_draft' : 'save_draft_v2'}($1,$2,$3,$4::jsonb)`, [
      listing,
      revision,
      expected,
      JSON.stringify(value),
    ]),
  );
}
async function listingVersion(db, listing = LISTING) {
  return asActor(db, T, ADMIN, () =>
    scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [listing]),
  );
}
async function setPublication(db, listing, status, actor = ADMIN) {
  const version = await listingVersion(db, listing);
  return asActor(db, T, actor, () =>
    db.query('SELECT app_api.set_publication($1,$2,$3)', [listing, version, status]),
  );
}
async function confirmAvailability(db, status, listing = LISTING) {
  const version = await listingVersion(db, listing);
  return asActor(db, T, AGENT, () =>
    db.query('SELECT app_api.confirm_availability($1,$2,$3)', [listing, version, status]),
  );
}
async function seedMedia(db, listing, revision) {
  // Accepted synthetic metadata is a bootstrap fixture, not upload/processor proof.
  for (let position = 0; position < 4; position++)
    await db.query(
      `INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted)
    VALUES($1,$2,$3,$4,$5,'image/webp',1234,1000,1000,$6,'Synthetic photo',$7,true)`,
      [
        T,
        listing,
        revision,
        id(Number(listing.slice(-3)) * 100 + revision * 10 + position),
        `synthetic/${listing}/${revision}/${position}.webp`,
        'a'.repeat(64),
        position,
      ],
    );
}
async function pendingDraft(db, listing, revision, version) {
  await seedMedia(db, listing, revision);
  return asActor(db, T, AGENT, () =>
    scalar(db, 'SELECT app_api.submit_revision($1,$2,$3)', [listing, revision, version]),
  );
}
async function publishDraft(db, listing = LISTING, revision = 1, version = 2) {
  await asActor(db, T, AGENT, async () =>
    db.query(`SELECT app_api.confirm_availability($1,$2,'available')`, [
      listing,
      await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [listing]),
    ]),
  );
  const pending = await pendingDraft(db, listing, revision, version);
  return asActor(db, T, ADMIN, () =>
    scalar(db, 'SELECT app_api.decide_revision($1,$2,$3,true)', [listing, revision, pending]),
  );
}
async function publicRows(db, tenant = T, view = 'public_listings_v2') {
  return asActor(db, tenant, null, () =>
    db.query(`SELECT * FROM app_api.${view} ORDER BY listing_id`),
  );
}
const denied = (operation, code = '23514') =>
  assert.rejects(operation, (error) => error.code === code);

test('ordered migration gives legacy rows unknown disclosure/location and keeps v1 projection and restricted grants', async () => {
  const db = await fixture({ legacy: true });
  try {
    const v1 = (await publicRows(db, T, 'public_listings')).rows[0],
      v2 = (await publicRows(db)).rows[0];
    assert.equal('pricing' in v1, false);
    assert.equal('location' in v1, false);
    assert.deepEqual(v2.pricing, UNKNOWN);
    assert.deepEqual(v2.location, UNKNOWN_LOCATION);
    const { pricing: ignoredPricing, location: ignoredLocation, ...projection } = v2;
    assert.deepEqual(projection, v1);
    assert.equal(v2.locality, 'Synthetic Langata');
    assert.equal(v2.latitude, null);
    assert.equal(v2.longitude, null);
    for (const field of ['private_address', 'assigned_agent_id', 'decision_reason'])
      assert.equal(field in v2, false);
    assert.deepEqual((await publicRows(db, OTHER)).rows, []);
    const privateRow = await asActor(db, T, AGENT, () =>
      db.query('SELECT pricing,location FROM app_private.listing_revisions'),
    );
    assert.deepEqual(privateRow.rows[0], { pricing: UNKNOWN, location: UNKNOWN_LOCATION });
    assert.equal(
      await scalar(
        db,
        `SELECT has_function_privilege('api_runtime','app_api.save_draft_v2(uuid,integer,bigint,jsonb)','EXECUTE')`,
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `SELECT has_function_privilege('public','app_api.save_draft_v2(uuid,integer,bigint,jsonb)','EXECUTE')`,
      ),
      false,
    );
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query(`SELECT app_private.pricing_disclosure_valid($1::jsonb,'rent',1)`, [
            JSON.stringify(UNKNOWN),
          ]),
        ),
      '42501',
    );
    await denied(
      () => asActor(db, T, ADMIN, () => db.query('SELECT * FROM app_private.public_snapshots')),
      '42501',
    );
    const flags = await db.query(
      `SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app_private' AND c.relkind='r'`,
    );
    assert.equal(flags.rows.length, 8);
    assert.ok(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
    const config = await scalar(
      db,
      `SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_api' AND proname='save_draft_v2'`,
    );
    assert.deepEqual(config, ['search_path=pg_catalog']);
  } finally {
    await db.close();
  }
});

test('v2 saves exact charge/location inputs atomically with one actual optimistic increment and final-version audit', async () => {
  const db = await fixture();
  try {
    await create(db);
    const value = content({
      pricing: pricing([
        charge('service', 100000, { timing: 'per_rental_period' }),
        charge('deposit', 2000000, { classification: 'refundable_deposit' }),
        quote('optional-view', { mandatory: false }),
      ]),
      location: LOCATION,
    });
    assert.equal(await save(db, value), 2);
    assert.equal(
      await save(db, { ...value, title: 'Changed synthetic title' }, { expected: 2 }),
      3,
    );
    const row = await asActor(db, T, AGENT, () =>
      db.query(
        'SELECT version,pricing,location FROM app_private.listing_revisions WHERE listing_id=$1',
        [LISTING],
      ),
    );
    assert.deepEqual(row.rows[0], { version: 3, pricing: value.pricing, location: LOCATION });
    const audit = await asActor(db, T, ADMIN, () =>
      db.query(
        `SELECT object_version,summary FROM app_private.audit_events WHERE action='revision.saved' ORDER BY id`,
      ),
    );
    assert.deepEqual(
      audit.rows.map((row) => row.object_version),
      [2, 3],
    );
    assert.deepEqual(audit.rows[1].summary, { revision: 1, contract: 'v2' });
    assert.equal(
      await save(db, base, { expected: 3, legacy: true }),
      4,
      'Compatible v1 edits retain explicit v2 inputs.',
    );
    const retained = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT pricing FROM app_private.listing_revisions WHERE listing_id=$1', [
        LISTING,
      ]),
    );
    assert.deepEqual(retained, value.pricing);
    await denied(() => save(db, value, { expected: 4, legacy: true }));
    await denied(() => save(db, value, { expected: 3 }), '40001');
  } finally {
    await db.close();
  }
});

test('pricing storage rejects malformed containers, unknown keys, invalid labels/types/amounts and duplicate IDs', async () => {
  const db = await fixture();
  try {
    await create(db);
    await save(db);
    const invalid = [
      null,
      [],
      {},
      { declaration: 'complete' },
      { charges: [] },
      pricing([], null),
      pricing([], 'unknown'),
      { ...UNKNOWN, tenantId: T },
      pricing({}, 'complete'),
      pricing(new Array(33).fill(0).map((_, i) => charge(`fee-${i}`, 1))),
    ];
    const invalidCharges = [
      null,
      {},
      charge(' ', 1),
      charge('x', 1, { name: '' }),
      charge('x'.repeat(65), 1),
      charge('x', 1, { name: 'x'.repeat(161) }),
      charge(' x', 1),
      charge('x', 1, { name: 'Name ' }),
      charge('\u00a0x', 1),
      charge('x', 1, { name: 'Name\u2007' }),
      charge('x', 1, { name: 'Name\u001f' }),
      charge('x', 1, { name: 'Name\u007f' }),
      charge('x', 1, { name: 'Name\u0085' }),
      charge('x', 1, { mandatory: 'true' }),
      charge('x', 1, { mandatory: null }),
      charge('x', 1, { timing: 'month' }),
      charge('x', 1, { classification: 'deposit' }),
      charge('x', 1, { amountStatus: 'estimated' }),
      charge('x', '1'),
      charge('x', null),
      charge('x', 0),
      charge('x', -1),
      charge('x', 1.5),
      charge('x', Number.MAX_SAFE_INTEGER + 1),
      quote('x', { amountMinor: 0 }),
      quote('x', { amountMinor: 1 }),
      { ...charge('x', 1), privateNote: 'private' },
    ];
    const missing = charge('x', 1);
    delete missing.amountMinor;
    invalidCharges.push(missing);
    for (const pricingValue of [
      ...invalid,
      ...invalidCharges.map((value) => pricing([value])),
      pricing([charge('duplicate', 1), quote('duplicate', { mandatory: false })]),
    ])
      await denied(() => save(db, content({ pricing: pricingValue }), { expected: 2 }));
    const row = await asActor(db, T, AGENT, () =>
      db.query('SELECT version,pricing FROM app_private.listing_revisions'),
    );
    assert.deepEqual(row.rows[0], { version: 2, pricing: UNKNOWN });
  } finally {
    await db.close();
  }
});

test('structured location rejects guessed/malformed shapes while nullable and Unicode code-point bounded inputs remain explicit', async () => {
  const db = await fixture();
  try {
    await create(db);
    await save(db);
    for (const location of [
      null,
      [],
      {},
      { county: null, town: null },
      { ...LOCATION, coordinates: [1, 2] },
      { ...LOCATION, county: 1 },
      { ...LOCATION, town: '' },
      { ...LOCATION, area: ' Leading' },
      { ...LOCATION, area: 'Trailing\u00a0' },
      { ...LOCATION, town: 'Name\u009f' },
      { ...LOCATION, county: 'x'.repeat(161) },
    ])
      await denied(() => save(db, content({ location }), { expected: 2 }));
    const unicode = { county: '😀'.repeat(160), town: null, area: null };
    assert.equal(await save(db, content({ location: unicode }), { expected: 2 }), 3);
    await denied(() =>
      save(db, content({ location: { ...unicode, county: '😀'.repeat(161) } }), { expected: 3 }),
    );
    await denied(() => save(db, { ...base, pricing: UNKNOWN }, { expected: 3 }));
    await denied(() => save(db, { ...base, location: UNKNOWN_LOCATION }, { expected: 3 }));
    assert.equal(
      await save(db, { pricing: UNKNOWN, location: UNKNOWN_LOCATION }, { expected: 3 }),
      4,
      'An incomplete draft may retain wholly unknown structured location.',
    );
  } finally {
    await db.close();
  }
});

test('quotes stay null, deposits stay one-off and only rent permits recurring charges; a null-purpose draft permits no charges', async () => {
  const db = await fixture();
  try {
    await create(db);
    await save(db);
    for (const value of [
      content({
        purpose: 'sale',
        rentPeriod: null,
        pricing: pricing([charge('recurring', 1, { timing: 'per_rental_period' })]),
      }),
      content({
        purpose: 'sale',
        rentPeriod: null,
        pricing: pricing([quote('recurring', { mandatory: false, timing: 'per_rental_period' })]),
      }),
      content({
        pricing: pricing([
          charge('deposit', 1, {
            classification: 'refundable_deposit',
            timing: 'per_rental_period',
          }),
        ]),
      }),
      content({
        pricing: pricing([
          quote('deposit', { classification: 'refundable_deposit', timing: 'per_rental_period' }),
        ]),
      }),
      { pricing: pricing([charge('orphan', 1)]), location: UNKNOWN_LOCATION },
    ])
      await denied(() => save(db, value, { expected: 2 }));
    const value = content({
      pricing: pricing([
        quote('unknown-service', { timing: 'per_rental_period' }),
        quote('unknown-deposit', { classification: 'refundable_deposit' }),
        quote('optional', { mandatory: false }),
      ]),
      location: LOCATION,
    });
    assert.equal(await save(db, value, { expected: 2 }), 3);
    const stored = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT pricing FROM app_private.listing_revisions'),
    );
    assert.deepEqual(stored, value.pricing);
    assert.ok(stored.charges.every((row) => row.amountMinor === null));
  } finally {
    await db.close();
  }
});

test('numeric aggregate checks allow exact safe limits, reject mandatory/optional overflow and protect incompatible v1 edits', async () => {
  const db = await fixture();
  try {
    await create(db);
    const exact = content({
      amountMinor: 1,
      pricing: pricing([charge('large', Number.MAX_SAFE_INTEGER - 1)]),
    });
    assert.equal(await save(db, exact), 2);
    await denied(() =>
      save(
        db,
        { ...exact, pricing: pricing([charge('large', Number.MAX_SAFE_INTEGER)]) },
        { expected: 2 },
      ),
    );
    await denied(() => save(db, { ...base, amountMinor: 2 }, { expected: 2, legacy: true }));
    assert.equal(
      await save(
        db,
        {
          ...exact,
          amountMinor: 2,
          pricing: pricing([charge('large', Number.MAX_SAFE_INTEGER - 2)]),
        },
        { expected: 2 },
      ),
      3,
      'Base/fee changes validate one final row, not an invalid intermediate row.',
    );
    const optional = content({
      pricing: pricing([charge('optional', Number.MAX_SAFE_INTEGER, { mandatory: false })]),
    });
    assert.equal(await save(db, optional, { expected: 3 }), 4);
    for (const extra of [
      charge('extra', 1, { mandatory: false }),
      charge('extra', 1, { mandatory: false, timing: 'per_rental_period' }),
      charge('extra', 1, { mandatory: false, classification: 'refundable_deposit' }),
    ])
      await denied(() =>
        save(
          db,
          { ...optional, pricing: pricing([...optional.pricing.charges, extra]) },
          { expected: 4 },
        ),
      );
    const recurring = content({
      pricing: pricing([charge('service', 100000, { timing: 'per_rental_period' })]),
    });
    assert.equal(await save(db, recurring, { expected: 4 }), 5);
    await denied(() =>
      save(db, { ...base, purpose: 'sale', rentPeriod: null }, { expected: 5, legacy: true }),
    );
    const sale = content({
      purpose: 'sale',
      rentPeriod: null,
      pricing: pricing([charge('legal', 150000)]),
    });
    assert.equal(
      await save(db, sale, { expected: 5 }),
      6,
      'Valid rent-to-sale edit changes old pricing in the same UPDATE.',
    );
    const stored = await asActor(db, T, AGENT, () =>
      db.query('SELECT purpose,rent_period,version,pricing FROM app_private.listing_revisions'),
    );
    assert.deepEqual(stored.rows[0], {
      purpose: 'sale',
      rent_period: null,
      version: 6,
      pricing: sale.pricing,
    });
    await denied(() =>
      db.query(`UPDATE app_private.listing_revisions SET pricing=$1::jsonb`, [
        JSON.stringify(pricing([charge('invalid', 0)])),
      ]),
    );
  } finally {
    await db.close();
  }
});

test('v2 commands enforce current tenant, assignment, membership and expected revision version without direct runtime writes', async () => {
  const db = await fixture();
  try {
    await create(db);
    await save(db);
    for (const [tenant, actor, code] of [
      [T, null, '42501'],
      [T, CUSTOMER, '42501'],
      [OTHER, AGENT, '42501'],
      [T, PEER, 'P0002'],
      [OTHER, OTHERADMIN, 'P0002'],
    ])
      await denied(() => save(db, content(), { tenant, actor, expected: 2 }), code);
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('UPDATE app_private.listing_revisions SET pricing=$1::jsonb', [
            JSON.stringify(UNKNOWN),
          ]),
        ),
      '42501',
    );
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.reassign_listing($1,1,$2)', [LISTING, PEER]),
    );
    await denied(() => save(db, content(), { expected: 2 }), 'P0002');
    assert.equal(await save(db, content({ location: LOCATION }), { expected: 2, actor: PEER }), 3);
    await denied(() => save(db, content(), { expected: 2, actor: PEER }), '40001');
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, PEER],
    );
    await denied(() => save(db, content(), { expected: 3, actor: PEER }), '42501');
    assert.equal(
      (
        await asActor(db, OTHER, OTHERADMIN, () =>
          db.query('SELECT pricing,location FROM app_private.listing_revisions'),
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test('approval copies exact reviewed pricing/location; drafts, rejected/stale reviews and decided-revision attacks preserve public snapshot', async () => {
  const db = await fixture();
  try {
    await create(db);
    const first = content({
      pricing: pricing(
        [
          charge('service', 100000, { timing: 'per_rental_period' }),
          charge('deposit', 2000000, { classification: 'refundable_deposit' }),
          quote('confirm-fee'),
        ],
        'incomplete',
      ),
      location: LOCATION,
    });
    await publishDraft(db, LISTING, 1, await save(db, first));
    let publicRow = (await publicRows(db)).rows[0];
    assert.deepEqual(publicRow.pricing, first.pricing);
    assert.deepEqual(publicRow.location, LOCATION);
    assert.equal(publicRow.latitude, null);
    const second = content({
      pricing: pricing([charge('different', 500)]),
      location: { county: 'Nairobi', town: 'Synthetic town', area: null },
    });
    const version = await save(db, second, { revision: 2 });
    assert.equal((await publicRows(db)).rows[0].revision_no, 1);
    const pending = await pendingDraft(db, LISTING, 2, version);
    await denied(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT app_api.decide_revision($1,2,$2,true)', [LISTING, pending - 1]),
        ),
      '40001',
    );
    await asActor(db, T, ADMIN, () =>
      db.query(`SELECT app_api.decide_revision($1,2,$2,false,'Synthetic review correction')`, [
        LISTING,
        pending,
      ]),
    );
    publicRow = (await publicRows(db)).rows[0];
    assert.equal(publicRow.revision_no, 1);
    assert.deepEqual(publicRow.pricing, first.pricing);
    assert.deepEqual(publicRow.location, LOCATION);
    await denied(() =>
      db.query(
        `UPDATE app_private.listing_revisions SET pricing=$1::jsonb WHERE listing_id=$2 AND revision_no=1`,
        [JSON.stringify(UNKNOWN), LISTING],
      ),
    );
    await denied(() =>
      db.query(
        `UPDATE app_private.listing_revisions SET location=$1::jsonb WHERE listing_id=$2 AND revision_no=2`,
        [JSON.stringify(UNKNOWN_LOCATION), LISTING],
      ),
    );
    await publishDraft(db, LISTING, 3, await save(db, second, { revision: 3 }));
    publicRow = (await publicRows(db)).rows[0];
    assert.equal(publicRow.revision_no, 3);
    assert.deepEqual(publicRow.pricing, second.pricing);
    assert.deepEqual(publicRow.location, second.location);
    const v1 = (await publicRows(db, T, 'public_listings')).rows[0];
    assert.equal('pricing' in v1, false);
    assert.equal('location' in v1, false);
    assert.deepEqual((await publicRows(db, OTHER)).rows, []);
    await denied(
      () => asActor(db, T, ADMIN, () => db.query('SELECT * FROM app_private.public_snapshots')),
      '42501',
    );
  } finally {
    await db.close();
  }
});

test('v2 snapshot replacement preserves operational pause/archive and only explicit admin restoration exposes new pricing', async () => {
  const db = await fixture();
  try {
    for (const [listing, status] of [
      [LISTING, 'paused'],
      [SECOND, 'archived'],
    ]) {
      await create(db, listing);
      await publishDraft(db, listing, 1, await save(db, content(), { listing }));
      const newer = content({ pricing: pricing([quote('new-amount')]), location: LOCATION });
      const pending = await pendingDraft(
        db,
        listing,
        2,
        await save(db, newer, { listing, revision: 2 }),
      );
      await setPublication(db, listing, status);
      const archivedBefore = await scalar(
        db,
        'SELECT archived_at FROM app_private.listings WHERE id=$1',
        [listing],
      );
      await asActor(db, T, ADMIN, () =>
        db.query('SELECT app_api.decide_revision($1,2,$2,true)', [listing, pending]),
      );
      const state = await asActor(db, T, ADMIN, () =>
        db.query('SELECT publication_status,archived_at FROM app_private.listings WHERE id=$1', [
          listing,
        ]),
      );
      assert.equal(state.rows[0].publication_status, status);
      assert.deepEqual(state.rows[0].archived_at, archivedBefore);
      assert.equal(
        (await publicRows(db)).rows.some((row) => row.listing_id === listing),
        false,
      );
      await denied(() => setPublication(db, listing, 'published', AGENT), '42501');
      await setPublication(db, listing, 'published');
      const restored = (await publicRows(db)).rows.find((row) => row.listing_id === listing);
      assert.equal(restored.revision_no, 2);
      assert.deepEqual(restored.pricing, newer.pricing);
      assert.deepEqual(restored.location, LOCATION);
    }
  } finally {
    await db.close();
  }
});

test('v2 discovery inherits v1 enabled/fresh/available predicate and retains private/public location boundaries', async () => {
  const db = await fixture();
  try {
    await create(db);
    await publishDraft(db, LISTING, 1, await save(db, content({ location: LOCATION })));
    assert.equal((await publicRows(db)).rows.length, 1);
    await confirmAvailability(db, 'reserved');
    assert.equal((await publicRows(db)).rows.length, 0);
    await confirmAvailability(db, 'available');
    assert.equal((await publicRows(db)).rows.length, 0, 'Reconfirmation cannot undo a pause.');
    await setPublication(db, LISTING, 'published');
    assert.equal((await publicRows(db)).rows.length, 1);
    await db.query(
      `UPDATE app_private.listings SET last_availability_confirmed_at=now()-interval '31 days' WHERE id=$1`,
      [LISTING],
    );
    assert.equal((await publicRows(db)).rows.length, 0);
    await confirmAvailability(db, 'available');
    assert.equal((await publicRows(db)).rows.length, 1);
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    assert.equal((await publicRows(db)).rows.length, 0);
  } finally {
    await db.close();
  }
});

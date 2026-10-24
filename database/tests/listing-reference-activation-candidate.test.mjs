import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import {
  applyReferenceCandidate,
  prepareReferenceCandidate,
  referenceCandidateFiles,
} from '../test-helpers/reference-activation-candidate.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import {
  id,
  command,
  catalogue,
} from '../../packages/api-client/tests/fixtures/reference-creation.mjs';
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-activation-' + tenant,
    ]);
    for (const [actor, role] of [
      [10, 'admin'],
      [11, 'agent'],
      [12, 'agent'],
      [13, 'customer'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',
        [id(tenant), id(actor), role],
      );
  }
  const as = async (user, work, tenant = 1) => {
    await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(tenant), id(user)],
      );
      const result = await work();
      await db.exec('COMMIT');
      return result;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  };
  const content = command().content,
    receipts = [];
  for (const n of [100, 101])
    receipts.push(
      await as(11, () =>
        seedGuardedListingDraft(db, {
          listingId: id(n),
          slug: 'synthetic-ordinary-' + n,
          actorId: id(11),
          content,
        }),
      ),
    );
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: id(1),
      listingId: id(101),
      revision: 1,
      position,
      mediaId: id(500 + position),
    });
  await as(11, () => db.query("SELECT app_api.confirm_availability($1,1,'available')", [id(101)]));
  await as(11, () => db.query('SELECT app_api.submit_revision($1,1,2)', [id(101)]));
  await as(10, () => db.query('SELECT app_api.decide_revision($1,1,3,true,NULL)', [id(101)]));
  await as(11, () =>
    db.query('SELECT app_api.create_listing($1,$2,NULL)', [id(102), 'synthetic-legacy-bare']),
  );
  return { db, as, content, receipts };
}
async function snapshot(db) {
  return (
    await db.query(
      "SELECT (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM app_private.listings l) AS listings,(SELECT jsonb_agg(to_jsonb(r)-ARRAY['synthetic_reference_attributes','synthetic_reference_operation'] ORDER BY listing_id,revision_no) FROM app_private.listing_revisions r) AS revisions,(SELECT jsonb_agg(to_jsonb(r) ORDER BY operation_id) FROM app_private.listing_creation_requests r) AS originals,(SELECT jsonb_agg(to_jsonb(r) ORDER BY operation_id) FROM app_private.listing_creation_results r) AS results",
    )
  ).rows[0];
}
async function absent(db) {
  const row = (
    await db.query(
      "SELECT to_regclass('app_private.synthetic_reference_catalogues') AS catalogue,to_regclass('app_private.synthetic_reference_transitions') AS transitions,to_regclass('app_private.synthetic_reference_creation_receipts') AS creation,to_regclass('app_private.synthetic_reference_successor_receipts') AS successor,EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND table_name='listing_revisions' AND column_name='synthetic_reference_attributes') AS column_present",
    )
  ).rows[0];
  assert.deepEqual(row, {
    catalogue: null,
    transitions: null,
    creation: null,
    successor: null,
    column_present: false,
  });
}
test('candidate source plan freezes six explicit hashed files without changing default migration order', async () => {
  const plan = await prepareReferenceCandidate();
  assert.equal(plan.length, 6);
  assert.deepEqual(
    plan.map((s) => s.file),
    referenceCandidateFiles,
  );
  assert.ok(Object.isFrozen(plan));
  for (const source of plan) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Object.isFrozen(source));
    assert.ok(!/^BEGIN;$/m.test(source.sql));
    assert.ok(!/^COMMIT;$/m.test(source.sql));
  }
});
test('every simulated install failure rolls back candidate DDL/columns/ACLs and keeps existing ordinary history intact', async (t) => {
  const { db } = await fixture(t),
    before = await snapshot(db);
  await absent(db);
  for (const file of referenceCandidateFiles)
    await t.test('failure before ' + file, async () => {
      const wrapper = {
        query: (...args) => db.query(...args),
        exec: async (sql) => {
          if (sql.startsWith('-- reference-candidate: ' + file + '\n'))
            throw Error('Synthetic interrupted candidate');
          return db.exec(sql);
        },
      };
      await assert.rejects(applyReferenceCandidate(wrapper), /Synthetic interrupted candidate/);
      await absent(db);
      assert.deepEqual(await snapshot(db), before);
      assert.equal((await db.query('SELECT current_user AS actor')).rows[0].actor, 'postgres');
    });
  const sources = await applyReferenceCandidate(db);
  assert.equal(sources.length, 6);
  assert.deepEqual(await snapshot(db), before);
  await assert.rejects(applyReferenceCandidate(db), /unadopted default schema/);
  assert.deepEqual(await snapshot(db), before);
});
test('populated ordinary and bare-record callers preserve receipts, permissions, positive versions and approved pointer after atomic candidate install', async (t) => {
  const { db, as, content, receipts } = await fixture(t),
    before = await snapshot(db);
  await applyReferenceCandidate(db);
  assert.deepEqual(await snapshot(db), before);
  for (const receipt of receipts)
    assert.deepEqual(
      (
        await as(11, () =>
          db.query('SELECT app_api.read_listing_creation($1,$2) AS receipt', [
            receipt.listingId,
            receipt.operationId,
          ]),
        )
      ).rows[0].receipt,
      receipt,
    );
  for (const [user, tenant] of [
    [12, 1],
    [13, 1],
    [11, 2],
  ])
    await assert.rejects(
      as(
        user,
        () =>
          db.query('SELECT app_api.save_draft_v2($1,1,2,$2::jsonb)', [
            id(100),
            JSON.stringify(content),
          ]),
        tenant,
      ),
    );
  for (const listing of [100, 102])
    await assert.rejects(
      as(11, () =>
        db.query('SELECT app_api.save_draft_v2($1,1,0,$2::jsonb)', [
          id(listing),
          JSON.stringify(content),
        ]),
      ),
    );
  assert.equal(
    (
      await as(11, () =>
        db.query('SELECT app_api.save_draft_v2($1,1,2,$2::jsonb) AS version', [
          id(100),
          JSON.stringify({ ...content, title: 'Synthetic ordinary after activation' }),
        ]),
      )
    ).rows[0].version,
    3,
  );
  assert.equal(
    (
      await db.query(
        'SELECT synthetic_reference_attributes AS attrs FROM app_private.listing_revisions WHERE listing_id=$1',
        [id(100)],
      )
    ).rows[0].attrs,
    null,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS n FROM app_private.listing_revisions WHERE listing_id=$1',
        [id(102)],
      )
    ).rows[0].n,
    0,
  );
  const next = (
    await as(11, () =>
      db.query(
        "SELECT app_api.start_listing_revision_v2($1,$2,3,1,4,'approved',$3::jsonb) AS receipt",
        [id(101), id(800), JSON.stringify(content)],
      ),
    )
  ).rows[0].receipt;
  assert.equal(next.decision.outcome, 'applied');
  const selected = (
    await db.query(
      'SELECT published_revision_no AS published_revision,publication_status FROM app_private.listings WHERE id=$1',
      [id(101)],
    )
  ).rows[0];
  assert.deepEqual(selected, { published_revision: 1, publication_status: 'published' });
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS n FROM app_private.listing_revisions WHERE listing_id=$1',
        [id(101)],
      )
    ).rows[0].n,
    2,
  );
});
test('explicit reference adoption never infers IDs from ordinary labels and cannot fall back to ordinary v2 writes', async (t) => {
  const { db, as, content } = await fixture(t);
  await applyReferenceCandidate(db);
  assert.equal(
    (await db.query('SELECT version FROM app_private.synthetic_reference_catalogue_current'))
      .rows[0].version,
    null,
  );
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(catalogue()),
  ]);
  const selection = command().selection;
  const adopted = (
    await as(11, () =>
      db.query(
        'SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb) AS receipt',
        [id(100), id(801), JSON.stringify(content), JSON.stringify(selection)],
      ),
    )
  ).rows[0].receipt;
  const before = await snapshot(db);
  await assert.rejects(
    as(11, () =>
      db.query('SELECT app_api.save_draft_v2($1,1,3,$2::jsonb)', [
        id(100),
        JSON.stringify({ ...content, title: 'Must not erase reference facts' }),
      ]),
    ),
  );
  assert.deepEqual(await snapshot(db), before);
  const untouched = (
    await db.query(
      'SELECT synthetic_reference_attributes AS attrs FROM app_private.listing_revisions WHERE listing_id=$1',
      [id(101)],
    )
  ).rows[0].attrs;
  assert.equal(untouched, null);
  assert.ok(adopted);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS n FROM app_private.synthetic_reference_draft_receipts',
      )
    ).rows[0].n,
    1,
  );
  for (const table of [
    'synthetic_reference_catalogues',
    'synthetic_reference_locations',
    'synthetic_reference_amenities',
    'synthetic_reference_draft_receipts',
    'synthetic_reference_transitions',
    'synthetic_reference_approved',
    'synthetic_reference_creation_receipts',
    'synthetic_reference_successor_receipts',
  ])
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('api_runtime',$1,'INSERT,UPDATE,DELETE') AS allowed",
          ['app_private.' + table],
        )
      ).rows[0].allowed,
      false,
      table,
    );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('api_runtime','app_private.install_synthetic_reference_catalogue(bigint,jsonb)','EXECUTE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
});

test('authoritative mixed-row protocol read follows current assignment and persisted adoption without writing', async (t) => {
  const { db, as, content } = await fixture(t);
  await applyReferenceCandidate(db);
  const read = (user, listing = 100, revision = 1, tenant = 1) =>
    as(
      user,
      async () =>
        (
          await db.query('SELECT app_api.read_synthetic_revision_protocol($1,$2) AS result', [
            id(listing),
            revision,
          ])
        ).rows[0].result,
      tenant,
    );
  const ordinary = {
    listingId: id(100),
    revision: 1,
    listingVersion: '1',
    revisionVersion: '2',
    state: 'draft',
    editable: true,
    protocol: 'ordinary-v2',
  };
  await t.test(
    'ordinary draft and terminal approved row are distinct; reads preserve all history',
    async () => {
      const before = await snapshot(db);
      assert.deepEqual(await read(11), ordinary);
      assert.deepEqual(await read(10), ordinary);
      const approved = await read(11, 101);
      assert.equal(approved.protocol, 'ordinary-v2');
      assert.equal(approved.state, 'approved');
      assert.equal(approved.editable, false);
      assert.deepEqual(await snapshot(db), before);
    },
  );
  await t.test(
    'unassigned, customer, foreign tenant, absent, bare and malformed targets are denied',
    async () => {
      for (const args of [
        [12],
        [13],
        [11, 100, 1, 2],
        [11, 999],
        [11, 102],
        [11, 100, 2],
        [11, 100, 0],
        [11, 100, -1],
        [11, 100, null],
      ])
        await assert.rejects(read(...args));
      assert.equal(
        (
          await db.query(
            "SELECT has_function_privilege('public','app_api.read_synthetic_revision_protocol(uuid,integer)','EXECUTE') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
    },
  );
  await t.test(
    'explicit adoption changes protocol and version, while another ordinary row stays ordinary',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
        JSON.stringify(catalogue()),
      ]);
      await as(11, () =>
        db.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
          id(100),
          id(990),
          JSON.stringify(content),
          JSON.stringify(command().selection),
        ]),
      );
      assert.deepEqual(await read(11), {
        ...ordinary,
        revisionVersion: '3',
        protocol: 'synthetic-reference-v1',
      });
      assert.equal((await read(11, 101)).protocol, 'ordinary-v2');
      // Prior ordinary read is no permission to erase newly adopted facts.
      await assert.rejects(
        as(11, () =>
          db.query('SELECT app_api.save_draft_v2($1,1,2,$2::jsonb)', [
            id(100),
            JSON.stringify(content),
          ]),
        ),
      );
    },
  );
  await t.test(
    'reassignment and membership revocation invalidate earlier authorized reads',
    async () => {
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(12), id(1), id(100)],
      );
      await assert.rejects(read(11));
      assert.equal((await read(12)).protocol, 'synthetic-reference-v1');
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(12)],
      );
      await assert.rejects(read(12));
      const before = await snapshot(db);
      assert.equal((await read(10)).protocol, 'synthetic-reference-v1');
      assert.deepEqual(await snapshot(db), before);
    },
  );
});

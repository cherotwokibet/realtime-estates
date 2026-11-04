import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import {
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceRevision,
  validateSyntheticReferenceTransitionReceipt,
  validateSyntheticReferencePublicAttributes,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('isolated reference moderation binds reviewed facts and immutable approved public attributes', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  assert.equal(
    (
      await db.query(
        "SELECT to_regprocedure('app_api.execute_synthetic_reference_transition(uuid,integer,uuid,text,jsonb,text)') AS f",
      )
    ).rows[0].f,
    null,
  );
  for (const f of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
  ])
    await db.exec(await readFile(new URL('../proposals/' + f, import.meta.url), 'utf8'));
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-review-' + tenant,
    ]);
    for (const [user, role] of [
      [10, 'admin'],
      [11, 'agent'],
      [12, 'agent'],
      [13, 'customer'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  const cat = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [
      { id: id(200), kind: 'county', parentId: null, label: 'Synthetic original county' },
      { id: id(201), kind: 'locality', parentId: id(200), label: 'Synthetic original town' },
    ],
    amenities: [
      {
        id: id(210),
        code: 'synthetic-lift',
        label: 'Synthetic original lift',
        propertyTypes: ['apartment'],
      },
    ],
  };
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic reference review',
    description: 'Independent synthetic moderation fixture.',
    purpose: 'rent',
    propertyType: 'apartment',
    currency: 'KES',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 2,
    locality: 'Synthetic original town',
    location: { county: 'Synthetic original county', town: 'Synthetic original town', area: null },
    pricing: { declaration: 'complete', charges: [] },
    privateAddress: 'PRIVATE-REVIEW-ONLY-SENTINEL',
    publicPrecision: 'area',
    latitude: -1.123456,
    longitude: 36.654321,
  });
  const selection = {
    catalogueVersion: '1',
    location: { countyId: id(200), localityId: id(201), neighbourhoodId: null },
    amenityIds: [id(210)],
  };
  async function as(user, work, tenant = 1) {
    await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-reference-moderation',true)",
        [id(tenant), id(user)],
      );
      const value = await work();
      await db.exec('COMMIT');
      return value;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  for (const listing of [100, 101, 102, 103]) {
    await as(11, () =>
      seedGuardedListingDraft(db, {
        listingId: id(listing),
        slug: 'synthetic-review-' + listing,
        content,
        actorId: id(11),
      }),
    );
    if (listing !== 101)
      for (let pos = 0; pos < 4; pos++)
        await seedSyntheticSealedMedia(db, {
          tenantId: id(1),
          listingId: id(listing),
          position: pos,
        });
    await as(11, () =>
      db.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
        id(listing),
        id(listing + 1000),
        JSON.stringify(content),
        JSON.stringify(selection),
      ]),
    );
    if (listing !== 102)
      await as(11, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [id(listing)]),
      );
  }
  const fail = (work, code) => assert.rejects(work, (e) => e.code === code),
    state = async (listing = 100) =>
      (
        await db.query(
          'SELECT state,version FROM app_private.listing_revisions WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1',
          [id(1), id(listing)],
        )
      ).rows[0];
  const snapshot = async (user = 11, listing = 100) =>
    as(user, async () => {
      const r = await state(listing);
      const projection = (
        await db.query('SELECT app_api.read_synthetic_reference_revision($1,1,$2) AS r', [
          id(listing),
          r.version,
        ])
      ).rows[0].r;
      assert.deepEqual(
        validateSyntheticReferenceRevision(projection, cat, id(listing), 1, String(r.version)),
        projection,
      );
      return projection;
    });
  const command = (user, action, review, op, reason = null, listing = 100) =>
    as(user, async () => {
      const result = (
        await db.query(
          'SELECT app_api.execute_synthetic_reference_transition($1,1,$2,$3,$4::jsonb,$5) AS r',
          [id(listing), id(op), action, JSON.stringify(review), reason],
        )
      ).rows[0].r;
      assert.deepEqual(
        validateSyntheticReferenceTransitionReceipt(
          result,
          {
            policy: 'synthetic-reference-transition-v1',
            operationId: id(op),
            action,
            listingId: id(listing),
            revision: 1,
            review,
            reason,
          },
          cat,
          id(user),
        ),
        result,
      );
      return result;
    });
  await t.test(
    'proposal is separate and original adopted-submit guard stays closed before installation',
    async () => {
      await fail(
        () => as(11, () => db.query('SELECT app_api.submit_revision($1,1,3)', [id(100)])),
        '23514',
      );
      assert.equal((await state()).state, 'draft');
    },
  );
  await db.exec(
    await readFile(
      new URL('../proposals/listing-reference-moderation.sql', import.meta.url),
      'utf8',
    ),
  );
  async function assertTransitionAudit(
    listing,
    actor,
    action,
    baseAction,
    operation,
    version,
    baseSummary,
  ) {
    const { rows } = await db.query(
      'SELECT tenant_id,actor_id,action,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE object_id=$1 AND action IN ($2,$3) AND object_version=$4 ORDER BY id',
      [id(listing), baseAction, 'revision.synthetic_reference_' + action, version],
    );
    const common = {
      tenant_id: id(1),
      actor_id: id(actor),
      object_type: 'listing',
      object_id: id(listing),
      object_version: version,
      correlation_id: 'synthetic-reference-moderation',
    };
    assert.deepEqual(rows, [
      { ...common, action: baseAction, summary: baseSummary },
      {
        ...common,
        action: 'revision.synthetic_reference_' + action,
        summary: { revision: 1, operationId: id(operation) },
      },
    ]);
  }
  let draft, pending, submission, approval;
  await t.test(
    'read projection contains exact private content, original attributes and immutable media facts',
    async () => {
      draft = await snapshot();
      assert.deepEqual(draft.content, content);
      assert.equal(draft.attributes.location.county.label, 'Synthetic original county');
      assert.equal(draft.photos.length, 4);
      assert.ok(draft.photos.every((p) => p.sealed));
      assert.equal(draft.revisionVersion, '3');
      assert.equal(draft.listingVersion, '2');
    },
  );
  await t.test(
    'current assignment/company/customer/admin-review guards refuse before exposing facts',
    async () => {
      for (const [user, code] of [
        [12, 'P0002'],
        [13, '42501'],
      ])
        await fail(
          () =>
            as(user, () =>
              db.query('SELECT app_api.read_synthetic_reference_revision($1,1,3)', [id(100)]),
            ),
          code,
        );
      await fail(
        () =>
          as(11, () =>
            db.query('SELECT app_api.read_synthetic_reference_review($1,1,3)', [id(100)]),
          ),
        '42501',
      );
      await fail(
        () =>
          as(
            10,
            () => db.query('SELECT app_api.read_synthetic_reference_revision($1,1,3)', [id(100)]),
            2,
          ),
        'P0002',
      );
      await fail(
        () =>
          as(10, () =>
            db.query('SELECT app_api.read_synthetic_reference_revision($1,1,2)', [id(100)]),
          ),
        '40001',
      );
    },
  );
  await t.test(
    'tampered reviewed content, attributes, gallery, context and extra fields never create permits',
    async () => {
      for (const changed of [
        { ...draft, content: { ...draft.content, title: 'Tampered' } },
        { ...draft, attributes: { ...draft.attributes, catalogueVersion: '2' } },
        { ...draft, photos: [] },
        { ...draft, listingVersion: '1' },
        { ...draft, actorId: id(10) },
      ])
        await fail(() => command(11, 'submit', changed, 2000), '40001');
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_transitions'))
          .rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'submission retains sealed-media validation and rolls receipt/state back on failure',
    async () => {
      const noMedia = await snapshot(11, 101);
      await fail(() => command(11, 'submit', noMedia, 2001, null, 101), '23514');
      assert.equal((await state(101)).state, 'draft');
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_transitions'))
          .rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'explicit submit and identical replay use one editorial version with original actor recovery',
    async () => {
      submission = await command(11, 'submit', draft, 2010);
      assert.equal(submission.revisionVersion, '4');
      assert.equal((await state()).version, 4);
      assert.deepEqual(await command(11, 'submit', draft, 2010), submission);
      assert.deepEqual(
        await as(
          11,
          async () =>
            (
              await db.query('SELECT app_api.read_synthetic_reference_transition($1,$2) AS r', [
                id(100),
                id(2010),
              ])
            ).rows[0].r,
        ),
        submission,
      );
      await fail(() => command(10, 'submit', draft, 2010), '40001');
      await assertTransitionAudit(100, 11, 'submit', 'revision.submitted', 2010, '4', {
        revision: 1,
      });
      await fail(
        () =>
          as(10, () =>
            db.query('SELECT app_api.read_synthetic_reference_transition($1,$2)', [
              id(100),
              id(2010),
            ]),
          ),
        'P0002',
      );
    },
  );
  await t.test(
    'legacy review decision and withdraw cannot reuse a permit from another version',
    async () => {
      await fail(
        () => as(10, () => db.query('SELECT app_api.decide_revision($1,1,4,true,NULL)', [id(100)])),
        '23514',
      );
      await fail(
        () => as(11, () => db.query('SELECT app_api.withdraw_revision($1,1,4)', [id(100)])),
        '23514',
      );
      assert.equal((await state()).state, 'pending');
      pending = await as(
        10,
        async () =>
          (await db.query('SELECT app_api.read_synthetic_reference_review($1,1,4) AS r', [id(100)]))
            .rows[0].r,
      );
    },
  );
  await t.test(
    'catalogue activation does not rewrite original reviewed labels or permit stale snapshot approval',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({
          ...cat,
          version: '2',
          locations: cat.locations.map((r) => ({ ...r, label: r.label + ' changed' })),
          amenities: cat.amenities.map((r) => ({ ...r, label: r.label + ' changed' })),
        }),
      ]);
      assert.equal(
        (await snapshot(10)).attributes.location.county.label,
        'Synthetic original county',
      );
      await fail(() => command(10, 'approve', draft, 2020), '40001');
      await fail(() => command(11, 'approve', pending, 2020), '42501');
    },
  );
  await t.test(
    'operational pause invalidates prior listing currency and approval preserves the pause',
    async () => {
      await as(10, () => db.query("SELECT app_api.set_publication($1,2,'paused')", [id(100)]));
      await fail(() => command(10, 'approve', pending, 2021), '40001');
      pending = await snapshot(10);
      approval = await command(10, 'approve', pending, 2022);
      assert.equal(approval.revisionVersion, '5');
      assert.equal((await state()).state, 'approved');
      assert.equal(
        (await as(13, () => db.query('SELECT * FROM app_api.public_listings_reference_v3'))).rows
          .length,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT publication_status FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
            [id(1), id(100)],
          )
        ).rows[0].publication_status,
        'paused',
      );
    },
  );
  await t.test(
    'explicit restore publishes only approved snapshot facts, original labels and no private address/area coordinates',
    async () => {
      await as(10, () => db.query("SELECT app_api.set_publication($1,4,'published')", [id(100)]));
      const row = (
        await as(13, () => db.query('SELECT * FROM app_api.public_listings_reference_v3'))
      ).rows[0];
      assert.equal(row.reference_revision_version, '5');
      assert.deepEqual(
        validateSyntheticReferencePublicAttributes(
          {
            attributes: row.reference_attributes,
            revisionVersion: row.reference_revision_version,
          },
          cat,
          row.property_type,
        ),
        {
          attributes: approval.review.attributes,
          revisionVersion: approval.revisionVersion,
        },
      );
      assert.equal(row.reference_attributes.location.county.label, 'Synthetic original county');
      assert.equal(row.latitude, null);
      assert.equal(row.longitude, null);
      assert.ok(!JSON.stringify(row).includes('PRIVATE-REVIEW-ONLY'));
      assert.ok(!Object.hasOwn(row, 'private_address'));
      assert.equal(
        (await as(13, () => db.query('SELECT * FROM app_api.public_listings_reference_v3'), 2)).rows
          .length,
        0,
      );
      assert.deepEqual(await command(10, 'approve', pending, 2022), approval);
      await assertTransitionAudit(100, 10, 'approve', 'revision.approved', 2022, '5', {
        revision: 1,
        selfApproval: false,
      });
      assert.equal((await state()).version, 5);
    },
  );
  await t.test(
    'approval still requires current availability and failed approval leaves no receipt/snapshot',
    async () => {
      const r = await snapshot(11, 102);
      await command(11, 'submit', r, 2030, null, 102);
      const review = await snapshot(10, 102);
      await fail(() => command(10, 'approve', review, 2031, null, 102), '23514');
      assert.equal((await state(102)).state, 'pending');
      assert.equal(
        (
          await db.query(
            'SELECT count(*) AS n FROM app_private.synthetic_reference_transitions WHERE operation_id=$1',
            [id(2031)],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*) AS n FROM app_private.synthetic_reference_approved WHERE listing_id=$1',
            [id(102)],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'late approved-attribute failure rolls back revision, base snapshot, publication, receipt and audit together',
    async () => {
      await as(11, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [id(102)]),
      );
      const review = await snapshot(10, 102);
      await db.exec(
        "CREATE FUNCTION pg_temp.fail_reference_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic late snapshot failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER fail_reference_snapshot BEFORE INSERT ON app_private.synthetic_reference_approved FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_reference_snapshot();",
      );
      try {
        await fail(() => command(10, 'approve', review, 2032, null, 102), '23514');
        assert.deepEqual(await state(102), { state: 'pending', version: 4 });
        const listing = (
          await db.query(
            'SELECT version,published_revision_no,publication_status FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
            [id(1), id(102)],
          )
        ).rows[0];
        assert.deepEqual(listing, {
          version: 2,
          published_revision_no: null,
          publication_status: 'unpublished',
        });
        for (const table of ['public_snapshots', 'synthetic_reference_approved'])
          assert.equal(
            (
              await db.query(`SELECT count(*) AS n FROM app_private.${table} WHERE listing_id=$1`, [
                id(102),
              ])
            ).rows[0].n,
            0,
          );
        assert.equal(
          (
            await db.query(
              'SELECT count(*) AS n FROM app_private.synthetic_reference_transitions WHERE operation_id=$1',
              [id(2032)],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*) AS n FROM app_private.audit_events WHERE object_id=$1 AND action='revision.approved'",
              [id(102)],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await db.exec(
          'DROP TRIGGER fail_reference_snapshot ON app_private.synthetic_reference_approved;DROP FUNCTION pg_temp.fail_reference_snapshot();',
        );
      }
    },
  );
  await t.test(
    'withdraw/resubmit changes editorial currency; rejection requires exact reason and remains private',
    async () => {
      let r = await snapshot(11, 103);
      await command(11, 'submit', r, 2040, null, 103);
      const old = await snapshot(10, 103);
      const withdrawn = await command(11, 'withdraw', old, 2041, null, 103);
      assert.deepEqual(await command(11, 'withdraw', old, 2041, null, 103), withdrawn);
      assert.deepEqual(
        (
          await db.query(
            "SELECT tenant_id,actor_id,action,object_version::text,summary FROM app_private.audit_events WHERE object_id=$1 AND action IN ('revision.withdrawn','revision.synthetic_reference_withdraw') ORDER BY id",
            [id(103)],
          )
        ).rows,
        [
          {
            tenant_id: id(1),
            actor_id: id(11),
            action: 'revision.withdrawn',
            object_version: withdrawn.revisionVersion,
            summary: { revision: 1 },
          },
          {
            tenant_id: id(1),
            actor_id: id(11),
            action: 'revision.synthetic_reference_withdraw',
            object_version: withdrawn.revisionVersion,
            summary: { revision: 1, operationId: id(2041) },
          },
        ],
      );
      r = await snapshot(11, 103);
      await command(11, 'submit', r, 2042, null, 103);
      await fail(() => command(10, 'approve', old, 2043, null, 103), '40001');
      r = await snapshot(10, 103);
      await fail(() => command(10, 'reject', r, 2043, ' ', 103), '23514');
      const rejected = await command(10, 'reject', r, 2044, 'Synthetic evidence incomplete', 103);
      assert.equal(rejected.state, 'rejected');
      assert.deepEqual(
        await command(10, 'reject', r, 2044, 'Synthetic evidence incomplete', 103),
        rejected,
      );
      await assertTransitionAudit(
        103,
        10,
        'reject',
        'revision.rejected',
        2044,
        rejected.revisionVersion,
        { revision: 1, selfApproval: false },
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*) AS n FROM app_private.synthetic_reference_approved WHERE listing_id=$1',
            [id(103)],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'runtime cannot forge receipts/approved facts/settings and immutable owner receipts refuse edits',
    async () => {
      await fail(
        () =>
          as(11, async () => {
            await db.query("SELECT set_config('realtor.reference_review_enabled','true',true)");
            return db.query('SELECT app_api.withdraw_revision($1,1,4)', [id(102)]);
          }),
        '23514',
      );
      await fail(
        () => as(10, () => db.query('DELETE FROM app_private.synthetic_reference_transitions')),
        '42501',
      );
      await fail(
        () => as(10, () => db.query('SELECT * FROM app_private.synthetic_reference_approved')),
        '42501',
      );
      await fail(
        () => db.query('UPDATE app_private.synthetic_reference_transitions SET reason=reason'),
        '23514',
      );
      await fail(() => db.query('DELETE FROM app_private.synthetic_reference_approved'), '23514');
    },
  );
  await t.test(
    'unadopted legacy revisions retain submission/approval and public visibility with explicit absent references',
    async () => {
      await as(11, () =>
        seedGuardedListingDraft(db, {
          listingId: id(104),
          slug: 'synthetic-legacy-compatibility',
          content,
          actorId: id(11),
        }),
      );
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, { tenantId: id(1), listingId: id(104), position });
      await as(11, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [id(104)]),
      );
      await as(11, () => db.query('SELECT app_api.submit_revision($1,1,2)', [id(104)]));
      await as(10, () => db.query('SELECT app_api.decide_revision($1,1,3,true,NULL)', [id(104)]));
      const row = (
        await as(13, () =>
          db.query('SELECT * FROM app_api.public_listings_reference_v3 WHERE listing_id=$1', [
            id(104),
          ]),
        )
      ).rows[0];
      assert.equal(row.reference_attributes, null);
      assert.equal(row.reference_revision_version, null);
      assert.ok(!Object.hasOwn(row, 'private_address'));
    },
  );
  await t.test(
    'revocation and reassignment prevent original recovery and historical receipt replay',
    async () => {
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await fail(() => command(11, 'submit', draft, 2010), '42501');
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(12), id(1), id(100)],
      );
      await fail(() => command(11, 'submit', draft, 2010), 'P0002');
    },
  );
});

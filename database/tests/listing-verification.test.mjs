import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import {
  normalizeStaffDraftContentV2,
  planListingVerification,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  observed = '2026-01-01T00:00:00.000Z';
test('private synthetic verification ledger is current-admin scoped, atomic and append-only', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
      id(tenant),
      `synthetic-verification-${tenant}`,
    ]);
    for (const [user, role] of [
      [10, 'admin'],
      [11, 'admin'],
      [12, 'agent'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  async function as(tenant, user, work) {
    await db.exec('BEGIN; SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(tenant), id(user)],
      );
      const result = await work();
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  for (const [tenant, listing] of [
    [1, 100],
    [2, 200],
  ])
    await as(tenant, 10, () =>
      seedGuardedListingDraft(db, {
        listingId: id(listing),
        slug: `synthetic-check-${listing}`,
        actorId: id(10),
        content: normalizeStaffDraftContentV2({
          title: 'Synthetic verification draft',
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        }),
      }),
    );
  const target = { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' };
  const command = (operation, patch = {}) => ({
    operationId: id(operation),
    policy: 'synthetic-check-record-v1',
    target: { ...target },
    expectedVerificationVersion: '0',
    subject: 'advertising_authority',
    outcome: 'supported',
    evidenceReference: 'synthetic:authority-fixture',
    note: 'Synthetic evidence only.',
    observedAt: observed,
    ...patch,
  });
  const write = async (c) =>
    (
      await db.query(
        'SELECT app_api.record_synthetic_listing_verification($1::uuid,$2::uuid,$3::bigint,$4::integer,$5::bigint,$6::bigint,$7::text,$8::text,$9::text,$10::text,$11::text) AS receipt',
        [
          c.target.listingId,
          c.operationId,
          c.target.listingVersion,
          c.target.revision,
          c.target.revisionVersion,
          c.expectedVerificationVersion,
          c.subject,
          c.outcome,
          c.evidenceReference,
          c.note,
          c.observedAt,
        ],
      )
    ).rows[0].receipt;
  const recover = async (op, listing = 100) =>
    (
      await db.query('SELECT app_api.read_listing_verification($1,$2) AS receipt', [
        id(listing),
        id(op),
      ])
    ).rows[0].receipt;
  const history = async (limit = 20, listing = 100) =>
    (
      await db.query('SELECT app_api.read_listing_verification_history($1,$2) AS history', [
        id(listing),
        limit,
      ])
    ).rows[0].history;
  const count = async () => ({
    records: (
      await db.query('SELECT count(*)::int AS n FROM app_private.listing_verification_records')
    ).rows[0].n,
    operations: (
      await db.query('SELECT count(*)::int AS n FROM app_private.listing_verification_operations')
    ).rows[0].n,
    audits: (
      await db.query(
        "SELECT count(*)::int AS n FROM app_private.audit_events WHERE action='listing.synthetic_check_recorded'",
      )
    ).rows[0].n,
  });
  let first;
  await t.test(
    'normal record matches shared planner and changes no listing/revision/public data',
    async () => {
      const before = (
        await db.query('SELECT to_jsonb(l) AS listing FROM app_private.listings l WHERE id=$1', [
          id(100),
        ])
      ).rows;
      const revisions = (
        await db.query(
          'SELECT to_jsonb(r) AS revision FROM app_private.listing_revisions r WHERE listing_id=$1',
          [id(100)],
        )
      ).rows;
      first = await as(1, 10, () => write(command(300)));
      assert.equal(first.decision.outcome, 'recorded');
      const planned = planListingVerification(
        command(300),
        { target, verificationVersion: '0', lastRecordedAt: null },
        'admin',
        id(10),
        first.completedAt,
      );
      assert.deepEqual(first.decision.record, planned.record);
      assert.deepEqual(first.request, command(300));
      assert.deepEqual(await count(), { records: 1, operations: 1, audits: 1 });
      assert.deepEqual(
        (
          await db.query('SELECT to_jsonb(l) AS listing FROM app_private.listings l WHERE id=$1', [
            id(100),
          ])
        ).rows,
        before,
      );
      assert.deepEqual(
        (
          await db.query(
            'SELECT to_jsonb(r) AS revision FROM app_private.listing_revisions r WHERE listing_id=$1',
            [id(100)],
          )
        ).rows,
        revisions,
      );
      const audit = (
        await db.query(
          "SELECT summary FROM app_private.audit_events WHERE action='listing.synthetic_check_recorded'",
        )
      ).rows[0].summary;
      assert.equal(audit.operationId, id(300));
      assert.equal(Object.hasOwn(audit, 'note'), false);
    },
  );
  await t.test(
    'exact original replay/recovery survives later history without duplicate audit, changed facts/actor refuse',
    async () => {
      assert.deepEqual(await as(1, 10, () => write(command(300))), first);
      await as(1, 10, () =>
        write(
          command(301, {
            expectedVerificationVersion: '1',
            subject: 'identity',
            outcome: 'inconclusive',
            evidenceReference: null,
          }),
        ),
      );
      assert.deepEqual(await as(1, 10, () => recover(300)), first);
      assert.deepEqual(await as(1, 10, () => write(command(300))), first);
      assert.deepEqual(await count(), { records: 2, operations: 2, audits: 2 });
      await assert.rejects(
        as(1, 10, () => write(command(300, { note: 'Changed original.' }))),
        { code: '40001' },
      );
      await assert.rejects(
        as(1, 11, () => write(command(300))),
        { code: '40001' },
      );
      await assert.rejects(
        as(1, 11, () => recover(300)),
        { code: 'P0002' },
      );
    },
  );
  await t.test(
    'current admin/tenant/enabled company is required for writes, recovery and history',
    async () => {
      for (const [tenant, user] of [
        [1, 12],
        [2, 10],
      ]) {
        await assert.rejects(
          as(tenant, user, () => write(command(302))),
          { code: 'P0002' },
        );
        await assert.rejects(
          as(tenant, user, () => recover(300)),
          { code: 'P0002' },
        );
        await assert.rejects(
          as(tenant, user, () => history()),
          { code: 'P0002' },
        );
      }
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await assert.rejects(
        as(1, 10, () => recover(300)),
        { code: 'P0002' },
      );
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=null WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
      await assert.rejects(
        as(1, 10, () => history()),
        { code: 'P0002' },
      );
      await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [id(1)]);
      assert.deepEqual(await as(1, 10, () => recover(300)), first);
    },
  );
  await t.test(
    'target/history conflicts and future observation store stable refusal receipts without history mutation',
    async () => {
      const before = await count();
      for (const [op, c, reason] of [
        [
          303,
          command(303, {
            target: { ...target, revisionVersion: '1' },
            observedAt: '9999-01-01T00:00:00.000Z',
          }),
          'LISTING_CHANGED',
        ],
        [304, command(304), 'VERIFICATION_CHANGED'],
        [
          305,
          command(305, {
            expectedVerificationVersion: '2',
            observedAt: '9999-01-01T00:00:00.000Z',
          }),
          'OBSERVATION_IN_FUTURE',
        ],
      ]) {
        const receipt = await as(1, 10, () => write(c));
        assert.equal(receipt.decision.reason, reason);
        assert.equal(receipt.decision.record, null);
        assert.deepEqual(await as(1, 10, () => recover(op)), receipt);
      }
      const after = await count();
      assert.equal(after.records, before.records);
      assert.equal(after.audits, before.audits);
      assert.equal(after.operations, before.operations + 3);
    },
  );
  await t.test(
    'history is newest-first, bounded with honest lookahead and immutable record payloads',
    async () => {
      const h = await as(1, 11, () => history(1));
      assert.equal(h.verificationVersion, '2');
      assert.equal(h.records.length, 1);
      assert.equal(h.records[0].operationId, id(301));
      assert.equal(h.hasMore, true);
      const all = await as(1, 10, () => history(2));
      assert.deepEqual(
        all.records.map((x) => x.verificationVersion),
        ['2', '1'],
      );
      assert.equal(all.hasMore, false);
      await assert.rejects(
        db.query("UPDATE app_private.listing_verification_records SET note='Changed'"),
        { code: '23514' },
      );
      await assert.rejects(db.query('DELETE FROM app_private.listing_verification_operations'), {
        code: '23514',
      });
      await assert.rejects(
        as(1, 10, () => history(26)),
        { code: '23514' },
      );
    },
  );
  await t.test(
    'invalid facts fail before any ledger rows, and private tables/helpers are unavailable to runtime',
    async () => {
      const before = await count();
      for (const patch of [
        { note: '\u00a0Synthetic' },
        { note: 'x\u0085x' },
        { note: '🏡'.repeat(601) },
        { evidenceReference: 'https://private.invalid' },
        { evidenceReference: null },
        { expectedVerificationVersion: '9007199254740992' },
        { observedAt: '2026-02-30T00:00:00.000Z' },
        { observedAt: '0000-01-01T00:00:00.000Z' },
      ])
        await assert.rejects(
          as(1, 10, () => write(command(306, patch))),
          { code: '23514' },
        );
      assert.deepEqual(await count(), before);
      await assert.rejects(
        as(1, 10, () => db.query('SELECT * FROM app_private.listing_verification_records')),
        { code: '42501' },
      );
      await assert.rejects(
        as(1, 10, () =>
          db.query("SELECT app_private.listing_verification_note_valid('Synthetic')"),
        ),
        { code: '42501' },
      );
    },
  );
  await t.test(
    'forced audit insertion failure rolls back record, state and operation atomically',
    async () => {
      const before = await count();
      await db.exec(
        "CREATE FUNCTION public.fail_synthetic_verification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='listing.synthetic_check_recorded' THEN RAISE EXCEPTION 'synthetic audit failure';END IF;RETURN NEW;END $$;CREATE TRIGGER synthetic_verification_audit_failure BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_synthetic_verification_audit();",
      );
      await assert.rejects(
        as(1, 10, () => write(command(307, { expectedVerificationVersion: '2' }))),
        /synthetic audit failure/,
      );
      assert.deepEqual(await count(), before);
      assert.equal((await as(1, 10, () => history())).verificationVersion, '2');
      await db.exec(
        'DROP TRIGGER synthetic_verification_audit_failure ON app_private.audit_events;DROP FUNCTION public.fail_synthetic_verification_audit();',
      );
    },
  );
  await t.test(
    'fixed owner functions grant runtime only and retain fixed search paths',
    async () => {
      const rows = (
        await db.query(
          "SELECT p.proname,p.prosecdef,p.proconfig,r.rolname AS owner,has_function_privilege('api_runtime',p.oid,'EXECUTE') AS runtime,has_function_privilege('media_coordinator',p.oid,'EXECUTE') AS media,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='app_api' AND p.proname IN ('record_synthetic_listing_verification','read_listing_verification','read_listing_verification_history')",
        )
      ).rows;
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(row.prosecdef, true);
        assert.equal(row.owner, 'realtor_owner');
        assert.deepEqual(row.proconfig, ['search_path=pg_catalog']);
        assert.equal(row.runtime, true);
        assert.equal(row.media, false);
        assert.equal(row.public_execute, false);
      }
    },
  );
  await t.test(
    'defensive maximum history and regressing-clock boundaries refuse without a record',
    async () => {
      // Privileged boundary injection is rolled back; no fabricated history is retained.
      for (const [version, last, reason] of [
        ['9007199254740991', observed, 'VERSION_LIMIT'],
        ['2', '9999-01-01T00:00:00.000Z', 'RECORD_CLOCK_INVALID'],
      ]) {
        const before = await count();
        await db.exec('BEGIN');
        try {
          await db.query(
            'UPDATE app_private.listing_verification_state SET version=$1,last_recorded_at=$2 WHERE tenant_id=$3 AND listing_id=$4',
            [version, last, id(1), id(100)],
          );
          await db.exec('SET LOCAL ROLE api_runtime');
          await db.query(
            "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
            [id(1), id(10)],
          );
          const result = await write(command(308, { expectedVerificationVersion: version }));
          assert.equal(result.decision.reason, reason);
          assert.equal(result.decision.record, null);
        } finally {
          await db.exec('ROLLBACK');
        }
        assert.deepEqual(await count(), before);
      }
    },
  );
  await t.test(
    'original recovery and replay remain historical after a normal later listing change',
    async () => {
      await as(1, 10, () =>
        db.query("SELECT app_api.control_listing($1,$2,'confirm_availability',1,'reserved')", [
          id(100),
          id(309),
        ]),
      );
      const before = await count();
      assert.deepEqual(await as(1, 10, () => recover(300)), first);
      assert.deepEqual(await as(1, 10, () => write(command(300))), first);
      assert.deepEqual(await count(), before);
      assert.equal((await as(1, 10, () => history())).records[1].target.listingVersion, '1');
    },
  );
});

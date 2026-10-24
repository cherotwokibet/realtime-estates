import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { applyReferenceCandidate } from '../test-helpers/reference-activation-candidate.mjs';
import {
  withReferenceDeploymentAdmission,
  referenceDeploymentProtocols,
} from '../reference-deployment-admission.mjs';
import {
  id,
  command,
  catalogue,
} from '../../packages/api-client/tests/fixtures/reference-creation.mjs';
const off = () =>
  Object.fromEntries(Object.keys(referenceDeploymentProtocols).map((key) => [key, null]));
test('owner admission refuses capability rollback after real synthetic adoption and preserves every original', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  let activated = 0;
  const activate = () => {
    activated++;
  };
  const empty = await withReferenceDeploymentAdmission(db, off(), activate);
  assert.equal(empty.adopted, false);
  assert.equal(activated, 1);
  await applyReferenceCandidate(db);
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(catalogue()),
  ]);
  const catalogueOnly = await withReferenceDeploymentAdmission(db, off(), activate);
  assert.equal(catalogueOnly.adopted, false);
  await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
    id(1),
    'synthetic-admission',
  ]);
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,'agent')",
    [id(1), id(11)],
  );
  const c = command();
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
  await db.query(
    "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
    [id(1), id(11)],
  );
  const original = (
    await db.query(
      'SELECT app_api.create_synthetic_reference_listing($1,$2,$3,$4::jsonb,$5::jsonb) AS receipt',
      [c.listingId, c.operationId, c.slug, JSON.stringify(c.content), JSON.stringify(c.selection)],
    )
  ).rows[0].receipt;
  await db.exec('COMMIT');
  const snapshot = async () =>
    (
      await db.query(
        'SELECT (SELECT jsonb_agg(to_jsonb(r)) FROM app_private.synthetic_reference_draft_receipts r) AS drafts,(SELECT jsonb_agg(to_jsonb(r)) FROM app_private.synthetic_reference_creation_receipts r) AS creations,(SELECT jsonb_agg(to_jsonb(r)) FROM app_private.listing_revisions r) AS revisions',
      )
    ).rows[0];
  const before = await snapshot(),
    start = activated;
  await t.test(
    'each required reader/editor/original capability is mandatory and denial never activates',
    async () => {
      for (const key of ['editor', 'revisionReader', 'draftRecovery', 'creationRecovery']) {
        const incomplete = { ...referenceDeploymentProtocols, [key]: null };
        await assert.rejects(
          withReferenceDeploymentAdmission(db, incomplete, activate),
          /rollback refused/,
        );
        assert.equal(activated, start);
        assert.deepEqual(await snapshot(), before);
      }
    },
  );
  await t.test(
    'compatible artifact callback runs inside held fence and yields no private rows',
    async () => {
      const calls = [],
        connection = {
          query: async (sql, args) => {
            calls.push(sql);
            return db.query(sql, args);
          },
        };
      const decision = await withReferenceDeploymentAdmission(
        connection,
        { ...referenceDeploymentProtocols },
        async (d) => {
          calls.push('ACTIVATE');
          assert.equal(d.adopted, true);
          assert.deepEqual(d.required, [
            'creationRecovery',
            'draftRecovery',
            'editor',
            'revisionReader',
          ]);
          assert.ok(Object.isFrozen(d.required));
          assert.ok(!JSON.stringify(d).includes(c.content.privateAddress));
        },
      );
      assert.equal(decision.adopted, true);
      assert.ok(calls.indexOf('ACTIVATE') > calls.findIndex((s) => s.startsWith('LOCK TABLE')));
      assert.ok(calls.indexOf('COMMIT') > calls.indexOf('ACTIVATE'));
      assert.deepEqual(await snapshot(), before);
    },
  );
  await t.test(
    'activation failure rolls back/releases transaction without changing saved facts or receipt',
    async () => {
      await assert.rejects(
        withReferenceDeploymentAdmission(db, { ...referenceDeploymentProtocols }, () => {
          throw Error('Synthetic activation failed');
        }),
        /Synthetic activation failed/,
      );
      assert.deepEqual(await snapshot(), before);
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(1), id(11)],
      );
      assert.deepEqual(
        (
          await db.query('SELECT app_api.read_synthetic_reference_creation($1,$2) AS receipt', [
            c.listingId,
            c.operationId,
          ])
        ).rows[0].receipt,
        original,
      );
      await db.exec('COMMIT');
    },
  );
  await t.test('runtime role cannot use owner admission even with all capabilities', async () => {
    await db.exec('SET ROLE api_runtime');
    await assert.rejects(
      withReferenceDeploymentAdmission(db, { ...referenceDeploymentProtocols }, activate),
      /owner authority/,
    );
    await db.exec('RESET ROLE');
    assert.equal(activated, start);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test(
    'capabilities snapshot rejects getters, unknown protocols and sparse/extra fields before SQL',
    async () => {
      let calls = 0;
      const connection = {
        query: () => {
          calls++;
          throw Error('Must not query');
        },
      };
      for (const bad of [
        { ...off(), editor: true },
        { ...off(), extra: null },
        { ...off(), revisionReader: undefined },
        Object.defineProperty({ ...off() }, 'editor', {
          enumerable: true,
          get() {
            throw Error('Getter must never run');
          },
        }),
      ])
        await assert.rejects(
          withReferenceDeploymentAdmission(connection, bad, activate),
          /Invalid deployment capabilities/,
        );
      assert.equal(calls, 0);
    },
  );
  await t.test(
    'missing schema or recovery execute grant refuses activation and preserves originals',
    async () => {
      await db.exec(
        'ALTER TABLE app_private.synthetic_reference_catalogues RENAME TO synthetic_reference_catalogues_held',
      );
      try {
        await assert.rejects(
          withReferenceDeploymentAdmission(db, { ...referenceDeploymentProtocols }, activate),
          /Partial reference schema/,
        );
      } finally {
        await db.exec(
          'ALTER TABLE app_private.synthetic_reference_catalogues_held RENAME TO synthetic_reference_catalogues',
        );
      }
      await db.exec(
        'REVOKE EXECUTE ON FUNCTION app_api.read_synthetic_reference_creation(uuid,uuid) FROM api_runtime',
      );
      try {
        await assert.rejects(
          withReferenceDeploymentAdmission(db, { ...referenceDeploymentProtocols }, activate),
          /routine unavailable/,
        );
      } finally {
        await db.exec(
          'GRANT EXECUTE ON FUNCTION app_api.read_synthetic_reference_creation(uuid,uuid) TO api_runtime',
        );
      }
      assert.equal(activated, start);
      assert.deepEqual(await snapshot(), before);
    },
  );
});

test('historical transition/approved/successor policy requires their recovery capabilities and snapshots config before awaits', async () => {
  let activate = 0;
  const calls = [];
  const connection = {
    query: async (sql, args) => {
      calls.push(sql);
      if (sql.startsWith('SELECT current_user')) return { rows: [{ owner: true }] };
      if (sql.includes('information_schema.columns')) return { rows: [{ attributes: true }] };
      if (sql === 'SELECT to_regclass($1) IS NOT NULL AS present')
        return { rows: [{ present: true }] };
      if (sql.includes(' AS occupied')) return { rows: [{ occupied: true }] };
      if (sql.includes(' AS available')) return { rows: [{ available: true }] };
      return { rows: [] };
    },
  };
  for (const key of ['transitionRecovery', 'publicReader', 'successorRecovery'])
    await assert.rejects(
      withReferenceDeploymentAdmission(
        connection,
        { ...referenceDeploymentProtocols, [key]: null },
        () => {
          activate++;
        },
      ),
      /rollback refused/,
    );
  assert.equal(activate, 0);
  const offered = { ...referenceDeploymentProtocols };
  let first = true;
  const changing = {
    query: async (sql, args) => {
      if (first) {
        first = false;
        offered.editor = null;
      }
      return connection.query(sql, args);
    },
  };
  const decision = await withReferenceDeploymentAdmission(changing, offered, () => {
    activate++;
  });
  assert.equal(activate, 1);
  assert.deepEqual(decision.required, Object.keys(referenceDeploymentProtocols).sort());
  assert.equal(offered.editor, null);
  assert.ok(calls.includes('BEGIN ISOLATION LEVEL READ COMMITTED'));
});

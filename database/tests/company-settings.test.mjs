import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  PEER = id(11),
  AGENT = id(12),
  CUSTOMER = id(13),
  FOREIGN = id(20);
const content = {
  companyName: 'Synthetic Agency',
  summary: 'Synthetic approved summary.',
  about: 'Fictional company content for local verification only.',
  officeAddress: null,
  openingHours: 'Monday to Friday,09:00–17:00',
  colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
};
const command = (op = 100, expected = '0', c = content) => ({
  policy: 'company-settings-command-v1',
  operationId: id(op),
  expectedVersion: expected,
  content: c,
  approval: 'approved-for-publication',
});
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'settings-a','Synthetic A'),($2,'settings-b','Synthetic B')",
    [T, OTHER],
  );
  for (const [t, a, r] of [
    [T, ADMIN, 'admin'],
    [T, PEER, 'admin'],
    [T, AGENT, 'agent'],
    [T, CUSTOMER, 'customer'],
    [OTHER, FOREIGN, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      t,
      a,
      r,
    ]);
  return db;
}
async function actor(db, t, a, fn) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
  await db.query(
    "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','settings-test',true)",
    [t, a ?? ''],
  );
  try {
    const r = await fn();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
const call = async (db, name, values = []) =>
  (
    await db.query(
      `SELECT app_api.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) AS result`,
      values,
    )
  ).rows[0].result;
const save = (db, c = command()) => call(db, 'approve_company_settings', [JSON.stringify(c)]);
const denies = (fn, code = '42501') => assert.rejects(fn, (e) => e.code === code);
test('settings approval, current public projection, immutable history and bounded original recovery', async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await actor(db, T, ADMIN, () => call(db, 'read_company_settings')), {
      policy: 'company-settings-state-v1',
      version: '0',
      current: null,
      history: [],
      hasMore: false,
    });
    assert.equal(await actor(db, T, null, () => call(db, 'read_public_company_settings')), null);
    const first = await actor(db, T, ADMIN, () => save(db));
    assert.equal(first.version, '1');
    assert.equal(first.actorId, ADMIN);
    assert.deepEqual(first.request, command());
    const second = await actor(db, T, ADMIN, () =>
      save(db, command(101, '1', { ...content, companyName: 'Second approved name' })),
    );
    assert.equal(second.version, '2');
    assert.deepEqual(
      await actor(db, T, ADMIN, () => save(db)),
      first,
      'old replay returns original record after later edits',
    );
    assert.deepEqual(
      await actor(db, T, ADMIN, () => call(db, 'read_company_settings_operation', [id(100)])),
      first,
    );
    const state = await actor(db, T, ADMIN, () => call(db, 'read_company_settings'));
    assert.equal(state.version, '2');
    assert.deepEqual(
      state.history.map((r) => r.version),
      ['2', '1'],
    );
    assert.equal(state.current.companyName, 'Second approved name');
    const pub = await actor(db, T, null, () => call(db, 'read_public_company_settings'));
    assert.equal(pub.companyName, 'Second approved name');
    assert.deepEqual(Object.keys(pub).sort(), Object.keys(content).sort());
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM app_private.audit_events WHERE action='company.settings.approved'",
        )
      ).rows[0].n,
      2,
    );
    await denies(
      () => db.query('UPDATE app_private.company_settings_records SET recorded_at=now()'),
      '23514',
    );
    await denies(() => db.query('DELETE FROM app_private.company_settings_records'), '23514');
  } finally {
    await db.close();
  }
});
test('settings current permission and tenant fences protect writes, reads and retained receipts', async () => {
  const db = await fixture();
  try {
    await actor(db, T, ADMIN, () => save(db));
    for (const a of [null, AGENT, CUSTOMER, FOREIGN])
      for (const fn of [
        () => call(db, 'read_company_settings'),
        () => save(db),
        () => call(db, 'read_company_settings_operation', [id(100)]),
      ])
        await denies(() => actor(db, T, a, fn));
    await denies(() => actor(db, T, PEER, () => save(db)));
    await denies(
      () => actor(db, T, PEER, () => call(db, 'read_company_settings_operation', [id(100)])),
      'P0002',
    );
    assert.equal(
      (await actor(db, OTHER, FOREIGN, () => call(db, 'read_company_settings'))).version,
      '0',
    );
    await denies(
      () => actor(db, OTHER, FOREIGN, () => call(db, 'read_company_settings_operation', [id(100)])),
      'P0002',
    );
    await denies(() =>
      actor(db, T, ADMIN, () => db.query('SELECT * FROM app_private.company_settings_records')),
    );
    await denies(() => actor(db, T, ADMIN, () => call(db, 'read_public_company_settings')));
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await denies(() => actor(db, T, ADMIN, () => save(db)));
    await denies(() =>
      actor(db, T, ADMIN, () => call(db, 'read_company_settings_operation', [id(100)])),
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    assert.equal(await actor(db, T, null, () => call(db, 'read_public_company_settings')), null);
    await denies(() => actor(db, T, PEER, () => call(db, 'read_company_settings')));
  } finally {
    await db.close();
  }
});
test('settings reject stale, changed replay, empty/noop, caller authority and unsafe public values atomically', async () => {
  const db = await fixture();
  try {
    await actor(db, T, ADMIN, () => save(db));
    await denies(() => actor(db, T, ADMIN, () => save(db, command(101, '0'))), '40001');
    await denies(
      () =>
        actor(db, T, ADMIN, () =>
          save(db, command(100, '0', { ...content, companyName: 'Changed original' })),
        ),
      '40001',
    );
    const bad = [
      { ...command(102, '1'), tenantId: OTHER },
      { ...command(102, '1'), approval: 'pending' },
      { ...command(102, '1'), expectedVersion: 1 },
      command(102, '01'),
      command(102, '9007199254740991'),
      command(102, '1'),
      command(102, '1', { ...content, companyName: '<script>' }),
      command(102, '1', { ...content, about: '' }),
      command(102, '1', { ...content, colors: { ...content.colors, primary: 'red' } }),
      command(102, '1', { ...content, modules: { payments: true } }),
      command(102, '1', { ...content, contact: { email: 'extra@example.test' } }),
    ];
    for (const c of bad) await denies(() => actor(db, T, ADMIN, () => save(db, c)), '23514');
    assert.equal((await actor(db, T, ADMIN, () => call(db, 'read_company_settings'))).version, '1');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM app_private.company_settings_records'))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test('settings history retains all records and advertises a bounded latest page', async () => {
  const db = await fixture();
  try {
    for (let n = 0; n < 22; n++)
      await actor(db, T, ADMIN, () =>
        save(db, command(100 + n, String(n), { ...content, companyName: 'Synthetic agency ' + n })),
      );
    const state = await actor(db, T, ADMIN, () => call(db, 'read_company_settings'));
    assert.equal(state.version, '22');
    assert.equal(state.history.length, 20);
    assert.equal(state.history.at(-1).version, '3');
    assert.equal(state.hasMore, true);
    assert.equal(
      (await actor(db, T, ADMIN, () => call(db, 'read_company_settings_operation', [id(100)])))
        .version,
      '1',
    );
  } finally {
    await db.close();
  }
});

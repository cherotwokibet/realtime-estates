import { startAdminCommandFixture } from './admin-command-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixture,
  asActor,
  T,
  OTHER,
  ADMIN,
  AGENT,
} from '../../../database/tests/public-media-fixtures.mjs';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const content = {
  companyName: 'Synthetic audited agency',
  summary: 'Synthetic public summary.',
  about: 'Independently generated settings for local verification.',
  officeAddress: null,
  openingHours: 'Monday to Friday',
  colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
};
const command = (operation = 9000, expected = '0') => ({
  policy: 'company-settings-command-v1',
  operationId: id(operation),
  expectedVersion: expected,
  content: { ...content },
  approval: 'approved-for-publication',
});
async function state(db) {
  return {
    records: (
      await db.query(
        'SELECT * FROM app_private.company_settings_records ORDER BY tenant_id,version',
      )
    ).rows,
    audit: (await db.query('SELECT * FROM app_private.audit_events ORDER BY id')).rows,
  };
}
async function status(response, expected) {
  assert.equal(response.status, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return response.json();
}

test('signed settings approval records exact actor/company/version/request correlation once across replay and original reads', async () => {
  const f = await startAdminCommandFixture();
  try {
    const c = command(),
      r = await f.request({ value: c }),
      correlation = r.headers.get('x-request-id');
    const first = await status(r, 200);
    assert.equal(first.version, '1');
    assert.equal(first.actorId, ADMIN);
    assert.deepEqual(first.request, c);
    assert.deepEqual(await status(await f.request({ value: c }), 200), first);
    assert.deepEqual(await status(await f.request(), 200), first);
    const audit = (
      await f.db.query(
        'SELECT tenant_id,actor_id,action,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events',
      )
    ).rows;
    assert.deepEqual(audit, [
      {
        tenant_id: T,
        actor_id: ADMIN,
        action: 'company.settings.approved',
        object_type: 'company',
        object_id: T,
        object_version: '1',
        correlation_id: correlation,
        summary: { operationId: c.operationId, approval: c.approval },
      },
    ]);
    const before = await state(f.db);
    await status(await f.request({ subject: id(15) }), 404);
    await status(await f.request({ subject: id(15), value: c }), 403);
    await status(await f.request({ origin: 1 }), 403);
    await status(
      await f.request({
        value: { ...c, content: { ...c.content, companyName: 'Changed replay' } },
      }),
      409,
    );
    await status(await f.request({ operation: 9001, value: command(9001, '0') }), 409);
    await status(await f.request({ operation: 9002, value: command(9002, '1') }), 422);
    assert.deepEqual(await state(f.db), before);
  } finally {
    await f.close();
  }
});
test('signed settings API rejects current role/company and malformed authority before any settings or audit mutation', async () => {
  const f = await startAdminCommandFixture();
  try {
    const c = command(),
      before = await state(f.db);
    for (const subject of [AGENT, id(13), id(20)])
      await status(await f.request({ subject, value: c }), 403);
    await status(await f.request({ subject: null, value: c }), 401);
    const parts = (await f.token()).split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    await status(
      await f.request({ value: c, headers: { authorization: 'Bearer ' + parts.join('.') } }),
      401,
    );
    for (const headers of [
      { 'x-role': 'admin' },
      { 'x-tenant-id': T },
      { cookie: 'session=synthetic' },
    ])
      await status(await f.request({ value: c, headers }), 400);
    await status(await f.request({ value: { ...c, actorId: ADMIN } }), 400);
    await status(await f.request({ value: { ...c, operationId: id(9001) } }), 400);
    await status(await f.request({ method: 'POST', raw: '{"policy":"x","policy":"y"}' }), 400);
    await status(await f.request({ method: 'POST', raw: ' '.repeat(32769) }), 413);
    await f.db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await status(await f.request({ value: c }), 403);
    await f.db.query(
      "UPDATE app_private.memberships SET role='admin',active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await status(await f.request({ value: c }), 403);
    await f.db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await status(await f.request({ value: c }), 403);
    assert.deepEqual(await state(f.db), before);
  } finally {
    await f.close();
  }
});
test('audit insertion failure rolls back the actual HTTP approval and original identity; later explicit retry records one event', async () => {
  const f = await startAdminCommandFixture();
  try {
    await f.db
      .exec(`CREATE FUNCTION app_private.synthetic_reject_settings_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'PRIVATE AUDIT FAILURE SENTINEL';END $$;
   CREATE TRIGGER synthetic_reject_settings_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.synthetic_reject_settings_audit();`);
    const c = command(),
      before = await state(f.db),
      r = await f.request({ value: c });
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /PRIVATE|SENTINEL|synthetic_reject/);
    assert.deepEqual(await state(f.db), before);
    await status(await f.request(), 404);
    const current = await asActor(f.db, T, ADMIN, () =>
      f.db.query('SELECT app_api.read_company_settings() AS state'),
    );
    assert.equal(current.rows[0].state.version, '0');
    assert.equal(current.rows[0].state.current, null);
    await f.db.exec(
      'DROP TRIGGER synthetic_reject_settings_audit ON app_private.audit_events;DROP FUNCTION app_private.synthetic_reject_settings_audit();',
    );
    await status(await f.request({ value: c }), 200);
    assert.equal((await state(f.db)).audit.length, 1);
    assert.equal((await state(f.db)).records.length, 1);
  } finally {
    await f.close();
  }
});

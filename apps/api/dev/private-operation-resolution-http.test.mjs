import test from 'node:test';
import assert from 'node:assert/strict';
import { startAdminCommandFixture } from './admin-command-fixtures.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import { ADMIN, AGENT, T } from '../../../database/tests/public-media-fixtures.mjs';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const command = (op) => ({
  policy: 'company-settings-command-v1',
  operationId: id(op),
  expectedVersion: '0',
  approval: 'approved-for-publication',
  content: {
    companyName: 'Synthetic agency',
    summary: 'Fictional summary',
    about: 'Original content',
    officeAddress: null,
    openingHours: null,
    colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
  },
});
test('signed HTTP resolution returns exact committed receipts or permanent retirement, denies stale writes and refuses caller authority/current permission loss', async () => {
  const f = await startAdminCommandFixture();
  try {
    const token = await f.token(),
      api = new RealtorApiClient({
        baseUrl: f.origins[0],
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'synthetic-v1',
      }),
      options = { bearerToken: token };
    const original = command(9000),
      saved = await (await f.request({ value: original })).json();
    const completed = await api.resolvePrivateOperation('settings', original, options);
    assert.equal(completed.outcome, 'completed');
    assert.deepEqual(completed.receipt, saved);
    assert.equal(completed.tenantId, T);
    assert.equal(completed.actorId, ADMIN);
    assert.deepEqual(await api.resolvePrivateOperation('settings', original, options), completed);
    const unapplied = command(9001),
      cancelled = await api.resolvePrivateOperation('settings', unapplied, options);
    assert.equal(cancelled.outcome, 'cancelled');
    assert.equal(cancelled.receipt, null);
    assert.deepEqual(await api.resolvePrivateOperation('settings', unapplied, options), cancelled);
    assert.equal((await f.request({ operation: 9001, value: unapplied })).status, 409);
    const path = '/v2/staff/private-operations/settings/' + unapplied.operationId + '/resolve';
    for (const [status, patch] of [
      [400, { suffix: '?actor=foreign' }],
      [400, { headers: { 'x-role': 'admin' } }],
      [400, { headers: { cookie: 'forged' } }],
      [
        400,
        {
          raw: JSON.stringify(unapplied).replace(
            '"expectedVersion":',
            '"expectedVersion":"0","expectedVersion":',
          ),
        },
      ],
      [400, { raw: JSON.stringify({ ...unapplied, operationId: id(9002) }) }],
      [403, { bearer: await f.token(AGENT) }],
      [403, { bearer: await f.token(id(15)) }],
      [403, { origin: 1 }],
    ]) {
      const response = await fetch(f.origins[patch.origin ?? 0] + path + (patch.suffix ?? ''), {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + (patch.bearer ?? token),
          'content-type': 'application/json',
          ...patch.headers,
        },
        body: patch.raw ?? JSON.stringify(unapplied),
      });
      assert.equal(response.status, status);
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    assert.equal(
      (await fetch(f.origins[0] + path, { headers: { authorization: 'Bearer ' + token } })).status,
      405,
    );
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await assert.rejects(
      api.resolvePrivateOperation('settings', unapplied, options),
      (e) => e.status === 403,
    );
  } finally {
    await f.close();
  }
});

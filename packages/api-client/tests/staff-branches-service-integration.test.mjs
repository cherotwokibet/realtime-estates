import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
const mode = {
  port: 0,
  seedAcceptedMedia: false,
  staffInvitationMode: 'synthetic-capture-only-v1',
};
const command = () => ({
  policy: 'staff-branch-command-v1',
  operationId: randomUUID(),
  branchId: randomUUID(),
  expectedVersion: '0',
  name: 'Synthetic branch',
  active: true,
  reason: 'Synthetic branch creation.',
});
const request = (p, path, body, extra = {}) =>
  fetch(p.origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + p.bearerToken,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
test('signed branch HTTP saves/replays/reads original/current with terminal conflict/no-op and directory reflection', async () => {
  const p = await startStaffPreview({ ...mode, actor: 'admin' });
  try {
    const c = command(),
      path = '/v2/staff/branches/operations/' + c.operationId;
    let r = await request(p, path, c);
    assert.equal(r.status, 200);
    const first = await r.json();
    assert.equal(first.outcome, 'applied');
    assert.equal(first.version, '1');
    assert.deepEqual(await (await request(p, path, c)).json(), first);
    assert.deepEqual(await (await request(p, path)).json(), first);
    const current = '/v2/staff/branches/' + c.branchId;
    let state = await (await request(p, current)).json();
    assert.equal(state.version, '1');
    assert.equal(state.name, c.name);
    assert.equal(Object.hasOwn(state, 'actorId'), false);
    assert.equal(Object.hasOwn(state, 'reason'), false);
    const future = { ...c, operationId: randomUUID(), expectedVersion: '2' };
    const futurePath = '/v2/staff/branches/operations/' + future.operationId;
    const conflict = await (await request(p, futurePath, future)).json();
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.version, '1');
    const change = {
      ...c,
      operationId: randomUUID(),
      expectedVersion: '1',
      name: 'Renamed',
      active: false,
    };
    const changed = await (
      await request(p, '/v2/staff/branches/operations/' + change.operationId, change)
    ).json();
    assert.equal(changed.version, '2');
    assert.equal(changed.outcome, 'applied');
    assert.deepEqual(await (await request(p, futurePath, future)).json(), conflict);
    const noop = { ...change, operationId: randomUUID(), expectedVersion: '2' };
    assert.equal(
      (await (await request(p, '/v2/staff/branches/operations/' + noop.operationId, noop)).json())
        .outcome,
      'unchanged',
    );
    state = await (await request(p, current)).json();
    assert.equal(state.active, false);
    assert.equal(state.version, '2');
    assert.deepEqual(await (await request(p, path)).json(), first);
    const page = await (await request(p, '/v2/staff/branches?limit=2')).json();
    assert.equal(page.items.length, 1);
    assert.deepEqual(page.items[0], state);
    assert.equal((await request(p, path, { ...c, name: 'Changed original' })).status, 409);
    assert.equal((await request(p, path + '?tenant=bad')).status, 400);
    assert.equal((await request(p, path, c, { 'x-actor-id': randomUUID() })).status, 400);
    assert.equal((await request(p, path, { ...c, operationId: randomUUID() })).status, 400);
    assert.equal(
      (await request(p, path, undefined, { Authorization: 'Bearer ' + p.bearerToken + 'x' }))
        .status,
      401,
    );
  } finally {
    await p.close();
  }
});
test('signed branch writes/current/original reads reject agent and foreign-company actors', async () => {
  for (const actor of ['agent', 'other-company-admin']) {
    const p = await startStaffPreview({ ...mode, actor });
    try {
      const c = command(),
        path = '/v2/staff/branches/operations/' + c.operationId;
      for (const [url, body] of [
        [path, c],
        [path, undefined],
        ['/v2/staff/branches/' + c.branchId, undefined],
      ])
        assert.equal((await request(p, url, body)).status, 403);
    } finally {
      await p.close();
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
import {
  prepareStaffWrite,
  markStaffWriteUncertain,
  resolveStaffWrite,
  serializeStaffWrite,
  restoreStaffWrite,
} from '../dist/tests/lib/staff-write-attempt.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(1), tenantId: id(2), actorId: id(3) };
const command = () => ({
  policy: 'staff-membership-command-v1',
  operationId: id(5),
  memberId: id(4),
  expectedVersion: '1',
  requestedRole: 'agent',
  active: false,
  reason: 'Synthetic access removal.',
});
const receipt = () => ({
  ...command(),
  policy: 'staff-membership-record-v1',
  actorId: scope.actorId,
  version: '2',
  outcome: 'applied',
  recordedAt: '2026-11-02T12:00:00.000Z',
});
const member = (n = 4) => ({
  policy: 'staff-membership-current-v1',
  memberId: id(n),
  role: 'agent',
  active: false,
  version: '2',
  revokedAt: '2026-11-02T12:00:00.000Z',
});
const page = () => ({
  policy: 'staff-membership-page-v1',
  items: [member(4), member(6)],
  nextAfter: id(6),
});
const store = () => {
  const values = new Map();
  let writes = 0,
    removals = 0;
  return {
    values,
    get writes() {
      return writes;
    },
    get removals() {
      return removals;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes++;
      values.set(key, value);
    },
    removeItem(key) {
      removals++;
      values.delete(key);
    },
  };
};

test('membership attempts snapshot exact facts, refuse self changes, bind current actor and restore only to original recovery', () => {
  const input = command(),
    captured = { ...scope },
    attempt = prepareStaffWrite(captured, 'membership', input);
  input.active = true;
  input.requestedRole = 'admin';
  captured.actorId = id(9);
  assert.deepEqual(attempt.command, command());
  assert.equal(attempt.scope.actorId, scope.actorId);
  assert.equal(Object.isFrozen(attempt.command), true);
  const uncertain = markStaffWriteUncertain(attempt, scope),
    resolved = resolveStaffWrite(uncertain, scope, receipt());
  assert.equal(resolved.phase, 'resolved');
  const text = serializeStaffWrite(resolved),
    restored = restoreStaffWrite(text, scope);
  assert.equal(restored.phase, 'uncertain');
  assert.equal(restored.receipt, null);
  assert.equal(text.includes('recordedAt'), false);
  assert.equal(text.includes('staff-membership-record-v1'), false);
  for (const patch of [
    { actorId: id(8) },
    { memberId: id(9) },
    { requestedRole: 'admin' },
    { active: true },
    { reason: 'Changed original.' },
    { expectedVersion: '2', version: '3' },
  ])
    assert.throws(() => resolveStaffWrite(uncertain, scope, { ...receipt(), ...patch }));
  for (const field of ['instanceId', 'tenantId', 'actorId'])
    assert.throws(() => restoreStaffWrite(text, { ...scope, [field]: id(8) }));
  assert.throws(() =>
    prepareStaffWrite(scope, 'membership', { ...command(), memberId: scope.actorId }),
  );
});

test('membership controller persists before dispatch, locks every replacement and recovers an uncertain write by GET only', async () => {
  const storage = store(),
    calls = [];
  const client = createStaffDirectoryClient(
    { instanceId: scope.instanceId },
    async (path, init) => {
      const retained = JSON.parse([...storage.values.values()][0]);
      assert.equal(retained.kind, 'membership');
      assert.deepEqual(retained.command, command());
      calls.push({ path, init });
      if (init.method === 'POST') throw Error('Synthetic lost reply.');
      return Response.json({ receipt: receipt() });
    },
  );
  const controller = createStaffWriteController({ scope, store: storage, client });
  controller.prepare('membership', command());
  await assert.rejects(() => controller.submit());
  assert.equal(controller.snapshot().attempt.phase, 'uncertain');
  assert.equal(controller.snapshot().canNavigate, false);
  assert.throws(() => controller.clear());
  assert.throws(() => controller.prepare('membership', { ...command(), operationId: id(9) }));
  assert.throws(() => controller.prepare('branch', {}));
  assert.throws(() => controller.prepare('invitation', {}));
  assert.throws(() => controller.prepare('revocation', {}));
  assert.equal(storage.removals, 0);
  await controller.recover();
  assert.equal(controller.snapshot().attempt.phase, 'resolved');
  assert.deepEqual(
    calls.map(({ init }) => init.method),
    ['POST', 'GET'],
  );
  assert.equal(
    calls[1].path,
    '/api/staff-directory/memberships/operations/' + command().operationId,
  );
  assert.equal(calls[1].init.body, undefined);
  controller.clear();
  assert.equal(storage.removals, 1);
  assert.equal(storage.values.size, 0);
});

test('restored membership requests cannot submit anew, and deliberate exact replay cannot replace retained facts', async () => {
  const storage = store(),
    calls = [];
  let controller = createStaffWriteController({ scope, store: storage, client: {} });
  controller.prepare('membership', command());
  controller.close();
  const client = createStaffDirectoryClient(
    { instanceId: scope.instanceId },
    async (path, init) => {
      calls.push({ path, init });
      return Response.json({ receipt: receipt() });
    },
  );
  controller = createStaffWriteController({ scope, store: storage, client });
  assert.equal(controller.snapshot().attempt.phase, 'uncertain');
  await assert.rejects(() => controller.submit());
  assert.throws(() => controller.replay(false));
  assert.equal(calls.length, 0);
  await controller.replay(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  assert.equal(controller.snapshot().attempt.phase, 'resolved');
});

test('membership role loss and wrong-actor originals remain retained without deletion or replacement', async () => {
  for (const mode of ['denied', 'wrong-actor']) {
    const storage = store(),
      methods = [];
    const client = createStaffDirectoryClient(
      { instanceId: scope.instanceId },
      async (_path, init) => {
        methods.push(init.method);
        if (init.method === 'POST') throw Error('Lost original response.');
        return mode === 'denied'
          ? Response.json({ error: 'STAFF_MEMBERSHIP_UNAVAILABLE' }, { status: 403 })
          : Response.json({ receipt: { ...receipt(), actorId: id(8) } });
      },
    );
    const controller = createStaffWriteController({ scope, store: storage, client });
    controller.prepare('membership', command());
    await assert.rejects(() => controller.submit());
    await assert.rejects(() => controller.recover());
    assert.equal(controller.snapshot().attempt.phase, 'uncertain');
    assert.deepEqual(controller.snapshot().attempt.command, command());
    assert.equal(controller.snapshot().canNavigate, false);
    assert.throws(() => controller.clear());
    assert.throws(() => controller.prepare('membership', { ...command(), operationId: id(9) }));
    assert.equal(storage.removals, 0);
    assert.equal(storage.values.size, 1);
    assert.deepEqual(methods, ['POST', 'GET']);
  }
});

test('self-target and unavailable persistence refuse membership dispatch before any write can start', async () => {
  const storage = store();
  let calls = 0;
  const client = {
    saveMembership: async () => {
      calls++;
      return receipt();
    },
  };
  const controller = createStaffWriteController({ scope, store: storage, client });
  assert.throws(() => controller.prepare('membership', { ...command(), memberId: scope.actorId }));
  assert.equal(storage.writes, 0);
  assert.equal(storage.values.size, 0);
  const failed = createStaffWriteController({
    scope,
    store: {
      getItem: () => null,
      setItem: () => {
        throw Error('Storage unavailable.');
      },
      removeItem() {},
    },
    client,
  });
  assert.throws(() => failed.prepare('membership', command()));
  await assert.rejects(() => failed.submit());
  assert.equal(calls, 0);
});

test('membership browser client snapshots query/command and uses exact page/member/receipt envelopes without authority', async () => {
  const calls = [],
    query = { limit: 2, after: id(3) },
    input = command();
  const client = createStaffDirectoryClient(
    { instanceId: scope.instanceId },
    async (path, init) => {
      calls.push({ path, init });
      query.after = null;
      if (path.includes('?')) return Response.json({ page: page() });
      if (!path.includes('/operations/')) return Response.json({ member: member() });
      if (init.method === 'POST') input.requestedRole = 'admin';
      return Response.json({ receipt: receipt() });
    },
  );
  assert.deepEqual(await client.listMemberships(query), page());
  assert.deepEqual(await client.getMembership(id(4)), member());
  assert.deepEqual(await client.saveMembership(input), receipt());
  assert.deepEqual(await client.getMembershipOperation(id(5)), receipt());
  assert.equal(calls[0].path, '/api/staff-directory/memberships?limit=2&after=' + id(3));
  assert.deepEqual(
    calls.map(({ init }) => init.method),
    ['GET', 'GET', 'POST', 'GET'],
  );
  assert.deepEqual(JSON.parse(calls[2].init.body), command());
  for (const { init } of calls) {
    assert.equal(init.headers['X-Preview-Instance'], scope.instanceId);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
  }
  let dispatches = 0;
  const never = createStaffDirectoryClient({ instanceId: scope.instanceId }, async () => {
    dispatches++;
    throw Error();
  });
  assert.throws(() => never.saveMembership({ ...command(), actorId: scope.actorId }));
  assert.throws(() => never.listMemberships({ limit: 2, after: null, tenantId: scope.tenantId }));
  assert.equal(dispatches, 0);
});

test('membership browser binding/status failures retain uncertainty only for dispatched writes and never retry', async () => {
  for (const response of [
    () => Response.json({ receipt: receipt() }, { status: 202 }),
    () => Response.json({ receipt: { ...receipt(), requestedRole: 'admin' } }),
    () => Response.json({ receipt: { ...receipt(), memberId: id(9) } }),
    () =>
      new Response('{"receipt":null,"receipt":null}', {
        headers: { 'content-type': 'application/json' },
      }),
  ]) {
    let calls = 0;
    const client = createStaffDirectoryClient({ instanceId: scope.instanceId }, async () => {
      calls++;
      return response();
    });
    await assert.rejects(
      () => client.saveMembership(command()),
      (error) => error.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
  for (const [method, value] of [
    ['current', { member: { ...member(), memberId: id(9) } }],
    ['current', { member: { ...member(), actorId: scope.actorId } }],
    ['current', { state: member() }],
    ['original', { receipt: { ...receipt(), operationId: id(9) } }],
    ['page', { page: { ...page(), items: [member(6), member(4)] } }],
    [
      'page',
      { page: { ...page(), items: [{ ...member(), reason: 'Private.' }], nextAfter: null } },
    ],
  ]) {
    const methods = [];
    const client = createStaffDirectoryClient(
      { instanceId: scope.instanceId },
      async (_path, init) => {
        methods.push(init.method);
        return Response.json(value);
      },
    );
    await assert.rejects(
      () =>
        method === 'current'
          ? client.getMembership(id(4))
          : method === 'original'
            ? client.getMembershipOperation(id(5))
            : client.listMemberships({ limit: 2, after: id(3) }),
      (error) => !error.submissionUncertain,
    );
    assert.deepEqual(methods, ['GET']);
  }
});

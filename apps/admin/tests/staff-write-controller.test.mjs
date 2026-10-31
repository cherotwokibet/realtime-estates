import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(1), tenantId: id(2), actorId: id(3) },
  command = {
    policy: 'staff-branch-command-v1',
    operationId: id(4),
    branchId: id(5),
    expectedVersion: '0',
    name: 'Synthetic',
    active: true,
    reason: 'Synthetic creation.',
  };
const receipt = {
  ...command,
  policy: 'staff-branch-record-v1',
  actorId: id(3),
  version: '1',
  outcome: 'applied',
  recordedAt: '2026-10-31T04:00:00.000Z',
};
const store = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
test('controller persists before dispatch and locks uncertain replacement/discard/navigation; recovery uses original GET only', async () => {
  const storage = store(),
    calls = [];
  const client = {
    saveBranch: async (c) => {
      assert.ok(storage.values.size);
      calls.push(['POST', c]);
      throw Error('lost');
    },
    getBranchOperation: async (op) => {
      calls.push(['GET', op]);
      return receipt;
    },
  };
  const c = createStaffWriteController({ scope, store: storage, client });
  c.prepare('branch', command);
  await assert.rejects(() => c.submit());
  assert.equal(c.snapshot().attempt.phase, 'uncertain');
  assert.equal(c.snapshot().canNavigate, false);
  assert.throws(() => c.clear());
  assert.throws(() => c.prepare('branch', { ...command, operationId: id(6) }));
  await c.recover();
  assert.deepEqual(
    calls.map((x) => x[0]),
    ['POST', 'GET'],
  );
  assert.equal(c.snapshot().canNavigate, true);
  c.clear();
  assert.equal(storage.values.size, 0);
});
test('restored operations require recovery, explicit replay retains exact command and cannot invent another request', async () => {
  const storage = store(),
    calls = [];
  let c = createStaffWriteController({ scope, store: storage, client: {} });
  c.prepare('branch', command);
  c.close();
  c = createStaffWriteController({
    scope,
    store: storage,
    client: {
      saveBranch: async (original) => {
        calls.push(original);
        return receipt;
      },
    },
  });
  assert.equal(c.snapshot().attempt.phase, 'uncertain');
  await assert.rejects(() => c.submit());
  assert.throws(() => c.replay(false));
  await c.replay(true);
  assert.deepEqual(calls, [command]);
  assert.equal(c.snapshot().attempt.phase, 'resolved');
});
test('storage failures/corruption prevent dispatch and preserve blocked recovery state', async () => {
  let calls = 0;
  const client = {
    saveBranch: async () => {
      calls++;
      return receipt;
    },
  };
  const bad = {
    getItem: () => null,
    setItem: () => {
      throw Error();
    },
    removeItem: () => {},
  };
  const c = createStaffWriteController({ scope, store: bad, client });
  assert.throws(() => c.prepare('branch', command));
  assert.equal(c.snapshot().blocked, true);
  await assert.rejects(() => c.submit());
  assert.equal(calls, 0);
  const corrupt = createStaffWriteController({
    scope,
    store: { ...bad, getItem: () => '{bad' },
    client,
  });
  assert.equal(corrupt.snapshot().blocked, true);
  assert.throws(() => corrupt.clear());
});
test('concurrent operations and late replies after close cannot replace or resolve retained originals', async () => {
  const storage = store();
  let finish;
  const c = createStaffWriteController({
    scope,
    store: storage,
    client: {
      saveBranch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  c.prepare('branch', command);
  const pending = c.submit();
  await Promise.resolve();
  assert.equal(c.snapshot().busy, true);
  await assert.rejects(() => c.recover());
  assert.throws(() => c.clear());
  c.close();
  await assert.rejects(() => pending);
  finish(receipt);
  await Promise.resolve();
  assert.equal(c.snapshot().attempt.phase, 'uncertain');
  assert.equal(c.snapshot().closed, true);
});
test('wrong actor or changed receipt remains uncertain and a failed GET never authorizes replay automatically', async () => {
  let writes = 0;
  const storage = store(),
    c = createStaffWriteController({
      scope,
      store: storage,
      client: {
        saveBranch: async () => {
          writes++;
          return { ...receipt, actorId: id(9) };
        },
        getBranchOperation: async () => {
          throw Error('404 or forbidden');
        },
      },
    });
  c.prepare('branch', command);
  await assert.rejects(() => c.submit());
  await assert.rejects(() => c.recover());
  assert.equal(writes, 1);
  assert.equal(c.snapshot().attempt.phase, 'uncertain');
  assert.equal(c.snapshot().canNavigate, false);
});

test('invitation and revocation controllers recover exact retained targets without dispatching a replacement', async () => {
  const intent = {
    policy: 'staff-invitation-intent-v1',
    operationId: id(4),
    recipientEmail: 'synthetic@example.invalid',
    requestedRole: 'agent',
    branchId: null,
    expiresAfterHours: 24,
  };
  const capture = {
    policy: 'staff-invitation-request-record-v1',
    operationId: id(4),
    actorId: id(3),
    recipientEmail: intent.recipientEmail,
    requestedRole: 'agent',
    expiresAfterHours: 24,
    branch: null,
    recordedAt: '2026-10-31T04:00:00.000Z',
    expiresAt: '2026-11-01T04:00:00.000Z',
    status: 'recorded',
    delivery: 'not_attempted',
    membershipGranted: false,
  };
  const revoke = {
      policy: 'staff-invitation-revocation-command-v1',
      operationId: id(6),
      invitationId: id(4),
      expectedVersion: '1',
      reason: 'Synthetic cancellation.',
    },
    revoked = {
      ...revoke,
      policy: 'staff-invitation-revocation-record-v1',
      actorId: id(3),
      version: '2',
      outcome: 'revoked',
      recordedAt: '2026-10-31T04:00:00.000Z',
    };
  for (const [kind, command, saved] of [
    ['invitation', intent, capture],
    ['revocation', revoke, revoked],
  ]) {
    const calls = [],
      storage = store(),
      c = createStaffWriteController({
        scope,
        store: storage,
        client: {
          captureInvitation: async () => {
            calls.push('POST');
            throw Error();
          },
          revokeInvitation: async () => {
            calls.push('POST');
            throw Error();
          },
          getInvitationOperation: async (op) => {
            assert.equal(op, intent.operationId);
            calls.push('GET');
            return capture;
          },
          getInvitationRevocation: async (inv, op) => {
            assert.equal(inv, revoke.invitationId);
            assert.equal(op, revoke.operationId);
            calls.push('GET');
            return revoked;
          },
        },
      });
    c.prepare(kind, command);
    await assert.rejects(() => c.submit());
    const original = await c.recover();
    assert.deepEqual(original.receipt, saved);
    assert.deepEqual(calls, ['POST', 'GET']);
  }
});

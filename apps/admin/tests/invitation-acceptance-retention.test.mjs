import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ApiClientError } from '@realtor/api-client';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
import { serializeStaffWrite, restoreStaffWrite } from '../dist/tests/lib/staff-write-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(1), tenantId: id(2), actorId: id(50) };
const command = () => ({
  policy: 'staff-invitation-redemption-command-v1',
  invitationId: id(4),
  operationId: id(5),
});
const receipt = () => ({
  policy: 'staff-invitation-redemption-record-v1',
  invitationId: id(4),
  operationId: id(5),
  memberId: id(50),
  requestedRole: 'agent',
  branchId: null,
  recordedAt: '2026-11-02T17:00:00.000Z',
  membershipGranted: true,
});
function store() {
  const values = new Map();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}

test('acceptance commands never retain raw codes or receipt facts, including after resolution and reload', async () => {
  const secret = randomBytes(32).toString('base64url'),
    storage = store(),
    calls = [];
  const c = createStaffWriteController({
    scope,
    store: storage,
    client: {
      acceptInvitation: async (input, raw) => {
        calls.push(input);
        assert.equal(raw, secret);
        return receipt();
      },
    },
  });
  assert.throws(() => c.prepare('acceptance', { ...command(), secret }));
  c.prepare('acceptance', command());
  await assert.rejects(() => c.submit('bad'));
  assert.equal(calls.length, 0);
  assert.equal(c.snapshot().attempt.phase, 'prepared');
  await c.submit(secret);
  assert.equal(c.snapshot().attempt.phase, 'resolved');
  assert.equal(c.snapshot().secretAvailable, false);
  const retained = serializeStaffWrite(c.snapshot().attempt);
  for (const text of [...storage.values.values(), retained, JSON.stringify(c.snapshot())])
    assert.ok(!text.includes(secret));
  assert.ok(!retained.includes('memberId'));
  assert.ok(!retained.includes('recordedAt'));
  const restored = restoreStaffWrite(retained, scope);
  assert.equal(restored.kind, 'acceptance');
  assert.equal(restored.phase, 'uncertain');
  assert.equal(restored.receipt, null);
});

test('uncertain acceptance reload retains the exact operation and recovery never resubmits raw material', async () => {
  const storage = store(),
    methods = [],
    secret = randomBytes(32).toString('base64url'),
    client = {
      acceptInvitation: async () => {
        methods.push('POST');
        throw Error(secret);
      },
      getInvitationRedemption: async () => {
        methods.push('GET');
        return receipt();
      },
    };
  const first = createStaffWriteController({ scope, store: storage, client });
  first.prepare('acceptance', command());
  await assert.rejects(
    () => first.submit(secret),
    (e) => !e.message.includes(secret),
  );
  assert.throws(() => first.clear());
  first.close();
  const resumed = createStaffWriteController({ scope, store: storage, client });
  assert.equal(resumed.snapshot().attempt.command.operationId, command().operationId);
  await resumed.recover();
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(resumed.snapshot().attempt.receipt.memberId, scope.actorId);
  assert.throws(() =>
    restoreStaffWrite([...storage.values.values()][0], { ...scope, actorId: id(60) }),
  );
});

test('acceptance binds original member identity, blocks late responses after close and acknowledges known refusal without a hidden retry', async () => {
  const secret = randomBytes(32).toString('base64url');
  const wrong = createStaffWriteController({
    scope,
    store: store(),
    client: { acceptInvitation: async () => ({ ...receipt(), memberId: id(60) }) },
  });
  wrong.prepare('acceptance', command());
  await assert.rejects(() => wrong.submit(secret));
  assert.equal(wrong.snapshot().attempt.phase, 'uncertain');
  let done;
  const pending = new Promise((resolve) => (done = resolve)),
    late = createStaffWriteController({
      scope,
      store: store(),
      client: { acceptInvitation: () => pending },
    });
  late.prepare('acceptance', command());
  const result = late.submit(secret);
  await Promise.resolve();
  late.close();
  done(receipt());
  await assert.rejects(() => result);
  assert.equal(late.snapshot().attempt.phase, 'uncertain');
  let calls = 0;
  const refused = createStaffWriteController({
    scope,
    store: store(),
    client: {
      acceptInvitation: async () => {
        calls++;
        throw new ApiClientError('HTTP', 'Refused', { status: 422, submissionUncertain: false });
      },
    },
  });
  refused.prepare('acceptance', command());
  await assert.rejects(() => refused.submit(secret));
  assert.equal(refused.snapshot().attempt.phase, 'refused');
  assert.equal(refused.snapshot().canNavigate, true);
  refused.clear();
  assert.equal(calls, 1);
});

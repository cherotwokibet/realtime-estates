import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrivateOperationResolution } from '../dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const original = {
    policy: 'listing-report-decision-command-v1',
    operationId: id(1),
    reportId: id(2),
    expectedVersion: '1',
    decision: 'reviewed',
    reason: 'Synthetic review',
  },
  expected = { kind: 'report', original, tenantId: id(3), actorId: id(4) },
  receipt = {
    policy: 'listing-report-decision-receipt-v1',
    operationId: id(1),
    reportId: id(2),
    version: '2',
    decision: 'reviewed',
    reason: 'Synthetic review',
    actorId: id(4),
    recordedAt: '2026-11-22T00:00:00.000Z',
  },
  cancelled = {
    policy: 'private-operation-resolution-v1',
    tenantId: id(3),
    actorId: id(4),
    kind: 'report',
    operationId: id(1),
    request: original,
    outcome: 'cancelled',
    receipt: null,
    recordedAt: '2026-11-22T00:00:00.000Z',
  };
test('terminal resolution binds every original fact, scope, actor, outcome and optional exact saved receipt', () => {
  assert.deepEqual(validatePrivateOperationResolution(cancelled, expected), cancelled);
  const completed = { ...cancelled, outcome: 'completed', receipt };
  assert.deepEqual(validatePrivateOperationResolution(completed, expected), completed);
  for (const bad of [
    { ...cancelled, extra: true },
    { ...cancelled, policy: 'untrusted' },
    { ...cancelled, kind: 'settings' },
    { ...cancelled, actorId: id(5) },
    { ...cancelled, tenantId: id(5) },
    { ...cancelled, operationId: id(5) },
    { ...cancelled, request: { ...original, expectedVersion: '2' } },
    { ...cancelled, outcome: 'missing' },
    { ...cancelled, receipt },
    { ...completed, receipt: null },
    { ...completed, receipt: { ...receipt, reason: 'Changed' } },
    { ...completed, receipt: { ...receipt, actorId: id(5) } },
    { ...cancelled, recordedAt: '1' },
    { ...cancelled, recordedAt: 'bad' },
  ])
    assert.throws(() => validatePrivateOperationResolution(bad, expected));
  const getter = { ...cancelled };
  Object.defineProperty(getter, 'receipt', {
    enumerable: true,
    get() {
      throw Error('Must not evaluate getter');
    },
  });
  assert.throws(() => validatePrivateOperationResolution(getter, expected), /Invalid resolution/);
});

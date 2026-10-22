import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planListingVerification,
  validateListingVerificationRecord,
  validateListingVerificationReceipt,
  validateListingVerificationOriginal,
  validateListingVerificationHistory,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-22T20:00:00.000Z';
const command = (n = 300, version = '0') => ({
  operationId: id(n),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' },
  expectedVerificationVersion: version,
  subject: 'identity',
  outcome: 'supported',
  evidenceReference: 'synthetic:identity-fixture',
  note: 'Synthetic identity assessment.',
  observedAt: '2026-01-01T00:00:00.000Z',
});
const record = (n = 300, version = '0') =>
  planListingVerification(
    command(n, version),
    {
      target: command().target,
      verificationVersion: version,
      lastRecordedAt: version === '0' ? null : now,
    },
    'admin',
    id(10),
    now,
  ).record;
const receipt = () => ({
  kind: 'listing_verification_receipt',
  operationId: id(300),
  listingId: id(100),
  actorId: id(10),
  request: command(),
  decision: { outcome: 'recorded', reason: null, record: record() },
  completedAt: now,
});
test('private check result validators capture immutable original facts and historical actor/time', () => {
  const input = structuredClone(receipt()),
    result = validateListingVerificationReceipt(input, command(), id(10));
  input.request.note = 'changed';
  input.decision.record.target.revisionVersion = '9';
  assert.equal(result.request.note, 'Synthetic identity assessment.');
  assert.equal(result.decision.record.target.revisionVersion, '2');
  for (const value of [
    result,
    result.request,
    result.request.target,
    result.decision,
    result.decision.record,
    result.decision.record.target,
  ])
    assert.ok(Object.isFrozen(value));
  assert.deepEqual(
    validateListingVerificationOriginal(receipt(), id(100), id(300), id(10)),
    result,
  );
});
test('receipt binds every original field, route identity, actor and exact next history version', () => {
  for (const patch of [
    { operationId: id(301) },
    { listingId: id(101) },
    { actorId: id(11) },
    { completedAt: '2026-10-22T20:00:00.001Z' },
    { request: { ...command(), note: 'Changed.' } },
    { decision: { ...receipt().decision, record: { ...record(), verificationVersion: '2' } } },
    { decision: { ...receipt().decision, record: { ...record(), actorId: id(11) } } },
    { privateAddress: 'PRIVATE' },
  ])
    assert.throws(() =>
      validateListingVerificationReceipt({ ...receipt(), ...patch }, command(), id(10)),
    );
  assert.throws(() => validateListingVerificationOriginal(receipt(), id(101), id(300), id(10)));
  assert.throws(() => validateListingVerificationOriginal(receipt(), id(100), id(301), id(10)));
});
test('terminal conflict/refusal receipts have no record and respect known reason/clock priority', () => {
  for (const reason of ['LISTING_CHANGED', 'VERIFICATION_CHANGED'])
    assert.equal(
      validateListingVerificationReceipt(
        { ...receipt(), decision: { outcome: 'conflict', reason, record: null } },
        command(),
      ).decision.reason,
      reason,
    );
  const future = { ...command(), observedAt: '2026-10-23T00:00:00.000Z' },
    refusal = {
      ...receipt(),
      request: future,
      decision: { outcome: 'refused', reason: 'OBSERVATION_IN_FUTURE', record: null },
    };
  assert.equal(validateListingVerificationReceipt(refusal, future).decision.outcome, 'refused');
  for (const decision of [
    { outcome: 'refused', reason: 'VERSION_LIMIT', record: null },
    { outcome: 'refused', reason: 'RECORD_CLOCK_INVALID', record: null },
    { outcome: 'refused', reason: 'OBSERVATION_IN_FUTURE', record: null },
    { outcome: 'conflict', reason: 'LISTING_CHANGED', record: record() },
    { outcome: 'recorded', reason: 'LISTING_CHANGED', record: record() },
  ])
    assert.throws(() => validateListingVerificationReceipt({ ...receipt(), decision }, command()));
});
test('history validates exact newest-first contiguous versions, lookahead and clock order', () => {
  const input = {
    kind: 'listing_verification_history',
    beforeVersion: null,
    listingId: id(100),
    verificationVersion: '2',
    records: [record(301, '1'), record()],
    hasMore: false,
  };
  const result = validateListingVerificationHistory(input, id(100), 2);
  assert.deepEqual(
    result.records.map((x) => x.verificationVersion),
    ['2', '1'],
  );
  assert.ok(Object.isFrozen(result.records));
  assert.equal(
    validateListingVerificationHistory(
      { ...input, records: [record(301, '1')], hasMore: true },
      id(100),
      1,
    ).hasMore,
    true,
  );
  for (const patch of [
    { records: [record(), record(301, '1')] },
    { hasMore: true },
    { verificationVersion: '3' },
    { records: [record(301, '1')] },
    { listingId: id(101) },
    {
      records: [
        { ...record(301, '1'), target: { ...command().target, listingId: id(101) } },
        record(),
      ],
    },
  ])
    assert.throws(() => validateListingVerificationHistory({ ...input, ...patch }, id(100), 2));
  assert.deepEqual(
    validateListingVerificationHistory(
      { ...input, verificationVersion: '0', records: [], hasMore: false },
      id(100),
      20,
    ).records,
    [],
  );
});
test('private results refuse hidden fields, getters, custom iterators and sparse histories without execution', () => {
  let invoked = 0;
  const getter = {
    enumerable: true,
    get() {
      invoked++;
      throw Error();
    },
  };
  const bad = receipt();
  Object.defineProperty(bad.request, 'note', getter);
  assert.throws(() => validateListingVerificationReceipt(bad, command()));
  const history = () => ({
    kind: 'listing_verification_history',
    beforeVersion: null,
    listingId: id(100),
    verificationVersion: '1',
    records: [record()],
    hasMore: false,
  });
  for (const change of [
    (h) => Object.defineProperty(h.records, '0', getter),
    (h) => {
      h.records[Symbol.iterator] = () => {
        invoked++;
        throw Error();
      };
    },
    (h) => {
      delete h.records[0];
    },
  ]) {
    const h = history();
    change(h);
    assert.throws(() => validateListingVerificationHistory(h, id(100), 20));
  }
  assert.equal(invoked, 0);
  assert.throws(() => validateListingVerificationRecord({ ...record(), verified: true }, id(100)));
});
test('history keyset binds the exact cursor and navigates older records despite a newer current head', () => {
  const page = {
    kind: 'listing_verification_history',
    listingId: id(100),
    verificationVersion: '4',
    beforeVersion: '3',
    records: [record(301, '1'), record()],
    hasMore: false,
  };
  assert.deepEqual(
    validateListingVerificationHistory(page, id(100), 2, '3').records.map(
      (x) => x.verificationVersion,
    ),
    ['2', '1'],
  );
  assert.equal(
    validateListingVerificationHistory(
      { ...page, records: [record(301, '1')], hasMore: true },
      id(100),
      1,
      '3',
    ).hasMore,
    true,
  );
  assert.equal(
    validateListingVerificationHistory(
      { ...page, beforeVersion: '1', records: [], hasMore: false },
      id(100),
      2,
      '1',
    ).records.length,
    0,
  );
  for (const before of ['0', '03', '9007199254740992'])
    assert.throws(() => validateListingVerificationHistory(page, id(100), 2, before));
  assert.throws(() =>
    validateListingVerificationHistory({ ...page, beforeVersion: '2' }, id(100), 2, '3'),
  );
  assert.throws(() =>
    validateListingVerificationHistory(
      {
        ...page,
        records: [record(301, '1'), { ...record(), recordedAt: '2026-10-22T20:00:00.001Z' }],
      },
      id(100),
      2,
      '3',
    ),
  );
});

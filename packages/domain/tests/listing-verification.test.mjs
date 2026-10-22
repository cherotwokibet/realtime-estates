import test from 'node:test';
import assert from 'node:assert/strict';
import { validateListingVerificationCommand, planListingVerification } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-22T20:00:00.000Z';
const command = () => ({
  operationId: id(3),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(1), listingVersion: '2', revision: 1, revisionVersion: '3' },
  expectedVerificationVersion: '0',
  subject: 'advertising_authority',
  outcome: 'supported',
  evidenceReference: 'synthetic:authority-fixture',
  note: 'Synthetic evidence only.',
  observedAt: '2026-10-22T19:00:00.000Z',
});
const facts = () => ({
  target: { ...command().target },
  verificationVersion: '0',
  lastRecordedAt: null,
});
const plan = (c = command(), f = facts(), clock = now) =>
  planListingVerification(c, f, 'admin', id(9), clock);
test('private synthetic check captures original evidence and actor without claiming public verification', () => {
  const c = command(),
    f = facts(),
    before = structuredClone(f),
    result = plan(c, f);
  assert.equal(result.outcome, 'planned');
  assert.equal(result.record.kind, 'listing_verification_record');
  assert.equal(result.record.verificationVersion, '1');
  assert.equal(result.record.actorId, id(9));
  assert.equal(result.record.recordedAt, now);
  assert.equal(result.record.target.revisionVersion, '3');
  c.target.revisionVersion = '9';
  c.note = 'changed';
  assert.equal(result.record.note, 'Synthetic evidence only.');
  assert.equal(result.record.target.revisionVersion, '3');
  assert.deepEqual(f, before);
  for (const value of [result, result.record, result.record.target])
    assert.ok(Object.isFrozen(value));
  assert.equal(Object.hasOwn(result.record, 'verified'), false);
  assert.equal(Object.hasOwn(result.record, 'availability'), false);
  assert.equal(Object.hasOwn(result.record, 'expectedVerificationVersion'), false);
});
test('only named subjects and outcomes are accepted, inconclusive may explicitly lack evidence', () => {
  for (const subject of ['identity', 'advertising_authority', 'availability'])
    for (const outcome of ['supported', 'not_supported', 'inconclusive'])
      assert.equal(
        validateListingVerificationCommand({ ...command(), subject, outcome }).subject,
        subject,
      );
  assert.equal(
    validateListingVerificationCommand({
      ...command(),
      outcome: 'inconclusive',
      evidenceReference: null,
    }).evidenceReference,
    null,
  );
  for (const patch of [
    { subject: 'verified' },
    { outcome: 'verified' },
    { outcome: 'supported', evidenceReference: null },
    { outcome: 'not_supported', evidenceReference: null },
    { policy: 'production-v1' },
    { evidenceReference: 'https://private.invalid/id' },
    { evidenceReference: 'synthetic:' },
    { note: ' ' },
    { note: ' secret ' },
    { note: 'x'.repeat(601) },
    { note: 'x\u0000' },
    { note: 'x\u0085x' },
    { note: '\u00a0Synthetic' },
    { note: '\ud800' },
  ])
    assert.throws(() => validateListingVerificationCommand({ ...command(), ...patch }));
  assert.equal(
    validateListingVerificationCommand({ ...command(), note: '🏡'.repeat(600) }).note.length,
    1200,
  );
});
test('exact target and independent history currency conflict before time refusals', () => {
  for (const [key, value] of Object.entries({
    listingId: id(2),
    listingVersion: '3',
    revision: 2,
    revisionVersion: '4',
  })) {
    const result = plan(
      { ...command(), observedAt: '2026-10-23T00:00:00.000Z' },
      { ...facts(), target: { ...facts().target, [key]: value } },
    );
    assert.equal(result.reason, 'LISTING_CHANGED');
  }
  const result = plan(command(), { ...facts(), verificationVersion: '1', lastRecordedAt: now });
  assert.equal(result.reason, 'VERIFICATION_CHANGED');
  const next = plan(
    { ...command(), expectedVerificationVersion: '1' },
    { ...facts(), verificationVersion: '1', lastRecordedAt: now },
  );
  assert.equal(next.record.verificationVersion, '2');
});
test('future observations, regressing trusted clock and exhausted version refuse without a record', () => {
  assert.equal(
    plan({ ...command(), observedAt: '2026-10-23T00:00:00.000Z' }).reason,
    'OBSERVATION_IN_FUTURE',
  );
  assert.equal(
    plan(
      { ...command(), expectedVerificationVersion: '1' },
      { ...facts(), verificationVersion: '1', lastRecordedAt: '2026-10-23T00:00:00.000Z' },
    ).reason,
    'RECORD_CLOCK_INVALID',
  );
  assert.equal(
    plan(
      { ...command(), expectedVerificationVersion: '9007199254740991' },
      { ...facts(), verificationVersion: '9007199254740991', lastRecordedAt: now },
    ).reason,
    'VERSION_LIMIT',
  );
  for (const [version, lastRecordedAt] of [
    ['0', now],
    ['1', null],
    ['01', now],
    ['9007199254740992', now],
  ])
    assert.throws(() =>
      plan(command(), { ...facts(), verificationVersion: version, lastRecordedAt }),
    );
});
test('commands reject caller authority, rounding, malformed calendars and unknown record fields', () => {
  for (const patch of [
    { actorId: id(9) },
    { tenantId: id(8) },
    { verified: true },
    { expectedVerificationVersion: 0 },
    { expectedVerificationVersion: '01' },
    { observedAt: '2026-02-30T00:00:00.000Z' },
    { observedAt: '0000-01-01T00:00:00.000Z' },
    { observedAt: '2026-10-22T20:00:00Z' },
    { target: { ...command().target, listingVersion: '9007199254740992' } },
    { target: { ...command().target, actorId: id(9) } },
  ])
    assert.throws(() => validateListingVerificationCommand({ ...command(), ...patch }));
});
test('private policy refuses nonadmin before caller getters and rejects accessors without invoking them', () => {
  let invoked = 0;
  const c = command();
  Object.defineProperty(c, 'note', {
    enumerable: true,
    get() {
      invoked++;
      throw Error();
    },
  });
  assert.throws(() => planListingVerification(c, facts(), 'agent', id(9), now), {
    code: 'LISTING_VERIFICATION_FORBIDDEN',
  });
  assert.throws(() => validateListingVerificationCommand(c));
  assert.equal(invoked, 0);
  const nested = command();
  Object.defineProperty(nested.target, 'listingVersion', {
    enumerable: true,
    get() {
      invoked++;
      throw Error();
    },
  });
  assert.throws(() => validateListingVerificationCommand(nested));
  assert.equal(invoked, 0);
});

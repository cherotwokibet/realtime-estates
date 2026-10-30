import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingReportCommand,
  validateListingReportReceipt,
  validateListingReportDecisionCommand,
  validateListingReportDecisionReceipt,
  validateListingReportQueue,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = {
  policy: 'listing-report-command-v1',
  operationId: id(1),
  listingId: id(2),
  reason: 'suspected_fraud',
  details: 'Synthetic concern; no real listing or person is accused.',
};
const receipt = {
  policy: 'listing-report-receipt-v1',
  operationId: id(1),
  listingId: id(2),
  status: 'recorded',
  recordedAt: '2026-10-29T12:00:00.123Z',
};
const decision = {
  policy: 'listing-report-decision-command-v1',
  operationId: id(3),
  reportId: id(4),
  expectedVersion: '1',
  decision: 'reviewed',
  reason: 'Synthetic review only.',
};
test('anonymous report has exact fields, bounded canonical plain text and no account/contact authority', () => {
  assert.deepEqual(validateListingReportCommand(command), command);
  assert.ok(Object.isFrozen(validateListingReportCommand(command)));
  assert.equal(validateListingReportCommand({ ...command, details: null }).details, null);
  for (const patch of [
    { reason: 'spam' },
    { details: '' },
    { details: ' x' },
    { details: '<img>' },
    { details: 'x\n' },
    { details: 'x\u0085y' },
    { details: 'x\u202ey' },
    { details: 'x\u2066y' },
    { details: 'x\ud800' },
    { details: 'e\u0301' },
    { details: 'x'.repeat(1201) },
    { operationId: 'invalid' },
    { listingId: id(2).toUpperCase() + 'x' },
    { tenantId: id(5) },
    { email: 'synthetic@example.invalid' },
    { actorId: id(9) },
  ])
    assert.throws(() => validateListingReportCommand({ ...command, ...patch }));
  let accessed = false;
  const getter = { ...command };
  Object.defineProperty(getter, 'details', {
    get() {
      accessed = true;
      return 'value';
    },
    enumerable: true,
  });
  assert.throws(() => validateListingReportCommand(getter));
  assert.equal(accessed, false);
  assert.throws(() =>
    validateListingReportCommand(Object.assign(Object.create({ authority: true }), command)),
  );
});
test('admin queue refuses malformed order, duplicate records, wrong filters and unpaired terminal facts', () => {
  const row = {
    reportId: id(10),
    listingId: id(2),
    revision: 1,
    reason: 'other',
    details: null,
    noticeVersion: 'synthetic-report-v1',
    recordedAt: receipt.recordedAt,
    version: '1',
    status: 'new',
    decision: null,
  };
  const queue = {
    policy: 'listing-report-queue-v1',
    items: [row],
    hasMore: false,
    limit: 2,
    status: 'new',
  };
  assert.deepEqual(validateListingReportQueue(queue, { limit: 2, status: 'new' }), queue);
  for (const patch of [
    { noticeVersion: '-invalid' },
    { version: '2' },
    { status: 'reviewed' },
    { operationId: id(99) },
    { details: '<b>' },
  ])
    assert.throws(() => validateListingReportQueue({ ...queue, items: [{ ...row, ...patch }] }));
  assert.throws(() => validateListingReportQueue({ ...queue, hasMore: true }));
  assert.throws(() => validateListingReportQueue({ ...queue, items: [row, row] }));
  assert.throws(() => validateListingReportQueue(queue, { limit: 3, status: 'new' }));
  const later = { ...row, reportId: id(11), recordedAt: '2026-10-29T12:00:01.123Z' };
  assert.throws(() => validateListingReportQueue({ ...queue, items: [row, later] }));
  assert.equal(validateListingReportQueue({ ...queue, items: [later, row] }).items.length, 2);
});
test('public report acknowledgment binds only the original operation/listing and cannot disclose private details', () => {
  assert.deepEqual(validateListingReportReceipt(receipt, command), receipt);
  for (const patch of [
    { operationId: id(9) },
    { listingId: id(9) },
    { status: 'verified_fraud' },
    { details: command.details },
    { actorId: id(7) },
    { decision: 'dismissed' },
    { recordedAt: '2026-02-30T12:00:00.123Z' },
    { recordedAt: '2026-10-29T12:00:00Z' },
  ])
    assert.throws(() => validateListingReportReceipt({ ...receipt, ...patch }, command));
});
test('reasoned admin decision requires exact version and outcome-bound immutable receipt', () => {
  assert.deepEqual(validateListingReportDecisionCommand(decision), decision);
  for (const patch of [
    { expectedVersion: '0' },
    { expectedVersion: '01' },
    { expectedVersion: '9007199254740991' },
    { expectedVersion: 1 },
    { decision: 'unpublish' },
    { reason: ' ' },
    { reason: 'x'.repeat(501) },
    { reporterEmail: 'synthetic@example.invalid' },
  ])
    assert.throws(() => validateListingReportDecisionCommand({ ...decision, ...patch }));
  const result = {
    policy: 'listing-report-decision-receipt-v1',
    operationId: id(3),
    reportId: id(4),
    version: '2',
    decision: 'reviewed',
    reason: decision.reason,
    actorId: id(8),
    recordedAt: receipt.recordedAt,
  };
  assert.deepEqual(validateListingReportDecisionReceipt(result, decision), result);
  for (const patch of [
    { version: '1' },
    { version: '3' },
    { reportId: id(9) },
    { operationId: id(10) },
    { decision: 'dismissed' },
    { reason: 'Different reason' },
    { actorId: null },
  ])
    assert.throws(() => validateListingReportDecisionReceipt({ ...result, ...patch }, decision));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingSuccessorCommand,
  planListingSuccessor,
  validateListingSuccessorReceipt,
} from '../dist/index.js';
import { staffListingFixture, staffListingId } from '../test-helpers/staff-listing-fixtures.mjs';
const current = () => {
  const value = staffListingFixture();
  value.latest.state = 'approved';
  return value;
};
const command = () => ({
  operationId: staffListingId(99),
  listingId: staffListingId(10),
  expectedListingVersion: '3',
  predecessor: { revision: 2, version: '2', state: 'approved' },
  content: {
    title: ' New synthetic revision ',
    privateAddress: ' RAW FICTIONAL ',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  },
});
test('successor plan creates a detached next draft with explicit content and empty gallery', () => {
  const input = command(),
    saved = current(),
    before = structuredClone(saved);
  const result = planListingSuccessor(input, saved);
  assert.equal(result.outcome, 'planned');
  assert.deepEqual(
    { ...result.result, content: undefined },
    {
      listingVersion: '4',
      revision: 3,
      revisionVersion: '2',
      state: 'draft',
      content: undefined,
      media: [],
    },
  );
  input.content.title = 'changed after planning';
  assert.equal(result.result.content.title, 'New synthetic revision');
  assert.equal(result.result.content.privateAddress, ' RAW FICTIONAL ');
  assert.equal(result.result.content.amountMinor, null);
  assert.deepEqual(saved, before);
  assert.ok(Object.isFrozen(result.result.media));
  assert.ok(Object.isFrozen(result.result.content.location));
  assert.ok(Object.isFrozen(result.result));
});
test('rejected predecessors qualify without restoring paused or archived publication', () => {
  for (const publicationStatus of ['published', 'paused', 'archived']) {
    const input = command(),
      saved = current();
    input.predecessor.state = saved.latest.state = 'rejected';
    saved.publicationStatus = publicationStatus;
    const before = structuredClone(saved);
    assert.equal(planListingSuccessor(input, saved).outcome, 'planned');
    assert.deepEqual(saved, before);
  }
});
test('listing version, predecessor identity/version/state and a newer draft each conflict', () => {
  const changes = [
    (s) => (s.version = '4'),
    (s) => (s.latest.version = '3'),
    (s) => (s.latest.revision = 3),
    (s) => (s.latest.state = 'pending'),
    (s) => (s.latest.state = 'draft'),
    (s) => (s.latest.state = 'rejected'),
  ];
  for (const change of changes) {
    const saved = current();
    change(saved);
    assert.deepEqual(planListingSuccessor(command(), saved), {
      outcome: 'conflict',
      reason: 'PREDECESSOR_CHANGED',
      result: null,
    });
  }
  const empty = current();
  empty.latest = null;
  empty.publishedRevision = null;
  empty.publicationStatus = 'unpublished';
  assert.equal(planListingSuccessor(command(), empty).outcome, 'conflict');
});
test('correlated limits refuse without overflow and stale facts take precedence', () => {
  let input = command(),
    saved = current();
  input.expectedListingVersion = saved.version = '9007199254740991';
  assert.equal(planListingSuccessor(input, saved).reason, 'VERSION_LIMIT');
  input.predecessor.version = '1';
  assert.equal(planListingSuccessor(input, saved).outcome, 'conflict');
  input = command();
  saved = current();
  input.predecessor.revision = saved.latest.revision = 2147483647;
  assert.equal(planListingSuccessor(input, saved).reason, 'REVISION_LIMIT');
});
test('strict original command rejects ambiguous numbers, nonterminal states and authority fields', () => {
  for (const version of [0, '0', '01', '1e2', '9007199254740992', '1'.repeat(1000)]) {
    const input = command();
    input.expectedListingVersion = version;
    assert.throws(() => validateListingSuccessorCommand(input));
  }
  for (const state of ['draft', 'pending', 'changes-requested', null]) {
    const input = command();
    input.predecessor.state = state;
    assert.throws(() => validateListingSuccessorCommand(input));
  }
  const input = command();
  input.actorId = staffListingId(5);
  assert.throws(() => validateListingSuccessorCommand(input));
  const wrong = current();
  wrong.listingId = staffListingId(11);
  assert.throws(() => planListingSuccessor(command(), wrong));
});
test('hidden properties, executable descriptors and symbols are rejected without invocation', () => {
  let calls = 0;
  for (const mutate of [
    (x) =>
      Object.defineProperty(x, 'content', {
        get() {
          calls++;
          return {};
        },
        enumerable: true,
      }),
    (x) =>
      Object.defineProperty(x.predecessor, 'state', {
        get() {
          calls++;
          return 'approved';
        },
        enumerable: true,
      }),
    (x) => Object.defineProperty(x, 'hidden', { value: 1 }),
    (x) => (x[Symbol('authority')] = true),
  ]) {
    const input = command();
    mutate(input);
    assert.throws(() => validateListingSuccessorCommand(input));
  }
  assert.equal(calls, 0);
});

const receipt = (original) => ({
  operationId: original.operationId,
  listingId: original.listingId,
  actorId: staffListingId(2),
  kind: 'start_revision',
  completedAt: '2026-10-16T01:00:00.123456Z',
  request: {
    expectedListingVersion: original.expectedListingVersion,
    predecessor: original.predecessor,
    content: original.content,
  },
  decision: {
    outcome: 'applied',
    reason: null,
    result: { listingVersion: '4', revision: 3, revisionVersion: '2' },
  },
});
test('original successor receipt binds actor, operation and every frozen request fact', () => {
  const original = validateListingSuccessorCommand(command()),
    input = receipt(original);
  const saved = validateListingSuccessorReceipt(input, original, staffListingId(2));
  input.decision.result.revision = 9;
  assert.equal(saved.decision.result.revision, 3);
  assert.ok(Object.isFrozen(saved.request.predecessor));
  for (const mutate of [
    (x) => (x.operationId = staffListingId(88)),
    (x) => (x.actorId = staffListingId(88)),
    (x) => (x.request.expectedListingVersion = '4'),
    (x) => (x.request.predecessor = { ...x.request.predecessor, state: 'rejected' }),
    (x) => (x.request.content = { ...x.request.content, title: 'changed' }),
    (x) => (x.completedAt = '2026-02-30T01:00:00.123Z'),
    (x) => (x.decision.result.revisionVersion = '3'),
    (x) => (x.decision.result.listingVersion = '5'),
  ]) {
    const value = receipt(original);
    mutate(value);
    assert.throws(() => validateListingSuccessorReceipt(value, original, staffListingId(2)));
  }
});
test('historical conflict and bounded refusal receipts cannot claim an applied allocation', () => {
  const original = validateListingSuccessorCommand(command()),
    input = receipt(original);
  input.decision = { outcome: 'conflict', reason: 'PREDECESSOR_CHANGED', result: null };
  assert.equal(
    validateListingSuccessorReceipt(input, original, staffListingId(2)).decision.outcome,
    'conflict',
  );
  input.decision = { outcome: 'refused', reason: 'REVISION_LIMIT', result: null };
  assert.throws(() => validateListingSuccessorReceipt(input, original, staffListingId(2)));
  const limited = command();
  limited.predecessor.revision = 2147483647;
  const retained = validateListingSuccessorCommand(limited),
    refusal = receipt(retained);
  refusal.decision = input.decision;
  assert.equal(
    validateListingSuccessorReceipt(refusal, retained, staffListingId(2)).decision.reason,
    'REVISION_LIMIT',
  );
  refusal.decision = {
    outcome: 'applied',
    reason: null,
    result: { listingVersion: '4', revision: 2147483648, revisionVersion: '2' },
  };
  assert.throws(() => validateListingSuccessorReceipt(refusal, retained, staffListingId(2)));
});

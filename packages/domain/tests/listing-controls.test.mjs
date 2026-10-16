import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingControlCommand as command,
  validateListingControlFacts as facts,
  planListingControl as plan,
  validateListingControlReceipt as receipt,
  validateListingControlSnapshot as snapshot,
} from '../dist/index.js';
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2090-02-01T12:00:00.000000Z';
const availability = (value = 'available', version = '3') => ({
  operationId: id(99),
  listingId: id(10),
  expectedListingVersion: version,
  kind: 'confirm_availability',
  availability: value,
});
const publication = (value = 'published', version = '3') => ({
  operationId: id(99),
  listingId: id(10),
  expectedListingVersion: version,
  kind: 'set_publication',
  publicationStatus: value,
});
const current = () => ({
  listingId: id(10),
  version: '3',
  availability: 'available',
  publicationStatus: 'published',
  publishedRevision: 1,
  approvedSnapshotRevision: 1,
  lastAvailabilityConfirmedAt: '2090-01-31T12:00:00.000001Z',
  archivedAt: null,
});
const invalid = (fn) => assert.throws(fn, (e) => e.code === 'INVALID_LISTING_CONTROL');
const original = (
  c,
  decision = {
    outcome: 'applied',
    reason: null,
    result: { listingVersion: String(BigInt(c.expectedListingVersion) + 1n) },
  },
) => ({
  operationId: c.operationId,
  listingId: c.listingId,
  actorId: id(11),
  kind: c.kind,
  request:
    c.kind === 'confirm_availability'
      ? { expectedListingVersion: c.expectedListingVersion, availability: c.availability }
      : {
          expectedListingVersion: c.expectedListingVersion,
          publicationStatus: c.publicationStatus,
        },
  completedAt: now,
  decision,
});

test('listing controls retain exact detached intent and reject authority fields, malformed tokens and accessors', () => {
  const input = availability(),
    saved = command(input);
  input.availability = 'sold';
  assert.equal(saved.availability, 'available');
  assert.ok(Object.isFrozen(saved));
  assert.equal(
    command({ ...availability(), operationId: id(99).toUpperCase() }).operationId,
    id(99),
  );
  for (const bad of [
    { ...availability(), tenantId: id(2) },
    { ...availability(), actorId: id(11) },
    { ...publication(), publicationStatus: 'unpublished' },
    { ...availability(), availability: 'AVAILABLE' },
    { ...availability(), kind: 'archive' },
    { ...publication(), availability: 'sold' },
  ])
    invalid(() => command(bad));
  for (const version of [0, '0', '03', '3.0', '3e0', '-3', '9007199254740992', null])
    invalid(() => command(availability('available', version)));
  let read = false;
  const getter = { ...availability() };
  Object.defineProperty(getter, 'kind', {
    enumerable: true,
    get() {
      read = true;
      return 'confirm_availability';
    },
  });
  invalid(() => command(getter));
  assert.equal(read, false);
  const hidden = { ...availability() };
  Object.defineProperty(hidden, 'secret', { value: true });
  invalid(() => command(hidden));
  invalid(() => command({ ...availability(), [Symbol('extra')]: true }));
});
test('availability confirmation refreshes only listing control facts and auto-pauses published unavailable stock', () => {
  for (const value of ['available', 'reserved', 'rented', 'sold', 'withdrawn']) {
    const before = current(),
      copy = structuredClone(before),
      result = plan(availability(value), before, 'agent', now);
    assert.equal(result.outcome, 'planned');
    assert.equal(result.result.version, '4');
    assert.equal(result.result.availability, value);
    assert.equal(result.result.publicationStatus, value === 'available' ? 'published' : 'paused');
    assert.equal(result.result.lastAvailabilityConfirmedAt, now);
    assert.equal(result.result.publishedRevision, 1);
    assert.equal(result.result.approvedSnapshotRevision, 1);
    assert.deepEqual(before, copy);
    assert.ok(Object.isFrozen(result.result));
  }
  for (const status of ['unpublished', 'paused', 'archived']) {
    const before = {
      ...current(),
      publicationStatus: status,
      archivedAt: status === 'archived' ? '2090-01-30T12:00:00.000Z' : null,
    };
    const result = plan(availability(), before, 'agent', now);
    assert.equal(result.result.publicationStatus, status);
    assert.equal(result.result.archivedAt, before.archivedAt);
  }
});
test('agents may pause but cannot publish, archive or reopen archived stock; admins explicitly reopen', () => {
  for (const c of [publication(), publication('archived')])
    assert.throws(
      () => plan(c, current(), 'agent', now),
      (e) => e.code === 'LISTING_CONTROL_FORBIDDEN',
    );
  const archived = {
    ...current(),
    publicationStatus: 'archived',
    archivedAt: '2090-01-30T12:00:00.000Z',
  };
  assert.throws(
    () => plan(publication('paused'), archived, 'agent', now),
    (e) => e.code === 'LISTING_CONTROL_FORBIDDEN',
  );
  assert.equal(
    plan(publication('paused'), current(), 'agent', now).result.publicationStatus,
    'paused',
  );
  const reopened = plan(publication(), archived, 'admin', now);
  assert.equal(reopened.result.publicationStatus, 'published');
  assert.equal(reopened.result.archivedAt, null);
  assert.equal(reopened.result.lastAvailabilityConfirmedAt, archived.lastAvailabilityConfirmedAt);
  assert.equal(reopened.result.approvedSnapshotRevision, archived.approvedSnapshotRevision);
  const hidden = plan(publication('archived'), current(), 'admin', now);
  assert.equal(hidden.result.archivedAt, now);
  assert.equal(hidden.result.availability, current().availability);
  assert.equal(hidden.result.publishedRevision, 1);
  assert.throws(
    () => plan(publication('published', '2'), current(), 'agent', now),
    (e) => e.code === 'LISTING_CONTROL_FORBIDDEN',
  );
});
test('publish requires matching approved snapshot, available stock and strictly fresh confirmation', () => {
  for (const patch of [
    { publicationStatus: 'paused', publishedRevision: null, approvedSnapshotRevision: null },
    { approvedSnapshotRevision: null },
    { approvedSnapshotRevision: 2 },
    { availability: 'reserved' },
    { lastAvailabilityConfirmedAt: null },
    { lastAvailabilityConfirmedAt: '2090-01-02T12:00:00.000000Z' },
  ])
    assert.deepEqual(plan(publication(), { ...current(), ...patch }, 'admin', now), {
      outcome: 'refused',
      reason: 'APPROVED_PUBLICATION_REQUIRED',
      result: null,
    });
  const edge = { ...current(), lastAvailabilityConfirmedAt: '2090-01-02T12:00:00.000001Z' };
  assert.equal(plan(publication(), edge, 'admin', now).outcome, 'planned');
  assert.equal(
    plan(publication(), { ...current(), lastAvailabilityConfirmedAt: now }, 'admin', now).outcome,
    'planned',
  );
});
test('future confirmation is refused at microsecond precision while safety pause/archive remain possible', () => {
  const future = { ...current(), lastAvailabilityConfirmedAt: '2090-02-01T12:00:00.000001Z' };
  for (const c of [availability(), publication()])
    assert.deepEqual(plan(c, future, 'admin', now), {
      outcome: 'refused',
      reason: 'CONFIRMATION_CLOCK_INVALID',
      result: null,
    });
  for (const c of [publication('paused'), publication('archived')])
    assert.equal(plan(c, future, 'admin', now).outcome, 'planned');
  const refreshed = plan(availability(), current(), 'agent', '2090-02-01T12:00:00.000Z');
  assert.equal(refreshed.result.lastAvailabilityConfirmedAt, '2090-02-01T12:00:00.000Z');
});
test('stale commands conflict before business refusal and safe integer exhaustion refuses without mutation', () => {
  assert.deepEqual(
    plan(publication('published', '2'), { ...current(), availability: 'sold' }, 'admin', now),
    { outcome: 'conflict', reason: 'LISTING_CHANGED', result: null },
  );
  const max = { ...current(), version: '9007199254740991' };
  assert.deepEqual(plan(publication('paused', max.version), max, 'admin', now), {
    outcome: 'refused',
    reason: 'VERSION_LIMIT',
    result: null,
  });
  const near = { ...current(), version: '9007199254740990' };
  assert.equal(
    plan(availability('available', near.version), near, 'agent', now).result.version,
    max.version,
  );
  invalid(() => facts({ ...current(), listingId: id(20) }, id(10)));
  invalid(() => plan(availability(), { ...current(), version: '9007199254740992' }, 'admin', now));
});
test('current facts and calendar clocks fail closed; repeated confirmations remain explicit versioned writes', () => {
  for (const patch of [
    { publicationStatus: 'archived' },
    { archivedAt: now },
    { publishedRevision: null },
    { lastAvailabilityConfirmedAt: '2090-02-30T12:00:00.000Z' },
    { approvedSnapshotRevision: 0 },
  ])
    invalid(() => facts({ ...current(), ...patch }, id(10)));
  for (const clock of [
    '2090-02-30T12:00:00.000Z',
    '0000-01-01T00:00:00.000Z',
    '2090-02-01T12:00:00Z',
    '2090-02-01T12:00:00.0000000Z',
    '2090-02-01T12:00:00.000+00:00',
  ])
    invalid(() => plan(availability(), current(), 'admin', clock));
  const first = plan(availability(), current(), 'agent', now).result;
  const second = plan(availability('available', '4'), first, 'agent', now);
  assert.equal(second.result.version, '5');
  assert.equal(second.result.publishedRevision, 1);
});
test('original receipts bind exact kind, target, actor and next version and never adopt later state', () => {
  for (const c of [availability('sold'), publication('archived')]) {
    const wire = original(c),
      saved = receipt(wire, c, id(11));
    assert.deepEqual(snapshot(wire, c.listingId, c.operationId, c.kind, id(11)), saved);
    assert.ok(Object.isFrozen(saved.request));
    assert.ok(Object.isFrozen(saved.decision.result));
    wire.decision.result.listingVersion = '20';
    assert.equal(saved.decision.result.listingVersion, '4');
    invalid(() => receipt(wire, c, id(11)));
    for (const patch of [
      { operationId: id(98) },
      { listingId: id(12) },
      { actorId: id(11).toUpperCase() },
      { operationId: id(99).toUpperCase() },
      { kind: 'other' },
      { extra: true },
    ])
      invalid(() => receipt({ ...original(c), ...patch }, c, id(11)));
    invalid(() => receipt(original(c), c, id(12)));
    invalid(() => snapshot(original(c), id(12), c.operationId, c.kind, id(11)));
    invalid(() =>
      snapshot(
        original(c),
        c.listingId,
        c.operationId,
        c.kind === 'confirm_availability' ? 'set_publication' : 'confirm_availability',
        id(11),
      ),
    );
  }
});
test('original refusals/conflicts are strict, compatible with intent and bounded-version precedence', () => {
  const declined = (reason) => ({ outcome: 'refused', reason, result: null });
  for (const reason of ['APPROVED_PUBLICATION_REQUIRED', 'CONFIRMATION_CLOCK_INVALID'])
    assert.equal(
      receipt(original(publication(), declined(reason)), publication()).decision.reason,
      reason,
    );
  const max = availability('available', '9007199254740991');
  assert.equal(
    receipt(original(max, declined('VERSION_LIMIT')), max).decision.reason,
    'VERSION_LIMIT',
  );
  for (const [c, reason] of [
    [availability(), 'APPROVED_PUBLICATION_REQUIRED'],
    [publication('paused'), 'CONFIRMATION_CLOCK_INVALID'],
    [availability(), 'VERSION_LIMIT'],
    [max, 'CONFIRMATION_CLOCK_INVALID'],
  ])
    invalid(() => receipt(original(c, declined(reason)), c));
  const conflict = { outcome: 'conflict', reason: 'LISTING_CHANGED', result: null };
  assert.deepEqual(receipt(original(availability(), conflict), availability()).decision, conflict);
  invalid(() =>
    receipt(
      original(availability(), { ...conflict, result: { listingVersion: '4' } }),
      availability(),
    ),
  );
  invalid(() =>
    receipt(
      original(max, {
        outcome: 'applied',
        reason: null,
        result: { listingVersion: '9007199254740992' },
      }),
      max,
    ),
  );
});
test('receipt preserves original completion precision and rejects altered request fields or malformed result shapes', () => {
  const c = publication('paused');
  assert.equal(receipt(original(c), c).completedAt, now);
  for (const patch of [
    { completedAt: '2090-02-30T12:00:00.000Z' },
    { request: { ...original(c).request, publicationStatus: 'archived' } },
    { request: { ...original(c).request, expectedListingVersion: '4' } },
    {
      decision: {
        outcome: 'applied',
        reason: null,
        result: { listingVersion: '4', publicationStatus: 'paused' },
      },
    },
  ])
    invalid(() => receipt({ ...original(c), ...patch }, c));
  let read = false;
  const wire = original(c);
  Object.defineProperty(wire.request, 'publicationStatus', {
    enumerable: true,
    get() {
      read = true;
      return 'paused';
    },
  });
  invalid(() => receipt(wire, c));
  assert.equal(read, false);
});

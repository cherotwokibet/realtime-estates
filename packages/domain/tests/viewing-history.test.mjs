import assert from 'node:assert/strict';
import test from 'node:test';
import { validateViewingHistoryPage } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = {
  startAt: '2090-01-01T09:00:00.000Z',
  endAt: '2090-01-01T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const requested = {
  viewingId: id(1),
  enquiryId: id(2),
  listingId: id(3),
  version: '1',
  status: 'requested',
  preferredSlots: [],
  proposedSlot: null,
};
const proposed = { ...requested, version: '2', status: 'proposed', proposedSlot: slot };
const confirmed = {
  ...proposed,
  version: '3',
  status: 'confirmed',
  agreement: {
    channel: 'phone',
    agreedAt: '2026-10-14T18:30:00.000Z',
    notes: 'Original phone evidence.',
  },
};
const ended = {
  ...confirmed,
  version: '4',
  status: 'cancelled',
  termination: {
    kind: 'cancel',
    fromStatus: 'confirmed',
    reason: '  Exact ending reason.  ',
    previousUpdatedAt: '2026-10-14T19:00:00.000Z',
    endedAt: '2026-10-14T20:00:00.000Z',
  },
};
const event = (kind, hour, schedule) => ({
  kind,
  actorId: id(4),
  recordedAt: `2026-10-14T${hour}:00:00.000Z`,
  schedule,
});
const page = () =>
  structuredClone({
    items: [
      event('cancel', '20', ended),
      event('confirm', '19', confirmed),
      event('propose', '18', proposed),
      event('request', '17', requested),
    ],
    limit: 25,
    truncated: false,
    currentVersion: '4',
  });
const valid = (p, limit = 25) => validateViewingHistoryPage(p, id(2), id(1), limit);
test('viewing history freezes ordered saved states and preserves original agreement through cancellation', () => {
  const raw = page(),
    saved = valid(raw);
  assert.deepEqual(saved, raw);
  assert.ok(Object.isFrozen(saved.items) && Object.isFrozen(saved.items[0].schedule.termination));
  raw.items[1].schedule.agreement.notes = 'changed';
  assert.equal(saved.items[1].schedule.agreement.notes, 'Original phone evidence.');
  assert.deepEqual(
    saved.items.map((x) => x.kind),
    ['cancel', 'confirm', 'propose', 'request'],
  );
});
test('viewing history bounds explicit truncation and requires exact latest current version and contiguous records', () => {
  assert.equal(
    valid({ ...page(), items: page().items.slice(0, 2), limit: 2, truncated: true }, 2).items
      .length,
    2,
  );
  for (const patch of [
    { currentVersion: '3' },
    { items: page().items.slice(1) },
    { items: [...page().items.slice(0, 2), page().items[3]] },
    { truncated: true },
    { limit: 26 },
    { items: [] },
  ])
    assert.throws(() => valid({ ...page(), ...patch }));
});
test('history rejects original command keys,foreign targets,kind/state mismatch and inverted time', () => {
  for (const patch of [
    { operationId: id(9) },
    { actorId: 'invented' },
    { kind: 'decline' },
    { recordedAt: '2026-10-14T18:00:00.000Z' },
    { schedule: { ...ended, viewingId: id(9) } },
  ]) {
    const raw = page();
    raw.items[0] = { ...raw.items[0], ...patch };
    assert.throws(() => valid(raw));
  }
  assert.throws(() => validateViewingHistoryPage(page(), id(9), id(1), 25));
});
test('history refuses altered preferences,prior recorded time or agreement across adjacent saved states', () => {
  for (const change of [
    (raw) => {
      raw.items[1].schedule = { ...confirmed, preferredSlots: [slot] };
    },
    (raw) => {
      raw.items[1].schedule = {
        ...confirmed,
        agreement: { ...confirmed.agreement, notes: 'changed' },
      };
    },
    (raw) => {
      raw.items[0].schedule = {
        ...ended,
        termination: { ...ended.termination, previousUpdatedAt: '2026-10-14T18:59:59.999Z' },
      };
    },
    (raw) => {
      raw.items[2].recordedAt = '2026-10-14T18:45:00.000Z';
    },
  ]) {
    const raw = page();
    change(raw);
    assert.throws(() => valid(raw));
  }
});
test('history rejects sparse,hidden and getter records without executing caller getters', () => {
  let touched = false;
  const raw = page();
  Object.defineProperty(raw.items[0], 'schedule', {
    enumerable: true,
    get() {
      touched = true;
      return ended;
    },
  });
  assert.throws(() => valid(raw));
  assert.equal(touched, false);
  const sparse = page();
  delete sparse.items[1];
  assert.throws(() => valid(sparse));
  const hidden = page();
  Object.defineProperty(hidden, 'command', { value: 'private' });
  assert.throws(() => valid(hidden));
});

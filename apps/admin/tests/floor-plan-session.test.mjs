import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import { floorPlanAttempt, floorPlanSession } from '../dist/tests/lib/floor-plan-session.js';
import { floorPlanOriginalKey } from '../dist/tests/lib/floor-plan-original-key.js';
import { videoAttempt, videoSession } from '../dist/tests/lib/listing-video-session.js';
import {
  assertReferenceAuthorDraftClear,
  assertReferenceDraftAuthorClear,
} from '../dist/tests/lib/reference-author-policy.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(1), tenantId: id(2), actorId: id(3), listingId: id(4), revision: 1 };
const preparation = () => ({
  policy: 'synthetic-floor-plan-preparation-command-v1',
  listingId: scope.listingId,
  revision: 1,
  expectedVersion: '2',
  requestId: id(5),
});
const prepared = (c) => ({
  ...c,
  policy: 'synthetic-floor-plan-prepared-v1',
  width: 100,
  height: 100,
  bytes: 100,
  sha256: 'a'.repeat(64),
});
const attachment = () => ({
  policy: 'synthetic-floor-plan-attachment-command-v1',
  listingId: scope.listingId,
  revision: 1,
  expectedVersion: '2',
  requestId: id(5),
  operationId: id(6),
});
const record = (c) => ({
  policy: 'synthetic-floor-plan-attachment-v1',
  command: c,
  actorId: scope.actorId,
  resultVersion: '3',
  floorPlan:
    c.requestId === null
      ? null
      : {
          operationId: c.operationId,
          requestId: c.requestId,
          width: 100,
          height: 100,
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
});
const storage = () => ({
  values: new Map(),
  getItem(k) {
    return this.values.get(k) ?? null;
  },
  setItem(k, v) {
    this.values.set(k, v);
  },
  removeItem(k) {
    this.values.delete(k);
  },
});
const client = () => ({
  prepare: async (c) => prepared(c),
  recoverPreparation: async (c) => prepared(c),
  attach: async (c) => record(c),
  recoverAttachment: async (c) => record(c),
});
test('preparation retains exact scoped original before dispatch and reload only recovers without persisting source', async () => {
  const st = storage(),
    seen = [],
    api = {
      ...client(),
      prepare: async (c, source) => {
        seen.push('PUT');
        assert.equal(floorPlanSession(st, scope).load().command.requestId, c.requestId);
        assert.ok(![...st.values.values()].join('').includes('SOURCE_PRIVATE_BYTES'));
        throw new ApiClientError('NETWORK', 'Lost', { submissionUncertain: true });
      },
      recoverPreparation: async (c) => {
        seen.push('GET');
        return prepared(c);
      },
    };
  const c = preparation(),
    a = floorPlanAttempt(st, scope, api, c);
  c.expectedVersion = '99';
  assert.equal(a.command.expectedVersion, '2');
  assert.equal(seen.length, 0);
  await assert.rejects(a.send(new TextEncoder().encode('SOURCE_PRIVATE_BYTES')));
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.clear());
  const saved = floorPlanSession(st, scope).load(),
    b = floorPlanAttempt(st, scope, api, saved.command, true);
  assert.deepEqual(seen, ['PUT']);
  assert.equal(b.status, 'uncertain');
  await assert.rejects(b.send(new Uint8Array([1])));
  await b.recover();
  assert.deepEqual(seen, ['PUT', 'GET']);
  assert.equal(b.status, 'resolved');
});
test('resolved preparation hands off atomically to exact attachment and recovery issues no second write', async () => {
  const st = storage(),
    seen = [],
    api = {
      ...client(),
      attach: async (c) => {
        seen.push('POST');
        throw new ApiClientError('NETWORK', 'Lost', { submissionUncertain: true });
      },
      recoverAttachment: async (c) => {
        seen.push('GET');
        return record(c);
      },
    };
  const a = floorPlanAttempt(st, scope, api, preparation());
  await a.send(new Uint8Array([1]));
  assert.throws(() => a.handoff({ ...attachment(), requestId: id(99) }));
  assert.equal(floorPlanSession(st, scope).load().command.policy, preparation().policy);
  const b = a.handoff(attachment());
  assert.equal(st.values.size, 1);
  assert.equal(b.status, 'prepared');
  assert.equal(floorPlanSession(st, scope).load().command.operationId, attachment().operationId);
  assert.throws(() => a.clear());
  await assert.rejects(b.send());
  const saved = floorPlanSession(st, scope).load(),
    restored = floorPlanAttempt(st, scope, api, saved.command, true);
  await restored.recover();
  assert.deepEqual(seen, ['POST', 'GET']);
  restored.clear();
  assert.equal(st.values.size, 0);
});
test('retained floor-plan originals reciprocally lock draft, video and author transitions across revisions', () => {
  const st = storage(),
    a = floorPlanAttempt(st, scope, client(), preparation()),
    draft = { ...scope };
  delete draft.revision;
  assert.throws(() => assertReferenceAuthorDraftClear(st, draft));
  assert.throws(() => assertReferenceDraftAuthorClear(st, draft, 2));
  assert.throws(() =>
    videoAttempt(
      st,
      scope,
      { save: async () => {}, recover: async () => {} },
      {
        policy: 'synthetic-listing-video-command-v1',
        operationId: id(20),
        listingId: scope.listingId,
        revision: 1,
        expectedVersion: '2',
        video: null,
      },
    ),
  );
  assert.throws(() => floorPlanAttempt(st, scope, client(), preparation()));
  a.clear();
  videoSession(st, scope).retain({
    policy: 'synthetic-listing-video-command-v1',
    operationId: id(20),
    listingId: scope.listingId,
    revision: 1,
    expectedVersion: '2',
    video: null,
  });
  assert.throws(() => floorPlanAttempt(st, scope, client(), preparation()));
});
test('foreign, malformed, duplicate-field and enlarged storage entries stay preserved and locked', () => {
  const st = storage(),
    a = floorPlanAttempt(st, scope, client(), preparation()),
    key = floorPlanOriginalKey(scope.instanceId, scope.listingId),
    raw = st.getItem(key);
  for (const change of [{ actorId: id(99) }, { tenantId: id(99) }, { revision: 2 }])
    assert.throws(() => floorPlanSession(st, { ...scope, ...change }).load());
  assert.equal(st.getItem(key), raw);
  for (const malformed of [
    '{bad',
    raw.replace('"schema":', '"schema":"duplicate","schema":'),
    'x'.repeat(8193),
  ]) {
    st.setItem(key, malformed);
    assert.throws(() => floorPlanSession(st, scope).load());
    assert.throws(() => floorPlanAttempt(st, scope, client(), preparation()));
    assert.equal(st.getItem(key), malformed);
  }
  void a;
});
test('only initial explicit nonwrite refusals become discardable; uncertain recovery refusals remain locked', async () => {
  const st = storage(),
    api = {
      ...client(),
      prepare: async () => {
        throw new ApiClientError('HTTP', 'Refused', { status: 409, submissionUncertain: false });
      },
    },
    a = floorPlanAttempt(st, scope, api, preparation());
  await assert.rejects(a.send(new Uint8Array([1])));
  assert.equal(a.status, 'refused');
  const b = floorPlanAttempt(st, scope, api, preparation(), true);
  assert.equal(b.status, 'refused');
  b.clear();
  const lost = {
      ...client(),
      prepare: async () => {
        throw Error('Unconfirmed');
      },
      recoverPreparation: async () => {
        throw new ApiClientError('HTTP', 'Missing', { status: 404, submissionUncertain: false });
      },
    },
    c = floorPlanAttempt(st, scope, lost, preparation());
  await assert.rejects(c.send(new Uint8Array([1])));
  await assert.rejects(c.recover());
  assert.equal(c.status, 'uncertain');
  assert.throws(() => c.clear());
});
test('cancelled and concurrent sends never create a second dispatch and resolved foreign receipts remain uncertain', async () => {
  const st = storage();
  let release,
    started,
    writes = 0;
  const ready = new Promise((r) => (started = r)),
    held = new Promise((r) => (release = r)),
    api = {
      ...client(),
      prepare: async (c) => {
        writes++;
        started();
        await held;
        return prepared(c);
      },
    };
  const a = floorPlanAttempt(st, scope, api, preparation()),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(a.send(new Uint8Array([1]), abort.signal));
  assert.equal(a.status, 'prepared');
  assert.equal(writes, 0);
  const pending = a.send(new Uint8Array([1]));
  await ready;
  await assert.rejects(a.send(new Uint8Array([1])));
  assert.throws(() => a.clear());
  release();
  await pending;
  assert.equal(writes, 1);
  a.clear();
  const b = floorPlanAttempt(
    st,
    scope,
    { ...client(), attach: async (c) => ({ ...record(c), actorId: id(99) }) },
    attachment(),
  );
  await assert.rejects(b.send());
  assert.equal(b.status, 'uncertain');
  assert.throws(() => b.clear());
});
test('storage failure prevents dispatch and changed originals are never overwritten after asynchronous work', async () => {
  let writes = 0;
  const broken = {
    ...storage(),
    setItem() {
      throw Error('Full');
    },
  };
  assert.throws(() =>
    floorPlanAttempt(
      broken,
      scope,
      {
        ...client(),
        prepare: async () => {
          writes++;
        },
      },
      preparation(),
    ),
  );
  assert.equal(writes, 0);
  const st = storage(),
    key = floorPlanOriginalKey(scope.instanceId, scope.listingId);
  let release, started;
  const ready = new Promise((r) => (started = r)),
    held = new Promise((r) => (release = r));
  const a = floorPlanAttempt(
      st,
      scope,
      {
        ...client(),
        prepare: async (c) => {
          started();
          await held;
          return prepared(c);
        },
      },
      preparation(),
    ),
    pending = a.send(new Uint8Array([1]));
  await ready;
  const changed = st.getItem(key).replace(id(5), id(99));
  st.setItem(key, changed);
  release();
  await assert.rejects(pending);
  assert.equal(st.getItem(key), changed);
  assert.equal(a.status, 'uncertain');
});

test('outcome persistence failure after a successful write stays locked and recovery never resends the source', async () => {
  const st = storage(),
    set = st.setItem.bind(st);
  let fail = true,
    puts = 0,
    gets = 0;
  st.setItem = (key, value) => {
    if (fail && JSON.parse(value).outcome === 'resolved') throw Error('Storage full');
    set(key, value);
  };
  const api = {
    ...client(),
    prepare: async (c) => {
      puts++;
      return prepared(c);
    },
    recoverPreparation: async (c) => {
      gets++;
      return prepared(c);
    },
  };
  const a = floorPlanAttempt(st, scope, api, preparation());
  await assert.rejects(a.send(new Uint8Array([1])));
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.clear());
  assert.equal(floorPlanSession(st, scope).load().outcome, 'uncertain');
  fail = false;
  const b = floorPlanAttempt(st, scope, api, preparation(), true);
  await b.recover();
  assert.equal(puts, 1);
  assert.equal(gets, 1);
  assert.equal(b.status, 'resolved');
});

// Cross-workspace invariants: preparation is blocked, but explicit same-original
// recovery stays possible while another retained workflow is present.
test('combined floor, video, reference draft and author-transition matrix preserves every retained original', async () => {
  const {
    scope: scopeFactory,
    catalogue,
    command: reviewCommand,
    id: rid,
  } = await import('../test-helpers/reference-moderation-fixture.mjs');
  const { referenceDraftSession } = await import('../dist/tests/lib/reference-draft-workspace.js');
  const { referenceModerationSession } =
    await import('../dist/tests/lib/reference-moderation-workspace.js');
  const sc = scopeFactory(),
    { revision, ...draftScope } = sc,
    cat = catalogue();
  const floor = { ...preparation(), listingId: sc.listingId };
  const video = {
    policy: 'synthetic-listing-video-command-v1',
    listingId: sc.listingId,
    revision: 1,
    expectedVersion: '3',
    operationId: rid(700),
    video: null,
  };
  const hold = {
    floor: (st) => floorPlanSession(st, sc).retain(floor),
    video: (st) => videoSession(st, sc).retain(video),
    draft: (st) =>
      referenceDraftSession(st, draftScope).retain(
        {
          policy: 'synthetic-reference-draft-v1',
          operationId: rid(701),
          listingId: sc.listingId,
          revision: 1,
          expectedVersion: '3',
          content: reviewCommand().review.content,
          selection: {
            catalogueVersion: '1',
            location: { countyId: rid(200), localityId: null, neighbourhoodId: null },
            amenityIds: [],
          },
        },
        cat,
      ),
    author: (st) =>
      referenceModerationSession(st, sc, 'author').retain(
        { ...reviewCommand(), action: 'withdraw' },
        cat,
      ),
  };
  for (const [kind, retain] of Object.entries(hold)) {
    const st = storage();
    retain(st);
    const before = [...st.values.entries()];
    assert.throws(() => floorPlanAttempt(st, sc, client(), floor), kind + ' floor');
    assert.throws(
      () => videoAttempt(st, sc, { save: async () => {}, recover: async () => {} }, video),
      kind + ' video',
    );
    if (kind !== 'draft')
      assert.throws(
        () => assertReferenceDraftAuthorClear(st, draftScope, revision),
        kind + ' draft',
      );
    if (kind !== 'author')
      assert.throws(() => assertReferenceAuthorDraftClear(st, draftScope), kind + ' transition');
    assert.deepEqual([...st.values.entries()], before, kind + ' original preserved');
  }
});

test('explicit floor recovery remains read-only while a retained video blocks every new write', async () => {
  const st = storage();
  let posts = 0,
    gets = 0;
  const api = {
    ...client(),
    prepare: async () => {
      posts++;
      throw new ApiClientError('NETWORK', 'lost', { submissionUncertain: true });
    },
    recoverPreparation: async (c) => {
      gets++;
      return prepared(c);
    },
  };
  const a = floorPlanAttempt(st, scope, api, preparation());
  await assert.rejects(() => a.send(new Uint8Array([1])));
  videoSession(st, scope).retain({
    policy: 'synthetic-listing-video-command-v1',
    listingId: scope.listingId,
    revision: 1,
    expectedVersion: '2',
    operationId: id(70),
    video: null,
  });
  const videoBefore = [...st.values.entries()].find(([k]) => k.includes('video'));
  const recovered = floorPlanAttempt(st, scope, api, preparation(), true);
  await recovered.recover();
  assert.equal(posts, 1);
  assert.equal(gets, 1);
  assert.throws(() => recovered.handoff(attachment()));
  assert.deepEqual(
    [...st.values.entries()].find(([k]) => k.includes('video')),
    videoBefore,
  );
  recovered.clear();
  assert.equal(st.values.size, 1);
  assert.throws(() => floorPlanAttempt(st, scope, api, preparation()));
});

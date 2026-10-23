import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import { normalizeStaffDraftContentV2, snapshotListingReferenceAttributes } from '@realtor/domain';
import {
  buildReferenceDraftCommand,
  referenceDraftSession,
  prepareReferenceDraftAttempt,
  restoreReferenceDraftAttempt,
} from '../dist/tests/lib/reference-draft-workspace.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) };
const cat = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [
    { id: id(200), kind: 'county', parentId: null, label: 'Synthetic county' },
    { id: id(201), kind: 'locality', parentId: id(200), label: 'Synthetic town' },
  ],
  amenities: [
    { id: id(210), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['apartment'] },
  ],
});
const content = () =>
  normalizeStaffDraftContentV2({
    propertyType: 'apartment',
    title: 'Synthetic draft',
    locality: 'Legacy unrelated text',
    location: { county: 'Legacy unrelated county', town: null, area: null },
    privateAddress: 'Synthetic private address',
    pricing: { declaration: 'complete', charges: [] },
  });
const command = () =>
  buildReferenceDraftCommand(
    {
      operationId: id(300),
      listingId: id(100),
      revision: 1,
      expectedVersion: '2',
      content: content(),
      selection: {
        catalogueVersion: '1',
        location: { countyId: id(200), localityId: id(201), neighbourhoodId: null },
        amenityIds: [id(210)],
      },
    },
    cat(),
  );
const receipt = (c) => ({
  ...c,
  actorId: id(10),
  revisionVersion: '3',
  attributes: snapshotListingReferenceAttributes(c.selection, cat(), c.content.propertyType),
});
function memory() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
function client() {
  const calls = [];
  return {
    calls,
    async catalogue(version) {
      calls.push(['catalogue', version]);
      assert.equal(version, '1');
      return cat();
    },
    async create(c) {
      calls.push(['POST', c]);
      return receipt(c);
    },
    async recover(c) {
      calls.push(['GET', c]);
      return receipt(c);
    },
  };
}
test('explicit picker adoption derives labels from IDs, retains private/pricing facts and never maps old text', () => {
  const c = command();
  assert.equal(c.content.locality, 'Synthetic town');
  assert.deepEqual(c.content.location, {
    county: 'Synthetic county',
    town: 'Synthetic town',
    area: null,
  });
  assert.equal(c.content.privateAddress, content().privateAddress);
  assert.deepEqual(c.content.pricing, content().pricing);
  const { policy, ...base } = c;
  const unknown = buildReferenceDraftCommand(
    {
      ...base,
      selection: {
        ...c.selection,
        location: { countyId: null, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    cat(),
  );
  assert.equal(unknown.content.locality, null);
  assert.deepEqual(unknown.content.location, { county: null, town: null, area: null });
  assert.throws(() =>
    buildReferenceDraftCommand(
      { ...base, content: { ...c.content, propertyType: 'land', bedrooms: null } },
      cat(),
    ),
  );
  let reads = 0;
  const getter = { ...base };
  Object.defineProperty(getter, 'content', {
    enumerable: true,
    get() {
      reads++;
      return content();
    },
  });
  assert.throws(() => buildReferenceDraftCommand(getter, cat()));
  assert.equal(reads, 0);
});
test('session stores bounded original command/version/scope, not full catalogue or credentials', () => {
  const store = memory(),
    session = referenceDraftSession(store, scope);
  session.retain(command(), cat());
  const raw = [...store.map.values()][0];
  assert.ok(raw.length < 163840);
  assert.equal(raw.includes('"catalogue":'), false);
  assert.equal(raw.includes('bearerToken'), false);
  assert.deepEqual(session.load().candidate, command());
  for (const patch of [
    { actorId: id(11) },
    { tenantId: id(2) },
    { instanceId: id(8) },
    { listingId: id(101) },
  ])
    assert.equal(referenceDraftSession(store, { ...scope, ...patch }).load(), null);
  session.clear(command());
  assert.equal(session.load(), null);
});
test('persistence/readback failure prevents every POST and a retained different original cannot be overwritten', async () => {
  for (const store of [
    {
      getItem: () => null,
      setItem() {
        throw Error('Synthetic quota');
      },
      removeItem() {},
    },
    { getItem: () => null, setItem() {}, removeItem() {} },
  ]) {
    const c = client(),
      a = prepareReferenceDraftAttempt(c, referenceDraftSession(store, scope), command(), cat());
    await assert.rejects(() => a.submit());
    assert.equal(c.calls.length, 0);
    assert.equal(a.status, 'ready');
  }
  const store = memory(),
    session = referenceDraftSession(store, scope);
  session.retain(command(), cat());
  assert.throws(() =>
    prepareReferenceDraftAttempt(client(), session, { ...command(), operationId: id(301) }, cat()),
  );
  assert.throws(() => session.retain({ ...command(), operationId: id(301) }, cat()));
  assert.deepEqual(session.load().candidate, command());
});
test('single flight captures exact original before dispatch and confirmed receipt requires explicit clearing', async () => {
  const store = memory(),
    session = referenceDraftSession(store, scope),
    c = client();
  let finish;
  c.create = async (original) => {
    assert.deepEqual(session.load().candidate, original);
    return new Promise((resolve) => {
      finish = () => resolve(receipt(original));
    });
  };
  const input = structuredClone(command()),
    a = prepareReferenceDraftAttempt(c, session, input, cat()),
    pending = a.submit();
  input.content.title = 'Edited after dispatch';
  assert.equal(a.status, 'sending');
  assert.equal(a.canDiscard, false);
  assert.throws(() => a.discard());
  await assert.rejects(() => a.submit());
  finish();
  assert.equal((await pending).content.title, 'Synthetic draft');
  assert.equal(a.status, 'received');
  assert.ok(session.load());
  a.discard();
  assert.equal(session.load(), null);
  await assert.rejects(() => a.submit());
});
test('lost POST remains uncertain through failed403/404 recovery and blocks discard or replacement', async () => {
  const session = referenceDraftSession(memory(), scope),
    c = client();
  c.create = async () => {
    throw new ApiClientError('NETWORK', 'Lost response', { submissionUncertain: true });
  };
  let status = 403;
  c.recover = async () => {
    throw new ApiClientError('HTTP', 'Access unavailable', { status });
  };
  const a = prepareReferenceDraftAttempt(c, session, command(), cat());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.discard());
  await assert.rejects(() => a.submit());
  await assert.rejects(
    () => a.recoverOriginal(),
    (error) => error.status === 403,
  );
  assert.equal(a.status, 'uncertain');
  status = 404;
  await assert.rejects(
    () => a.recoverOriginal(),
    (error) => error.status === 404,
  );
  assert.equal(a.canDiscard, false);
  assert.ok(session.load());
});
test('reload fetches retained historical version, restores uncertainty and never automatically replays', async () => {
  const session = referenceDraftSession(memory(), scope);
  session.retain(command(), cat());
  const c = client(),
    a = await restoreReferenceDraftAttempt(c, session);
  assert.deepEqual(c.calls, [['catalogue', '1']]);
  assert.equal(a.status, 'uncertain');
  await assert.rejects(() => a.submit());
  assert.deepEqual(await a.recoverOriginal(), receipt(command()));
  assert.deepEqual(
    c.calls.map((x) => x[0]),
    ['catalogue', 'GET'],
  );
  a.discard();
  assert.equal(session.load(), null);
});
test('known refusal is discardable but malformed or late cancelled writes preserve their original', async () => {
  const c = client(),
    session = referenceDraftSession(memory(), scope);
  c.create = async () => {
    throw new ApiClientError('HTTP', 'Conflict', { status: 409 });
  };
  const a = prepareReferenceDraftAttempt(c, session, command(), cat());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'rejected');
  a.discard();
  assert.equal(session.load(), null);
  const malformed = client();
  malformed.create = async (c) => ({ ...receipt(c), actorId: id(11) });
  const bad = prepareReferenceDraftAttempt(
    malformed,
    referenceDraftSession(memory(), scope),
    command(),
    cat(),
  );
  await assert.rejects(() => bad.submit());
  assert.equal(bad.status, 'uncertain');
  const late = client(),
    abort = new AbortController();
  late.create = async (c) => {
    abort.abort();
    return receipt(c);
  };
  const b = prepareReferenceDraftAttempt(
    late,
    referenceDraftSession(memory(), scope),
    command(),
    cat(),
  );
  await assert.rejects(() => b.submit(abort.signal));
  assert.equal(b.status, 'uncertain');
});
test('corrupt scope, wire duplicates, fractional revision and oversized persistence fail before catalogue fetch', async () => {
  for (const change of [
    (raw) => raw.replace('"actorId":"' + id(10) + '"', '"actorId":"' + id(11) + '"'),
    (raw) => raw.replace('"revision":1', '"revision":1.0'),
    (raw) => raw.replace('"revision":1', '"revision":1,"revision":1'),
    () => '{invalid',
    () => ' '.repeat(163841),
  ]) {
    const store = memory(),
      session = referenceDraftSession(store, scope);
    session.retain(command(), cat());
    const key = [...store.map.keys()][0];
    store.map.set(key, change(store.map.get(key)));
    const c = client();
    await assert.rejects(() => restoreReferenceDraftAttempt(c, session));
    assert.equal(c.calls.length, 0);
    assert.ok(store.map.has(key));
  }
});

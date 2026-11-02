import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import {
  referenceTransitionActions as actions,
  assertReferenceDraftAuthorClear as authorClear,
  assertReferenceAuthorDraftClear as draftClear,
} from '../dist/tests/lib/reference-author-policy.js';
import {
  referenceModerationSession as session,
  prepareReferenceModerationAttempt as prepare,
  restoreReferenceModerationAttempt as restore,
} from '../dist/tests/lib/reference-moderation-workspace.js';
import { referenceDraftSession } from '../dist/tests/lib/reference-draft-workspace.js';
import {
  id,
  scope,
  catalogue,
  command,
  receipt,
} from '../test-helpers/reference-moderation-fixture.mjs';
const store = () => {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};
test('author actions are submit for draft and withdraw for pending only; review retains its own decisions', () => {
  assert.deepEqual(actions('author', 'draft'), ['submit']);
  assert.deepEqual(actions('author', 'pending'), ['withdraw']);
  for (const state of ['approved', 'rejected', 'ordinary-v2', undefined])
    assert.deepEqual(actions('author', state), []);
  assert.deepEqual(actions('review', 'pending'), ['approve', 'reject']);
  assert.deepEqual(actions('review', 'draft'), []);
  assert.ok(Object.isFrozen(actions('author', 'draft')));
});
test('author originals use a distinct key and reject reviewer actions without erasing either original', () => {
  const st = store(),
    a = session(st, scope(), 'author'),
    r = session(st, scope());
  const c = { ...command(), action: 'withdraw' };
  r.retain(command(), catalogue());
  assert.throws(() => a.retain(command(), catalogue()));
  a.retain(c, catalogue());
  assert.equal(st.data.size, 2);
  assert.ok(r.load());
  assert.ok(a.load());
  assert.equal([...st.data.keys()].filter((k) => k.includes('author-original')).length, 1);
  const authorKey = [...st.data.keys()].find((k) => k.includes('author-original'));
  st.setItem(
    authorKey,
    st.getItem([...st.data.keys()].find((k) => k.includes('moderation-original'))),
  );
  assert.throws(() => a.load());
  assert.ok(r.load());
});
test('author committed-reply loss restores the same snapshot and performs original read only, without another transition', async () => {
  const st = store(),
    c = { ...command(), action: 'withdraw' },
    result = { ...receipt(), ...c, state: 'draft' };
  let writes = 0,
    reads = 0;
  const api = {
    catalogue: async () => catalogue(),
    read: async () => {
      throw Error('no fresh read');
    },
    transition: async () => {
      writes++;
      throw new ApiClientError('NETWORK', 'lost', { submissionUncertain: true });
    },
    recover: async (original) => {
      reads++;
      assert.deepEqual(original, c);
      return result;
    },
  };
  const a = prepare(api, session(st, scope(), 'author'), c, catalogue());
  await assert.rejects(a.submit());
  assert.equal(a.status, 'uncertain');
  const raw = [...st.data.values()][0];
  const b = await restore(api, session(st, scope(), 'author'));
  assert.equal(b.status, 'uncertain');
  assert.deepEqual(b.original, c);
  assert.equal(writes, 1);
  await b.recoverOriginal();
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.equal([...st.data.values()][0], raw);
  b.discard();
  assert.equal(st.data.size, 0);
});
test('a retained draft original blocks author preparation and is never cleared implicitly; malformed storage also locks', () => {
  const st = store(),
    s = scope(),
    draftScope = {
      instanceId: s.instanceId,
      tenantId: s.tenantId,
      actorId: s.actorId,
      listingId: s.listingId,
    };
  draftClear(st, draftScope);
  referenceDraftSession(st, draftScope).retain(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: id(900),
      listingId: s.listingId,
      revision: 1,
      expectedVersion: '2',
      content: command().review.content,
      selection: {
        catalogueVersion: '1',
        location: { countyId: id(200), localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    catalogue(),
  );
  const raw = [...st.data.values()][0];
  assert.throws(() => draftClear(st, draftScope));
  assert.equal([...st.data.values()][0], raw);
  st.setItem([...st.data.keys()][0], 'malformed');
  assert.throws(() => draftClear(st, draftScope));
  assert.equal(st.data.size, 1);
});

test('draft editing reciprocally refuses an outstanding author transition without deleting it, while another revision stays independently scoped', () => {
  const st = store(),
    s = scope(),
    draftScope = {
      instanceId: s.instanceId,
      tenantId: s.tenantId,
      actorId: s.actorId,
      listingId: s.listingId,
    };
  authorClear(st, draftScope, 1);
  session(st, s, 'author').retain({ ...command(), action: 'withdraw' }, catalogue());
  const raw = [...st.data.values()][0];
  assert.throws(() => authorClear(st, draftScope, 1));
  assert.equal([...st.data.values()][0], raw);
  authorClear(st, draftScope, 2);
});

test('validated author nonwrite refusal survives reload as rejected and can be acknowledged without an original GET or another write', async () => {
  const st = store(),
    c = { ...command(), action: 'withdraw' };
  let writes = 0,
    reads = 0;
  const api = {
    catalogue: async () => catalogue(),
    transition: async () => {
      writes++;
      throw new ApiClientError('HTTP', 'refused', { status: 409 });
    },
    recover: async () => {
      reads++;
      throw Error('No operation exists');
    },
    read: async () => {
      throw Error('unused');
    },
  };
  const a = prepare(api, session(st, scope(), 'author'), c, catalogue());
  await assert.rejects(a.submit());
  assert.equal(a.status, 'rejected');
  assert.equal(JSON.parse([...st.data.values()][0]).outcome, 'refused');
  const b = await restore(api, session(st, scope(), 'author'));
  assert.equal(b.status, 'rejected');
  assert.equal(b.canDiscard, true);
  b.discard();
  assert.equal(st.data.size, 0);
  assert.equal(writes, 1);
  assert.equal(reads, 0);
});
test('failure to retain a known refusal never creates an unverified discardable state', async () => {
  const st = store(),
    write = st.setItem;
  st.setItem = (k, v) => {
    if (JSON.parse(v).outcome === 'refused') throw Error('quota');
    write(k, v);
  };
  const api = {
    catalogue: async () => catalogue(),
    transition: async () => {
      throw new ApiClientError('HTTP', 'refused', { status: 400 });
    },
    recover: async () => {
      throw Error('unknown');
    },
    read: async () => {
      throw Error('unused');
    },
  };
  const a = prepare(
    api,
    session(st, scope(), 'author'),
    { ...command(), action: 'withdraw' },
    catalogue(),
  );
  await assert.rejects(a.submit());
  assert.equal(a.status, 'uncertain');
  assert.equal(a.canDiscard, false);
  assert.equal(JSON.parse([...st.data.values()][0]).outcome, 'outstanding');
});

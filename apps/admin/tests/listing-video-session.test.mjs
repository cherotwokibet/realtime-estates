import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import {
  videoSession,
  videoAttempt,
  assertListingVideoClear,
} from '../dist/tests/lib/listing-video-session.js';
import {
  assertReferenceAuthorDraftClear,
  assertReferenceDraftAuthorClear,
} from '../dist/tests/lib/reference-author-policy.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  scope = { instanceId: id(1), tenantId: id(2), actorId: id(3), listingId: id(4), revision: 1 };
const command = () => ({
  policy: 'synthetic-listing-video-command-v1',
  operationId: id(5),
  listingId: id(4),
  revision: 1,
  expectedVersion: '3',
  video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic' },
});
const record = (c) => ({
  policy: 'synthetic-listing-video-record-v1',
  command: c,
  actorId: scope.actorId,
  resultVersion: '4',
});
const store = () => ({
  data: new Map(),
  getItem(k) {
    return this.data.get(k) ?? null;
  },
  setItem(k, v) {
    this.data.set(k, v);
  },
  removeItem(k) {
    this.data.delete(k);
  },
});
test('review retains and snapshots before sending; reload is uncertain with no automatic request', async () => {
  const st = store();
  let posts = 0,
    gets = 0;
  const client = {
    save: async (c) => {
      posts++;
      throw new ApiClientError('NETWORK', 'Lost', { submissionUncertain: true });
    },
    recover: async (c) => {
      gets++;
      return record(c);
    },
  };
  const input = command(),
    a = videoAttempt(st, scope, client, input);
  input.video.title = 'Changed';
  assert.equal(a.command.video.title, 'Synthetic');
  assert.equal(posts, 0);
  assert.equal(st.data.size, 1);
  await assert.rejects(a.send());
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.clear());
  const raw = [...st.data.values()][0],
    saved = videoSession(st, scope).load(),
    b = videoAttempt(st, scope, client, saved.command, true);
  assert.equal(posts, 1);
  assert.equal(gets, 0);
  await b.recover();
  assert.equal(gets, 1);
  assert.equal(posts, 1);
  assert.equal(b.status, 'resolved');
  b.clear();
  assert.equal(st.data.size, 0);
  assert.ok(raw.includes(a.command.operationId));
});
test('known initial nonwrite refusal survives reload without fictitious recovery or another write', async () => {
  const st = store();
  let gets = 0;
  const client = {
    save: async () => {
      throw new ApiClientError('HTTP', 'Refused', { status: 409, submissionUncertain: false });
    },
    recover: async () => {
      gets++;
      throw Error();
    },
  };
  const a = videoAttempt(st, scope, client, command());
  await assert.rejects(a.send());
  assert.equal(a.status, 'refused');
  const saved = videoSession(st, scope).load(),
    b = videoAttempt(st, scope, client, saved.command, true);
  assert.equal(b.status, 'refused');
  b.clear();
  assert.equal(gets, 0);
});
test('replay refusal cannot turn a previously uncertain original into a discardable request', async () => {
  const st = store(),
    c = command(),
    client = {
      save: async () => {
        throw new ApiClientError('HTTP', 'Conflict', { status: 409 });
      },
      recover: async () => {
        throw Error();
      },
    };
  videoAttempt(st, scope, client, c);
  const a = videoAttempt(st, scope, client, c, true);
  await assert.rejects(a.replay());
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.clear());
  assert.equal(videoSession(st, scope).load().outcome, 'uncertain');
});
test('foreign, malformed and changed retained originals are neither overwritten nor cleared', () => {
  const st = store(),
    client = { save: async (c) => record(c), recover: async (c) => record(c) };
  videoAttempt(st, scope, client, command());
  const old = [...st.data.values()][0];
  for (const changed of [
    { ...scope, actorId: id(9) },
    { ...scope, tenantId: id(9) },
    { ...scope, revision: 2 },
  ])
    assert.throws(() => videoSession(st, changed).load());
  assert.throws(() => videoAttempt(st, scope, client, { ...command(), operationId: id(8) }));
  assert.equal([...st.data.values()][0], old);
  const k = [...st.data.keys()][0];
  st.data.set(k, 'malformed');
  assert.throws(() => videoSession(st, scope).load());
  assert.throws(() => assertListingVideoClear(st, scope.instanceId, scope.listingId));
  assert.equal(st.data.get(k), 'malformed');
});
test('write/readback and outcome storage failures fail closed before or after the sole dispatch', async () => {
  let writes = 0;
  const st = store(),
    client = {
      save: async (c) => {
        writes++;
        return record(c);
      },
      recover: async (c) => record(c),
    };
  st.setItem = () => {};
  assert.throws(() => videoAttempt(st, scope, client, command()));
  assert.equal(writes, 0);
  const s = store(),
    a = videoAttempt(s, scope, client, command()),
    set = s.setItem.bind(s);
  s.setItem = (k, v) => {
    if (v.includes('"resolved"')) throw Error('Full');
    set(k, v);
  };
  await assert.rejects(a.send());
  assert.equal(writes, 1);
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.clear());
  assert.equal(videoSession(s, scope).load().outcome, 'uncertain');
});
test('retained video locks new reference draft and author transition preparation reciprocally', () => {
  const st = store(),
    client = { save: async (c) => record(c), recover: async (c) => record(c) },
    { revision, ...draft } = scope,
    a = videoAttempt(st, scope, client, command());
  assert.throws(() => assertReferenceAuthorDraftClear(st, draft));
  assert.throws(() => assertReferenceDraftAuthorClear(st, draft, revision));
  a.clear();
  assert.doesNotThrow(() => assertReferenceAuthorDraftClear(st, draft));
  st.setItem(
    `synthetic-reference-original-v1:${scope.instanceId}:${scope.tenantId}:${scope.actorId}:${scope.listingId}`,
    'unresolved',
  );
  assert.throws(() => videoAttempt(st, scope, client, command()));
  assert.equal(st.data.size, 1);
});
test('long Unicode titles preserve resolved originals within the bounded storage envelope', async () => {
  const st = store(),
    c = { ...command(), video: { ...command().video, title: '🦒'.repeat(120) } },
    client = { save: async (c) => record(c), recover: async (c) => record(c) },
    a = videoAttempt(st, scope, client, c);
  await a.send();
  const saved = videoSession(st, scope).load();
  assert.equal(saved.receipt.command.video.title, c.video.title);
  assert.equal(saved.outcome, 'resolved');
});

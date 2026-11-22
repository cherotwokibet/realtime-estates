import { decodedJsonResponse } from './helpers/decoded-json-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planListingVerification } from '@realtor/domain';
import {
  createListingVerificationClient,
  ListingVerificationError,
} from '../dist/tests/lib/listing-verification-client.js';
import { prepareListingVerificationAttempt } from '../dist/tests/lib/listing-verification-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () => ({
  operationId: id(300),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' },
  expectedVerificationVersion: '0',
  subject: 'identity',
  outcome: 'supported',
  evidenceReference: 'synthetic:fixture',
  note: 'Synthetic assessment.',
  observedAt: '2026-01-01T00:00:00.000Z',
});
const receipt = () => ({
  kind: 'listing_verification_receipt',
  operationId: id(300),
  listingId: id(100),
  actorId: id(10),
  request: command(),
  completedAt: '2026-10-22T20:00:00.000Z',
  decision: {
    outcome: 'recorded',
    reason: null,
    record: planListingVerification(
      command(),
      { target: command().target, verificationVersion: '0', lastRecordedAt: null },
      'admin',
      id(10),
      '2026-10-22T20:00:00.000Z',
    ).record,
  },
});
const client = (fetch, timeoutMs = 20000) =>
  createListingVerificationClient({ instanceId: id(9), fetch, timeoutMs });
test('verification browser transport fixes one write and original GET, detaching original facts', async () => {
  const original = command(),
    calls = [],
    api = client(async (path, init) => {
      calls.push({ path, init });
      original.note = 'Changed locally';
      return Response.json(receipt());
    });
  assert.deepEqual(await api.create(original), receipt());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/staff/listings/${id(100)}/verification-operations/${id(300)}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  await api.recover(command());
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.body, undefined);
});
test('verification client rejects unsafe config, invalid originals and cursors before transport', async () => {
  let reads = 0,
    calls = 0;
  assert.throws(() =>
    createListingVerificationClient({
      get instanceId() {
        reads++;
        return id(9);
      },
    }),
  );
  assert.equal(reads, 0);
  const api = client(async () => {
    calls++;
    return Response.json(receipt());
  });
  await assert.rejects(
    () => api.create({ ...command(), actorId: id(11) }),
    (e) => e.kind === 'validation' && !e.uncertain,
  );
  for (const before of ['0', '01', '1e0', '9007199254740992'])
    await assert.rejects(
      () => api.history(id(100), 20, before),
      (e) => e.kind === 'validation',
    );
  await assert.rejects(
    () => api.history(id(100), 26),
    (e) => e.kind === 'validation',
  );
  assert.equal(calls, 0);
});
test('verification successful replies reject duplicate keys, aliases, altered facts, bytes and encoding', async () => {
  for (const response of [
    () => Response.json({ ...receipt(), actorId: id(11) }),
    () =>
      new Response(JSON.stringify(receipt()).replace('"revision":1', '"revision":1.0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(JSON.stringify(receipt()).replace('"note":', '"note":"lost","n\\u006fte":'), {
        headers: { 'content-type': 'application/json' },
      }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(JSON.stringify(receipt()), {
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      }),
    () =>
      new Response(JSON.stringify(receipt()), {
        headers: { 'content-type': 'application/json', 'content-encoding': 'unknown' },
      }),
  ]) {
    let calls = 0;
    const api = client(async () => {
      calls++;
      return response();
    });
    await assert.rejects(
      () => api.create(command()),
      (e) => e.kind === 'response' && e.uncertain,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      () => api.recover(command()),
      (e) => !e.uncertain,
    );
    assert.equal(calls, 2);
  }
});
test('verification deadlines include ignored fetch and stalled body with cancellation and no retries', async () => {
  let calls = 0;
  const ignored = client(async () => {
    calls++;
    return new Promise(() => {});
  }, 100);
  await assert.rejects(
    () => ignored.create(command()),
    (e) => e.kind === 'timeout' && e.uncertain,
  );
  assert.equal(calls, 1);
  let cancelled = 0;
  const stream = new ReadableStream(
    {
      cancel() {
        cancelled++;
      },
    },
    { highWaterMark: 0 },
  );
  const api = client(
    async () => new Response(stream, { headers: { 'content-type': 'application/json' } }),
    100,
  );
  await assert.rejects(
    () => api.recover(command()),
    (e) => e.kind === 'timeout' && !e.uncertain,
  );
  assert.equal(cancelled, 1);
  assert.equal(stream.locked, false);
});
test('cursor history echoes the requested window and remains a body-free read', async () => {
  const data = {
    kind: 'listing_verification_history',
    listingId: id(100),
    verificationVersion: '1',
    beforeVersion: '1',
    records: [],
    hasMore: false,
  };
  let calls = 0;
  const api = client(async (path, init) => {
    calls++;
    assert.equal(
      path,
      `/api/staff/listings/${id(100)}/verification-history?limit=2&beforeVersion=1`,
    );
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    return Response.json(data);
  });
  assert.deepEqual(await api.history(id(100), 2, '1'), data);
  data.beforeVersion = null;
  await assert.rejects(
    () => api.history(id(100), 2, '1'),
    (e) => e.kind === 'response' && !e.uncertain,
  );
  assert.equal(calls, 2);
});
test('uncertain attempts freeze originals, prevent concurrent sends/discard and recover using GET only', async () => {
  const calls = [];
  let fail = true,
    finish;
  const api = {
    create: async (original) => {
      calls.push(['POST', original]);
      if (fail) throw new ListingVerificationError('network', 0, true);
      return receipt();
    },
    recover: (original) => {
      calls.push(['GET', original]);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const input = command(),
    attempt = prepareListingVerificationAttempt(api, input);
  input.note = 'Changed form';
  await assert.rejects(() => attempt.submit());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.canDiscard, false);
  assert.equal(attempt.original.note, command().note);
  assert.ok(Object.isFrozen(attempt.original.target));
  const reading = attempt.recoverOriginal();
  await assert.rejects(
    () => attempt.replayOriginal(),
    (e) => e.kind === 'validation',
  );
  assert.equal(attempt.status, 'sending');
  finish(receipt());
  await reading;
  assert.equal(attempt.status, 'received');
  assert.equal(attempt.canDiscard, true);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['POST', 'GET'],
  );
});
test('restored attempts remain uncertain across access loss and replay only identical saved facts explicitly', async () => {
  let writes = 0;
  const api = {
    create: async (original) => {
      writes++;
      assert.deepEqual(original, command());
      return receipt();
    },
    recover: async () => {
      throw new ListingVerificationError('http', 403, false);
    },
  };
  const attempt = prepareListingVerificationAttempt(api, command(), true);
  assert.equal(attempt.status, 'uncertain');
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.canDiscard, false);
  assert.equal(writes, 0);
  await attempt.replayOriginal();
  assert.equal(writes, 1);
  assert.equal(attempt.status, 'received');
});

test('decoded compressed Fetch responses preserve exact original facts and identity length checks', async () => {
  for (const encoding of ['gzip', 'br', 'deflate', 'identity']) {
    assert.deepEqual(
      await client(async () => decodedJsonResponse(receipt(), encoding)).create(command()),
      receipt(),
    );
  }
});

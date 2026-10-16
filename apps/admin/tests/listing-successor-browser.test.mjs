import test from 'node:test';
import assert from 'node:assert/strict';
import { validateListingSuccessorCommand } from '@realtor/api-client';
import {
  createListingSuccessorClient,
  ListingSuccessorError,
} from '../dist/tests/lib/listing-successor-client.js';
import { prepareListingSuccessorAttempt } from '../dist/tests/lib/listing-successor-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  instance = id(1),
  command = () =>
    validateListingSuccessorCommand({
      listingId: id(3),
      operationId: id(4),
      expectedListingVersion: '7',
      predecessor: { revision: 3, version: '5', state: 'approved' },
      content: {
        title: 'Synthetic original',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    }),
  receipt = () => ({
    listingId: id(3),
    operationId: id(4),
    actorId: id(2),
    kind: 'start_revision',
    request: {
      expectedListingVersion: command().expectedListingVersion,
      predecessor: command().predecessor,
      content: command().content,
    },
    decision: {
      outcome: 'applied',
      reason: null,
      result: { listingVersion: '8', revision: 4, revisionVersion: '2' },
    },
    completedAt: '2026-10-15T12:00:00.000Z',
  });
test('successor browser sends fixed POST/GET without credentials and validates exact retained original', async () => {
  const calls = [],
    api = createListingSuccessorClient({
      instanceId: instance,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(receipt());
      },
    });
  assert.deepEqual(await api.create(command()), receipt());
  assert.deepEqual(await api.recover(command()), receipt());
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['POST', 'GET'],
  );
  for (const c of calls) {
    assert.equal(c.url, `/api/staff/listings/${id(3)}/revision-operations/${id(4)}`);
    assert.equal(c.init.credentials, 'omit');
    assert.equal(c.init.redirect, 'error');
    assert.equal(new Headers(c.init.headers).get('authorization'), null);
    assert.equal(new Headers(c.init.headers).get('x-preview-instance'), instance);
  }
  assert.equal(calls[1].init.body, undefined);
});
test('uncertain original survives denied GET then restoration; discard and concurrent dispatch remain blocked', async () => {
  let writes = 0,
    reads = 0;
  const source = JSON.parse(JSON.stringify(command())),
    api = {
      async create() {
        writes++;
        throw new ListingSuccessorError('network', 0, true);
      },
      async recover() {
        reads++;
        if (reads === 1) throw new ListingSuccessorError('http', 404, false);
        return receipt();
      },
    },
    attempt = prepareListingSuccessorAttempt(api, source);
  source.predecessor.version = '99';
  assert.equal(attempt.canDiscard, true);
  await assert.rejects(() => attempt.submit());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.canDiscard, false);
  await assert.rejects(
    () => attempt.submit(),
    (e) => e.kind === 'validation',
  );
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.canDiscard, false);
  assert.equal(attempt.original.predecessor.version, '5');
  assert.deepEqual(await attempt.recoverOriginal(), receipt());
  assert.equal(attempt.status, 'received');
  assert.equal(attempt.canDiscard, true);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});
test('explicit uncertain replay reuses immutable original; changed or malformed result cannot replace it', async () => {
  let writes = 0;
  const attempt = prepareListingSuccessorAttempt(
    {
      async create(c) {
        writes++;
        assert.deepEqual(c, command());
        if (writes === 1) throw new Error('unknown interruption');
        return receipt();
      },
      async recover() {
        return { ...receipt(), request: { ...receipt().request, expectedListingVersion: '6' } };
      },
    },
    command(),
  );
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.receipt, null);
  assert.deepEqual(await attempt.replayOriginal(), receipt());
  assert.equal(writes, 2);
  assert.equal(attempt.original.predecessor.version, '5');
});
test('sending cannot double-submit, recover or discard; known conflict is a completed result', async () => {
  let release;
  const pending = new Promise((r) => (release = r)),
    attempt = prepareListingSuccessorAttempt(
      { create: () => pending, recover: async () => receipt() },
      command(),
    );
  const send = attempt.submit();
  assert.equal(attempt.status, 'sending');
  assert.equal(attempt.canDiscard, false);
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  release({
    ...receipt(),
    decision: { outcome: 'conflict', reason: 'PREDECESSOR_CHANGED', result: null },
  });
  assert.equal((await send).decision.outcome, 'conflict');
  assert.equal(attempt.status, 'received');
  assert.equal(attempt.canDiscard, true);
});
test('bounded browser transport rejects duplicate, oversized and misbound replies with write uncertainty only', async () => {
  for (const response of [
    () => Response.json({ ...receipt(), operationId: id(99) }),
    () =>
      new Response(JSON.stringify(receipt()).replace('"kind":', '"kind":"bad","kind":'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('x'.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const api = createListingSuccessorClient({
      instanceId: instance,
      fetch: async () => response(),
    });
    await assert.rejects(
      () => api.create(command()),
      (e) => e.kind === 'response' && e.uncertain,
    );
    await assert.rejects(
      () => api.recover(command()),
      (e) => e.kind === 'response' && !e.uncertain,
    );
  }
});
test('timeouts terminate hung fetch and preserve uncertainty; pre-aborted requests never dispatch', async () => {
  let calls = 0;
  const api = createListingSuccessorClient({
    instanceId: instance,
    timeoutMs: 10,
    fetch: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    () => api.create(command()),
    (e) => e.kind === 'timeout' && e.uncertain,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => api.create(command(), aborted.signal),
    (e) => e.kind === 'cancelled' && !e.uncertain,
  );
  assert.equal(calls, 1);
});

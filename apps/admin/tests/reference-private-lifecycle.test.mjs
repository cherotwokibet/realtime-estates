import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import * as creation from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import * as successor from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import { createReferenceCreationClient } from '../dist/tests/lib/reference-creation-client.js';
import { createReferenceSuccessorClient } from '../dist/tests/lib/reference-successor-client.js';
import {
  referenceCreationSession,
  prepareReferenceCreationAttempt,
} from '../dist/tests/lib/reference-creation-workspace.js';
import {
  referenceSuccessorSession,
  prepareReferenceSuccessorAttempt,
} from '../dist/tests/lib/reference-successor-workspace.js';
const scope = {
  instanceId: creation.id(9),
  tenantId: creation.id(1),
  actorId: creation.id(10),
  listingId: creation.id(100),
};
function memory() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
for (const [kind, fixture, makeClient, makeSession, prepare] of [
  [
    'creation',
    creation,
    createReferenceCreationClient,
    referenceCreationSession,
    prepareReferenceCreationAttempt,
  ],
  [
    'successor',
    successor,
    createReferenceSuccessorClient,
    referenceSuccessorSession,
    prepareReferenceSuccessorAttempt,
  ],
]) {
  test(
    kind +
      ': raw401/403 closes access even with malformed bodies and preserves the complete uncertain original',
    async () => {
      for (const status of [401, 403]) {
        const store = memory(),
          session = makeSession(store, scope),
          abort = new AbortController();
        let closed = 0;
        const client = makeClient(
          scope,
          async () => new Response('untrusted error text', { status }),
          () => {
            closed++;
            abort.abort();
          },
        );
        const attempt = prepare(client, session, fixture.command(), fixture.catalogue());
        await assert.rejects(attempt.submit(abort.signal));
        assert.equal(closed, 1);
        assert.equal(attempt.status, 'uncertain');
        assert.equal(attempt.canDiscard, false);
        assert.deepEqual(attempt.original, fixture.command());
        assert.notEqual(session.load(), null);
        const saved = [...store.map];
        assert.throws(() => attempt.discard());
        assert.deepEqual([...store.map], saved);
      }
    },
  );
  test(
    kind +
      ': ordinary unavailable replies retain uncertainty without falsely invalidating current access',
    async () => {
      const store = memory(),
        session = makeSession(store, scope);
      let closed = 0;
      const client = makeClient(
        scope,
        async () => Response.json({ submissionUncertain: true }, { status: 503 }),
        () => closed++,
      );
      const attempt = prepare(client, session, fixture.command(), fixture.catalogue());
      await assert.rejects(
        attempt.submit(),
        (e) => e instanceof ApiClientError && e.submissionUncertain,
      );
      assert.equal(closed, 0);
      assert.equal(attempt.status, 'uncertain');
      assert.notEqual(session.load(), null);
    },
  );
  test(
    kind +
      ': abort settles an uncooperative write; late successful receipt cannot confirm or erase its original',
    async () => {
      const store = memory(),
        session = makeSession(store, scope),
        abort = new AbortController();
      let release;
      const client = makeClient(scope, () => new Promise((r) => (release = r)));
      const attempt = prepare(client, session, fixture.command(), fixture.catalogue());
      const pending = attempt.submit(abort.signal);
      assert.ok(release);
      const saved = [...store.map];
      abort.abort();
      await assert.rejects(pending, (e) => e instanceof ApiClientError && e.submissionUncertain);
      release(Response.json(fixture.receipt()));
      await new Promise((r) => setImmediate(r));
      assert.equal(attempt.status, 'uncertain');
      assert.equal(attempt.receipt, null);
      assert.equal(attempt.canDiscard, false);
      assert.deepEqual([...store.map], saved);
    },
  );
}

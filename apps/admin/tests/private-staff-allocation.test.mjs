import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateAllocationClients } from '../dist/tests/lib/private-allocation-client.js';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
import {
  creationAllocationSession,
  successorAllocationSession,
  prepareCreationAllocation,
  prepareSuccessorAllocation,
} from '../dist/tests/lib/allocation-recovery.js';
import {
  validateListingCreationCommand,
  validateListingSuccessorCommand,
} from '@realtor/api-client';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  scope = { instanceId: id(900), tenantId: id(1), actorId: id(13) };
const content = {
  title: 'PRIVATE ORIGINAL',
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: null, town: null, area: null },
};
const memory = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
for (const kind of ['creation', 'successor']) {
  test(
    kind +
      ' whole-operation guard cancels an uncooperative reply, blocks cached dispatch and preserves uncertain storage',
    async () => {
      let release,
        calls = 0;
      const store = memory(),
        clients = createPrivateAllocationClients(
          scope,
          () => {},
          () => {
            calls++;
            return new Promise((r) => (release = r));
          },
        );
      const command =
        kind === 'creation'
          ? validateListingCreationCommand({
              listingId: id(200),
              operationId: id(1000),
              slug: 'synthetic-original',
              content,
            })
          : validateListingSuccessorCommand({
              listingId: id(200),
              operationId: id(1000),
              expectedListingVersion: '1',
              predecessor: { revision: 1, version: '4', state: 'rejected' },
              content,
            });
      const session =
        kind === 'creation'
          ? creationAllocationSession(store, scope)
          : successorAllocationSession(store, scope, id(200));
      const attempt = (
        kind === 'creation' ? prepareCreationAllocation : prepareSuccessorAllocation
      )(clients[kind], session, command);
      const pending = attempt.submit();
      await new Promise((r) => setImmediate(r));
      assert.ok(release);
      const saved = [...store.map];
      clients.dispose();
      await assert.rejects(pending);
      release(Response.json({ untrusted: 'late' }));
      await new Promise((r) => setImmediate(r));
      assert.equal(attempt.status, 'uncertain');
      assert.equal(attempt.receipt, null);
      assert.deepEqual([...store.map], saved);
      await assert.rejects(clients[kind].recover(command));
      assert.equal(calls, 1);
    },
  );
  test(kind + ' raw malformed401/403 denies private access before JSON validation', async () => {
    for (const status of [401, 403]) {
      let closed = 0;
      const clients = createPrivateAllocationClients(
        scope,
        () => closed++,
        async () => new Response('invalid body', { status }),
      );
      const command =
        kind === 'creation'
          ? validateListingCreationCommand({
              listingId: id(200),
              operationId: id(1000),
              slug: 'synthetic-original',
              content,
            })
          : validateListingSuccessorCommand({
              listingId: id(200),
              operationId: id(1000),
              expectedListingVersion: '1',
              predecessor: { revision: 1, version: '4', state: 'rejected' },
              content,
            });
      await assert.rejects(clients[kind].create(command));
      assert.equal(closed, 1);
      clients.dispose();
    }
  });
}
test('directory lifetime abort settles held reads, blocks cached calls and cancels streaming bodies', async () => {
  const lifetime = new AbortController();
  let release,
    calls = 0;
  const client = createStaffDirectoryClient(
    { instanceId: scope.instanceId },
    () => {
      calls++;
      return new Promise((r) => (release = r));
    },
    { signal: lifetime.signal },
  );
  const pending = client.listBranches({ limit: 10, after: null });
  lifetime.abort();
  await assert.rejects(pending, (e) => e.kind === 'CANCELLED');
  release(Response.json({ page: { policy: 'staff-branch-page-v1', items: [], nextAfter: null } }));
  await assert.rejects(client.listBranches({ limit: 10, after: null }));
  assert.equal(calls, 1);
  const second = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"page":'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = createStaffDirectoryClient(
    { instanceId: scope.instanceId },
    async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    { signal: second.signal },
  );
  const read = streamed.listBranches({ limit: 10, after: null });
  await new Promise((r) => setImmediate(r));
  second.abort();
  await assert.rejects(read);
  assert.equal(cancelled, true);
});
test('directory raw denial closes and cancels an uncertain staff write without erasing the operation', async () => {
  for (const status of [401, 403]) {
    const lifetime = new AbortController(),
      store = memory();
    let controller,
      closed = 0;
    const client = createStaffDirectoryClient(
      { instanceId: scope.instanceId },
      async () => new Response('invalid body', { status }),
      {
        signal: lifetime.signal,
        onAccessDenied: () => {
          closed++;
          controller.close();
          lifetime.abort();
        },
      },
    );
    controller = createStaffWriteController({ scope, store, client });
    controller.prepare('branch', {
      policy: 'staff-branch-command-v1',
      operationId: id(1000),
      branchId: id(201),
      expectedVersion: '0',
      name: 'PRIVATE BRANCH',
      active: true,
      reason: 'Synthetic original',
    });
    await assert.rejects(controller.submit());
    assert.equal(closed, 1);
    assert.equal(controller.snapshot().attempt.phase, 'uncertain');
    assert.ok([...store.map.values()].some((x) => x.includes('PRIVATE BRANCH')));
  }
});

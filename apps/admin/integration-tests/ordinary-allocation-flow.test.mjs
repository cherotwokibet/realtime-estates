import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { readStaffAllocationScope } from '../dist/tests/lib/staff-allocation-scope.js';
import { retainedAllocationRequest } from '../dist/tests/lib/retained-allocation-server.js';
import { createListingCreationClient } from '../dist/tests/lib/listing-creation-client.js';
import { createListingSuccessorClient } from '../dist/tests/lib/listing-successor-client.js';
import {
  openCreationAllocation,
  openSuccessorAllocation,
} from '../dist/tests/lib/allocation-recovery.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const memory = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
async function fixture(options, work) {
  const prior = { ...process.env },
    oldFetch = globalThis.fetch,
    p = await startStaffPreview({ port: 0, ...options });
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: p.origin,
    STAFF_PREVIEW_TOKEN: p.bearerToken,
    STAFF_PREVIEW_INSTANCE: id(9),
  });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/v2/'))
      calls.push({ path: new URL(url).pathname, method: init?.method ?? 'GET' });
    return oldFetch(url, init);
  };
  const browser = (kind) => async (path, init) => {
    const operation = path.split('/').at(-1),
      listing = path.split('/')[4];
    return retainedAllocationRequest(
      new Request('http://127.0.0.1:3001' + path, {
        ...init,
        headers: {
          ...init.headers,
          host: '127.0.0.1:3001',
          ...(init.method === 'POST' ? { origin: 'http://127.0.0.1:3001' } : {}),
        },
      }),
      { id: listing, operationId: operation },
      kind,
    );
  };
  try {
    await work({
      p,
      calls,
      browser,
      sdk: new RealtorApiClient({
        baseUrl: p.origin,
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'synthetic',
      }),
      options: { bearerToken: p.bearerToken },
    });
  } finally {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
    Object.assign(process.env, prior);
    await p.close();
  }
}
const content = () =>
  normalizeStaffDraftContentV2({
    title: 'Synthetic retained original',
    propertyType: 'apartment',
    purpose: 'rent',
    currency: 'KES',
    amountMinor: 2000001,
    rentPeriod: 'month',
    privateAddress: 'PRIVATE-SYNTHETIC-ORDINARY',
    pricing: {
      declaration: 'complete',
      charges: [
        {
          id: 'deposit',
          name: 'Synthetic refundable deposit',
          amountStatus: 'known',
          amountMinor: 12345,
          timing: 'one_off',
          classification: 'refundable_deposit',
          mandatory: true,
        },
      ],
    },
    location: { county: null, town: null, area: null },
  });
test('ordinary retained creation crosses BFF/signed HTTP/JWKS/SDK/restricted SQL, restores without I/O and recovers exact original after committed corrupt reply', () =>
  fixture(
    { creationReplyFault: 'invalid-first-created-v1' },
    async ({ calls, browser, sdk, options }) => {
      const scope = await readStaffAllocationScope(),
        store = memory(),
        client = createListingCreationClient({
          instanceId: scope.instanceId,
          scope,
          fetch: browser('creation'),
        }),
        entry = openCreationAllocation(client, store, scope),
        original = entry.prepare(
          { slug: 'synthetic-retained-ordinary', content: content() },
          () => id(9900),
          () => id(9901),
        );
      await assert.rejects(original.submit());
      assert.equal(original.status, 'uncertain');
      original.verifyReload();
      const count = calls.length,
        reloaded = openCreationAllocation(client, store, scope);
      assert.equal(calls.length, count);
      assert.deepEqual(reloaded.restored.original, original.original);
      assert.equal(reloaded.restored.status, 'uncertain');
      let ids = 0;
      assert.throws(() =>
        reloaded.prepare(
          { slug: 'separate', content: content() },
          () => {
            ids++;
            return id(9902);
          },
          () => {
            ids++;
            return id(9903);
          },
        ),
      );
      assert.equal(ids, 0);
      await reloaded.restored.recoverOriginal();
      assert.equal(reloaded.restored.receipt.outcome, 'created');
      const target = reloaded.restored.freshDraftTarget;
      assert.deepEqual(target, { listingId: id(9900), revision: 1 });
      const current = await sdk.getStaffDraftWorkspaceV2(
        target.listingId,
        target.revision,
        options,
      );
      assert.equal(current.draft.content.amountMinor, 2000001);
      assert.equal(current.draft.content.privateAddress, content().privateAddress);
      assert.equal(current.photos.length, 0);
      await sdk.saveStaffDraftV2(
        target.listingId,
        target.revision,
        {
          expectedVersion: current.draft.version,
          content: { ...current.draft.content, title: 'Synthetic later authoritative edit' },
        },
        options,
      );
      assert.equal(
        (
          await sdk.getListingCreationSnapshotV2(
            original.original.listingId,
            original.original.operationId,
            options,
          )
        ).request.content.title,
        content().title,
      );
      assert.equal(
        (await sdk.listStaffListingsV2(options)).items.filter((x) => x.listingId === id(9900))
          .length,
        1,
      );
      reloaded.restored.discard();
      assert.equal(store.map.size, 0);
      assert.equal(reloaded.restored.freshDraftTarget, null);
      assert.equal(
        calls.filter((c) => c.method === 'POST' && c.path.includes('/creation-operations/')).length,
        1,
      );
    },
  ));
test('ordinary retained successor restores from current-draft shell, explicit GET/exact replay preserve one draft and approved public pointer', () =>
  fixture(
    { successorTerminalFixture: 'approved', successorReplyFault: 'invalid-first-applied-v1' },
    async ({ p, calls, browser, sdk, options }) => {
      const scope = await readStaffAllocationScope(),
        before = await sdk.getStaffListingV2(p.listingId, options),
        store = memory(),
        client = createListingSuccessorClient({
          instanceId: scope.instanceId,
          scope,
          fetch: browser('revision'),
        }),
        entry = openSuccessorAllocation(client, store, scope, p.listingId, before),
        original = entry.prepare(content(), () => id(9905));
      await assert.rejects(original.submit());
      assert.equal(original.status, 'uncertain');
      original.verifyReload();
      const current = await sdk.getStaffListingV2(p.listingId, options);
      assert.equal(current.latest.state, 'draft');
      assert.equal(current.latest.revision, 2);
      assert.equal(current.publishedRevision, before.publishedRevision);
      assert.equal(current.publicationStatus, before.publicationStatus);
      const count = calls.length,
        reloaded = openSuccessorAllocation(client, store, scope, p.listingId, current);
      assert.equal(calls.length, count);
      assert.equal(reloaded.restored.status, 'uncertain');
      assert.equal(reloaded.eligible, false);
      await reloaded.restored.recoverOriginal();
      const recovered = reloaded.restored.receipt;
      // Reload retains the original until an explicit clear, so deliberate identical replay is still available.
      const replay = openSuccessorAllocation(client, store, scope, p.listingId, current);
      await replay.restored.replayOriginal();
      assert.deepEqual(replay.restored.receipt, recovered);
      const target = replay.restored.freshDraftTarget,
        workspace = await sdk.getStaffDraftWorkspaceV2(target.listingId, target.revision, options);
      assert.equal(workspace.photos.length, 0);
      assert.equal(workspace.draft.content.amountMinor, 2000001);
      const later = await sdk.saveStaffDraftV2(
        target.listingId,
        target.revision,
        {
          expectedVersion: workspace.draft.version,
          content: { ...workspace.draft.content, title: 'Synthetic fresh successor edit' },
        },
        options,
      );
      assert.notEqual(later.version, workspace.draft.version);
      assert.deepEqual(
        await sdk.getListingSuccessorReceiptV2(original.original, options),
        recovered,
      );
      assert.equal((await sdk.getStaffListingV2(p.listingId, options)).latest.revision, 2);
      replay.restored.discard();
      assert.equal(store.map.size, 0);
      assert.equal(
        openSuccessorAllocation(
          client,
          store,
          scope,
          p.listingId,
          await sdk.getStaffListingV2(p.listingId, options),
        ).eligible,
        false,
      );
      assert.equal(
        calls.filter((c) => c.method === 'POST' && c.path.includes('/revision-operations/')).length,
        2,
      );
    },
  ));

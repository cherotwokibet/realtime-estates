import test from 'node:test';
import assert from 'node:assert/strict';
import { readReferenceDraftScreen } from '../dist/tests/lib/reference-draft-screen.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: id(9),
  },
  session = { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(10) },
  catalogue = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [],
    amenities: [],
  };
const workspace = {
  listingId: id(100),
  draft: {
    revision: 1,
    state: 'draft',
    version: '2',
    content: normalizeStaffDraftContentV2({
      title: 'Synthetic screen draft',
      location: { county: null, town: null, area: null },
      pricing: { declaration: 'not_declared', charges: [] },
    }),
  },
  photos: [],
};
test('reference screen reads exact current-authorized workspace and catalogue without serializing credentials', async () => {
  const calls = [],
    transport = async (url, init) => {
      calls.push({ url, init });
      return Response.json(
        url.endsWith('/reference-session')
          ? session
          : url.endsWith('/workspace')
            ? workspace
            : catalogue,
      );
    };
  const screen = await readReferenceDraftScreen(id(100), '1', env, transport);
  assert.equal(screen.expectedVersion, '2');
  assert.deepEqual(screen.content, workspace.draft.content);
  assert.deepEqual(screen.scope, {
    instanceId: id(9),
    tenantId: id(1),
    actorId: id(10),
    listingId: id(100),
  });
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['GET', 'GET', 'GET'],
  );
  assert.ok(calls[1].url.endsWith(`/listings/${id(100)}/revisions/1/workspace`));
  assert.ok(!JSON.stringify(screen).includes('a.b.c'));
});
test('reference screen refuses default-off, aliased revision and noneditable or denied workspace without exposing stale props', async () => {
  let calls = 0;
  const fetch = async (url) => {
    calls++;
    return Response.json(
      url.endsWith('/reference-session')
        ? session
        : { ...workspace, draft: { ...workspace.draft, state: 'approved' } },
    );
  };
  for (const rev of ['01', '1.0', '1e0', '2147483648'])
    await assert.rejects(readReferenceDraftScreen(id(100), rev, env, fetch));
  await assert.rejects(
    readReferenceDraftScreen(id(100), '1', { ...env, STAFF_PREVIEW_REFERENCE: 'off' }, fetch),
  );
  assert.equal(calls, 0);
  await assert.rejects(readReferenceDraftScreen(id(100), '1', env, fetch));
  assert.equal(calls, 2);
});

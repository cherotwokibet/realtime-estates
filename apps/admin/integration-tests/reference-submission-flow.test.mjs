import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { readReferenceSubmissionScreen as screen } from '../dist/tests/lib/reference-submission-screen.js';
import { referenceModerationRequest } from '../dist/tests/lib/reference-moderation-server.js';
import { referenceDraftRequest } from '../dist/tests/lib/reference-draft-server.js';
import { createReferenceModerationClient } from '../dist/tests/lib/reference-moderation-client.js';
import {
  referenceModerationSession as session,
  prepareReferenceModerationAttempt as prepare,
  restoreReferenceModerationAttempt as restore,
} from '../dist/tests/lib/reference-moderation-workspace.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
test('author loader and retained browser adapter connect signed withdrawal/recovery/resubmission; incomplete photos refuse without mutation', async (t) => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'agent',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    referenceModerationMode: 'synthetic-reference-transition-v1',
    referenceModerationReplyFault: 'invalid-first-transition-v1',
  });
  t.after(() => p.close());
  const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
    STAFF_PREVIEW_API_ORIGIN: p.origin,
    STAFF_PREVIEW_TOKEN: p.bearerToken,
    STAFF_PREVIEW_INSTANCE: id(990),
  };
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [k, v] of Object.entries(before))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const upstream = [],
    native = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    upstream.push({ path: new URL(input).pathname, method: init?.method ?? 'GET' });
    return native(input, init);
  };
  t.after(() => {
    globalThis.fetch = native;
  });
  const browserCalls = [],
    transport = async (path, init) => {
      browserCalls.push({ path, method: init.method });
      const request = new Request('http://127.0.0.1:3131' + path, {
        ...init,
        headers: {
          ...init.headers,
          host: '127.0.0.1:3131',
          ...(init.method === 'POST' ? { origin: 'http://127.0.0.1:3131' } : {}),
        },
      });
      return path.includes('reference-transition-operations')
        ? referenceModerationRequest(request)
        : referenceDraftRequest(request);
    };
  const storage = () => {
    const data = new Map();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
  };
  const initial = await screen(p.listingId, '1', env);
  assert.equal(initial.context.review.state, 'pending');
  assert.equal(initial.scope.actorId, id(11));
  const st = storage(),
    client = createReferenceModerationClient(initial.scope, transport),
    c = {
      policy: 'synthetic-reference-transition-v1',
      operationId: id(35900),
      listingId: p.listingId,
      revision: 1,
      action: 'withdraw',
      review: initial.context.review,
      reason: null,
    };
  const a = prepare(client, session(st, initial.scope, 'author'), c, initial.context.catalogue);
  await assert.rejects(a.submit(), (e) => e instanceof ApiClientError && e.submissionUncertain);
  assert.equal(a.status, 'uncertain');
  const raw = [...st.data.values()][0];
  const changed = await screen(p.listingId, '1', env);
  assert.equal(changed.context.review.state, 'draft');
  const posts = upstream.filter((x) => x.method === 'POST').length;
  const b = await restore(client, session(st, initial.scope, 'author'));
  assert.deepEqual(b.original, c);
  assert.equal([...st.data.values()][0], raw);
  await b.recoverOriginal();
  assert.equal(b.receipt.state, 'draft');
  assert.equal(upstream.filter((x) => x.method === 'POST').length, posts);
  assert.equal(
    browserCalls.filter((x) => x.method === 'POST' && !x.path.endsWith('/recover')).length,
    1,
  );
  b.discard();
  const fresh = await screen(p.listingId, '1', env);
  const submit = { ...c, operationId: id(35901), action: 'submit', review: fresh.context.review };
  const next = prepare(client, session(st, fresh.scope, 'author'), submit, fresh.context.catalogue);
  const result = await next.submit();
  assert.equal(result.state, 'pending');
  assert.equal((await screen(p.listingId, '1', env)).context.review.state, 'pending');
  next.discard();
  assert.equal(st.data.size, 0);
  const api = new RealtorApiClient({
      baseUrl: p.origin,
      privacyNoticeVersion: 'synthetic',
      allowLoopbackHttp: true,
    }),
    opts = { bearerToken: p.bearerToken };
  const content = normalizeStaffDraftContentV2({
    ...initial.context.review.content,
    locality: null,
    location: { county: null, town: null, area: null },
  });
  await api.createListingV2(
    { operationId: id(35902), listingId: id(489), slug: 'synthetic-author-no-photos', content },
    opts,
  );
  const cat = await api.getSyntheticReferenceCatalogueV3('current', opts);
  const county = cat.locations.find((x) => x.kind === 'county');
  await api.saveSyntheticReferenceDraftV3(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: id(35903),
      listingId: id(489),
      revision: 1,
      expectedVersion: '2',
      content: normalizeStaffDraftContentV2({
        ...content,
        locality: county.label,
        location: { county: county.label, town: null, area: null },
      }),
      selection: {
        catalogueVersion: cat.version,
        location: { countyId: county.id, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    cat,
    id(11),
    opts,
  );
  const incomplete = await screen(id(489), '1', env),
    badClient = createReferenceModerationClient(incomplete.scope, transport),
    bad = prepare(
      badClient,
      session(st, incomplete.scope, 'author'),
      {
        ...c,
        operationId: id(35904),
        listingId: id(489),
        action: 'submit',
        review: incomplete.context.review,
      },
      incomplete.context.catalogue,
    );
  assert.equal(incomplete.context.review.photos.length, 0);
  await assert.rejects(bad.submit(), (e) => e instanceof ApiClientError && !e.submissionUncertain);
  assert.equal(bad.status, 'rejected');
  const after = await screen(id(489), '1', env);
  assert.deepEqual(after.context, incomplete.context);
  bad.discard();
  assert.equal(st.data.size, 0);
});

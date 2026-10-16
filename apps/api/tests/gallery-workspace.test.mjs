import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiService } from '../dist/service.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(11),
  listing = id(100),
  base = `/v2/staff/listings/${listing}/revisions/2/workspace`;
const content = {
  title: null,
  description: null,
  purpose: null,
  propertyType: null,
  currency: 'KES',
  amountMinor: null,
  rentPeriod: null,
  bedrooms: null,
  privateBathrooms: null,
  sharedBathrooms: null,
  country: 'KE',
  locality: null,
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: null, town: null, area: null },
};
const photo = (n, position = n) => ({
  id: id(300 + n),
  position,
  altText: `Synthetic photo ${n}`,
  accepted: true,
  provenance: 'sealed',
});
const row = {
  listingId: listing,
  revision: 2,
  state: 'draft',
  version: '7',
  ...content,
  photos: [],
};
function fixture({ rows = [row], role = 'agent', code } = {}) {
  const calls = [];
  const service = createApiService({
    tenantId: tenant,
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async (request) => {
      if (request.headers.get('authorization') !== 'Bearer synthetic-agent')
        throw new Error('PRIVATE');
      return { actorId: actor };
    },
    database: {
      transaction: async (context, run) =>
        run({
          query: async (sql, values) => {
            calls.push({ context, sql, values });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (code) throw Object.assign(new Error('PRIVATE SQL'), { code });
            return { rows };
          },
        }),
    },
  });
  const call = (path = base, { method = 'GET', token = 'synthetic-agent' } = {}) =>
    service(
      new Request('https://synthetic.invalid' + path, {
        method,
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      }),
    );
  return { call, calls };
}
test('workspace binds current draft and all photos in one parameterized read statement', async () => {
  const photos = [
    photo(0, 0),
    { ...photo(1, 3), accepted: false, provenance: 'legacy', altText: '  old synthetic label  ' },
    photo(2, 11),
  ];
  const f = fixture({ rows: [{ ...row, photos }] }),
    response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    listingId: listing,
    draft: { revision: 2, state: 'draft', version: '7', content },
    photos,
  });
  assert.equal(f.calls.length, 2);
  const query = f.calls[1];
  assert.deepEqual(query.values, [tenant, listing, 2]);
  assert.equal(query.context.tenantId, tenant);
  assert.equal(query.context.actorId, actor);
  assert.match(query.sql, /jsonb_agg[\s\S]*ORDER BY m\.position/);
  assert.match(
    query.sql,
    /m\.tenant_id=r\.tenant_id AND m\.listing_id=r\.listing_id AND m\.revision_no=r\.revision_no/,
  );
  assert.match(query.sql, /m\.sealed_job_id IS NOT NULL/);
  assert.doesNotMatch(
    query.sql,
    /AND m\.accepted|INSERT|UPDATE|DELETE|public_object_key|sha256|requester/i,
  );
});
test('workspace represents empty and full bounded galleries and safe bigint versions', async () => {
  for (const photos of [[], Array.from({ length: 12 }, (_, n) => photo(n))]) {
    const f = fixture({ rows: [{ ...row, version: '9223372036854775807', photos }] }),
      response = await f.call();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).photos, photos);
  }
});
test('workspace projects no private storage, actor or future adapter fields', async () => {
  const f = fixture({
    rows: [
      {
        ...row,
        storageKey: 'PRIVATE',
        requesterId: actor,
        photos: [{ ...photo(0), publicObjectKey: 'PRIVATE', jobId: id(99), sha256: 'PRIVATE' }],
      },
    ],
  });
  const data = await (await f.call()).json();
  assert.deepEqual(Object.keys(data), ['listingId', 'draft', 'photos']);
  assert.deepEqual(Object.keys(data.draft.content), Object.keys(content));
  assert.deepEqual(data.photos, [photo(0)]);
  assert.equal(JSON.stringify(data).includes('storageKey'), false);
  assert.equal(JSON.stringify(data).includes('jobId'), false);
});
test('workspace rejects malformed persisted gallery metadata and revision identity', async () => {
  for (const patch of [
    { listingId: id(101) },
    { revision: 1 },
    { version: 7 },
    { version: '07' },
    { version: '0' },
    { version: '9223372036854775808' },
    { state: 'published' },
    { photos: null },
    { photos: Array.from({ length: 13 }, (_, n) => photo(n)) },
    { photos: [photo(0), photo(0, 1)] },
    { photos: [photo(0, 2), photo(1, 1)] },
    { photos: [photo(0, -1)] },
    { photos: [photo(0, 12)] },
    { photos: [photo(0, 0.5)] },
    { photos: [{ ...photo(0), accepted: 0 }] },
    { photos: [{ ...photo(0), accepted: false }] },
    { photos: [{ ...photo(0), provenance: 'unknown' }] },
    { photos: [{ ...photo(0), id: 'bad' }] },
    { photos: [{ ...photo(0), altText: '' }] },
    { photos: [{ ...photo(0), provenance: 'legacy', altText: ' '.repeat(4097) + 'X' }] },
  ]) {
    const response = await fixture({ rows: [{ ...row, ...patch }] }).call();
    assert.equal(response.status, 503, JSON.stringify(patch));
    assert.equal((await response.text()).includes('PRIVATE'), false);
  }
});
test('workspace requires verified identity and active staff membership before the read', async () => {
  for (const token of [null, 'forged']) {
    const f = fixture();
    assert.equal((await f.call(base, { token })).status, 401);
    assert.equal(f.calls.length, 0);
  }
  for (const role of [null, 'customer']) {
    const f = fixture({ role });
    assert.equal((await f.call()).status, 403);
    assert.equal(f.calls.length, 1);
  }
  assert.equal((await fixture({ role: 'admin' }).call()).status, 200);
  assert.equal((await fixture({ rows: [] }).call()).status, 404);
});
test('workspace accepts only exact GET paths without query context overrides', async () => {
  const f = fixture();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    const response = await f.call(base, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
  }
  for (const path of [
    base + '?tenantId=forged',
    base + '?limit=1',
    base.replace(listing, 'bad'),
    base.replace('/2/', '/2147483648/'),
  ])
    assert.equal((await f.call(path)).status, 400);
  for (const path of [
    base + '/',
    base + '/extra',
    base.replace('/2/', '/0/'),
    base.replace('/2/', '/02/'),
    base.replace('/2/', '/2e0/'),
  ])
    assert.equal((await f.call(path)).status, 404);
  assert.equal(f.calls.length, 0);
});
test('workspace SQL failure details remain bounded safe errors', async () => {
  for (const [code, status] of [
    ['42501', 403],
    ['P0002', 404],
    ['unexpected', 503],
  ]) {
    const response = await fixture({ code }).call();
    assert.equal(response.status, status);
    assert.equal((await response.text()).includes('PRIVATE'), false);
  }
});

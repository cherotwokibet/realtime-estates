import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  T = id(1),
  A = id(2),
  L = id(3);
const gallery = () => ({
  kind: 'review_media_gallery',
  listingId: L,
  revision: 12,
  version: '7',
  state: 'pending',
  photos: Array.from({ length: 4 }, (_, position) => ({
    id: id(100 + position),
    alt: 'Synthetic image',
    position,
  })),
});
function fixture({ receipt = gallery(), role = 'admin', error } = {}) {
  const calls = [],
    contexts = [];
  let commits = 0;
  const service = createApiService({
    tenantId: T,
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error('PRIVATE');
      return { actorId: A };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        const result = await work({
          async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (error) throw error;
            return { rows: [{ receipt }] };
          },
        });
        commits++;
        return result;
      },
    },
  });
  return {
    service,
    calls,
    contexts,
    get commits() {
      return commits;
    },
  };
}
const req = ({ method = 'GET', headers = {}, suffix = '', body } = {}) =>
  new Request(
    `https://synthetic.invalid/v2/staff/reviews/${L}/revisions/12/media-gallery${suffix}`,
    {
      method,
      headers: { authorization: 'Bearer synthetic', 'X-Revision-Version': '7', ...headers },
      ...(body ? { body } : {}),
    },
  );
test('gallery GET binds verified actor trusted tenant and exact typed read-only SQL', async () => {
  const f = fixture(),
    r = await f.service(req());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), gallery());
  assert.deepEqual(f.calls.at(-1), {
    sql: 'SELECT app_api.read_review_media_gallery($1::uuid,$2::integer,$3::bigint) AS receipt',
    args: [L, 12, '7'],
  });
  assert.equal(f.contexts[0].tenantId, T);
  assert.equal(f.contexts[0].actorId, A);
  assert.equal(f.commits, 1);
  assert.match(r.headers.get('cache-control'), /no-store/);
});
test('gallery rejects caller context framing query and malformed currency before storage', async () => {
  for (const input of [
    { suffix: '?x=1' },
    { method: 'POST', body: '{}' },
    { headers: { 'X-Revision-Version': '07' } },
    { headers: { 'X-Revision-Version': '7, 7' } },
    { headers: { 'X-Revision-Version': '9007199254740992' } },
    ...[
      'x-tenant-id',
      'x-actor-id',
      'cookie',
      'range',
      'if-none-match',
      'content-length',
      'content-type',
    ].map((key) => ({ headers: { [key]: '1' } })),
  ]) {
    const f = fixture();
    assert.ok([400, 405].includes((await f.service(req(input))).status));
    assert.equal(f.calls.length, 0);
  }
});
test('malformed nested gallery projections never commit or disclose stored extras', async () => {
  const samples = [
    { ...gallery(), version: '8' },
    { ...gallery(), state: 'approved' },
    { ...gallery(), secret: 'PRIVATE' },
    { ...gallery(), photos: gallery().photos.slice(0, 3) },
    { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, id: id(100) })) },
    { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, position: 0 })) },
    { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, alt: 'x'.repeat(301) })) },
    { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, key: 'PRIVATE' })) },
  ];
  for (const receipt of samples) {
    const f = fixture({ receipt }),
      r = await f.service(req());
    assert.equal(r.status, 503);
    assert.equal(f.commits, 0);
    assert.equal((await r.text()).includes('PRIVATE'), false);
  }
});
test('current admin requirement and SQL denial mapping fail closed', async () => {
  for (const role of ['agent', 'customer']) {
    const f = fixture({ role });
    assert.equal((await f.service(req())).status, 403);
    assert.equal(f.calls.length, 1);
  }
  for (const [code, status] of [
    ['P0002', 404],
    ['40001', 409],
    ['42501', 403],
  ]) {
    const f = fixture({ error: Object.assign(Error('PRIVATE'), { code }) }),
      r = await f.service(req());
    assert.equal(r.status, status);
    assert.equal((await r.text()).includes('PRIVATE'), false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const path = `/v3/staff/listings/${id(100)}/revision-protocol/1`;
const row = () => ({
  listingId: id(100),
  revision: 1,
  listingVersion: '1',
  revisionVersion: '2',
  state: 'draft',
  editable: true,
  protocol: 'ordinary-v2',
});
const req = (suffix = '', method = 'GET', headers = {}) =>
  new Request('https://synthetic.invalid' + path + suffix, {
    method,
    headers: { authorization: 'Bearer synthetic', ...headers },
  });
test('protocol route is default-off and rejects methods/framing/authority/invalid targets before SQL dispatch', async () => {
  let transactions = 0;
  const base = {
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    verifyAuthorization: async () => ({ actorId: id(11) }),
    database: {
      transaction: async () => {
        transactions++;
        throw Error('Must not dispatch');
      },
    },
  };
  assert.equal((await createApiService(base)(req())).status, 404);
  const service = createApiService({ ...base, referenceDraftMode: 'synthetic-reference-draft-v1' });
  for (const [request, status] of [
    [req('', 'POST'), 405],
    [req('?x=1'), 400],
    [req('', 'GET', { 'x-tenant-id': id(2) }), 400],
    [req('', 'GET', { cookie: 'synthetic' }), 400],
    [req('', 'GET', { 'content-length': '0' }), 400],
    [
      new Request('https://synthetic.invalid' + path.replace('/1', '/2147483648'), {
        headers: { authorization: 'Bearer synthetic' },
      }),
      400,
    ],
  ])
    assert.equal((await service(request)).status, status);
  assert.equal(transactions, 0);
});
test('protocol route binds configured company and verified actor; corrupt SQL projections fail closed', async () => {
  const contexts = [],
    calls = [];
  let corrupt = false,
    role = 'agent';
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    verifyAuthorization: async () => ({ actorId: id(11) }),
    database: {
      transaction: async (context, work) => {
        contexts.push(context);
        return work({
          query: async (sql, args) => {
            calls.push({ sql, args });
            return sql.includes('staff_role')
              ? { rows: [{ role }] }
              : { rows: [{ protocol: { ...row(), ...(corrupt ? { listingId: id(999) } : {}) } }] };
          },
        });
      },
    },
  });
  const result = await service(req());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), row());
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(contexts[0].tenantId, id(1));
  assert.equal(contexts[0].actorId, id(11));
  assert.deepEqual(calls[1].args, [id(100), 1]);
  assert.match(calls[1].sql, /read_synthetic_revision_protocol/);
  corrupt = true;
  assert.equal((await service(req())).status, 503);
  calls.length = 0;
  role = 'customer';
  assert.equal((await service(req())).status, 403);
  assert.equal(calls.length, 1);
});

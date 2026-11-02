import test from 'node:test';
import assert from 'node:assert/strict';
import { staffDirectoryBoundary as boundary } from '../dist/tests/lib/staff-directory-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const req = (kind = 'branches', q = '?limit=2', extra = {}) =>
  new Request('http://localhost:3120/api/staff-directory/' + kind + q, {
    ...extra,
    headers: { host: '127.0.0.1:3120', 'x-preview-instance': id(1), ...extra.headers },
  });
test('directory BFF reads both typed pages with only server-held identity and fixed company API', async () => {
  for (const kind of ['branches', 'invitations']) {
    let calls = 0;
    const response = await boundary(req(kind), kind, env, async (url, init) => {
      calls++;
      assert.equal(
        url,
        'http://127.0.0.1:4101/v2/staff/' +
          (kind === 'branches' ? 'branches' : 'invitation-requests') +
          '?limit=2',
      );
      const h = new Headers(init.headers);
      assert.equal(h.get('authorization'), 'Bearer synthetic.bearer.signature');
      assert.equal(h.has('x-preview-instance'), false);
      assert.equal(init.method, 'GET');
      return Response.json({
        policy: kind === 'branches' ? 'staff-branch-page-v1' : 'staff-invitation-page-v1',
        items: [],
        nextAfter: null,
      });
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(await response.json()), ['page']);
    assert.equal(calls, 1);
  }
});
test('directory BFF refuses production/default/stale instance/foreign Host/caller authority before IO', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error();
  };
  for (const [request, config] of [
    [req(), { ...env, NODE_ENV: 'production' }],
    [req(), { ...env, STAFF_DIRECTORY_PREVIEW_MODE: undefined }],
    [req('branches', '?limit=2', { headers: { 'x-preview-instance': id(2) } }), env],
    [req('branches', '?limit=2', { headers: { host: 'foreign.invalid' } }), env],
    ...[
      { cookie: 'synthetic' },
      { authorization: 'Bearer caller' },
      { 'x-actor-id': id(2) },
      { 'x-tenant-id': id(2) },
      { 'x-forwarded-host': 'foreign.invalid' },
      { origin: 'https://foreign.invalid' },
    ].map((headers) => [req('branches', '?limit=2', { headers }), env]),
  ])
    assert.equal((await boundary(request, 'branches', config, fetcher)).status, 403);
  assert.equal(calls, 0);
});
test('directory BFF rejects unbounded/duplicate/encoded/context queries and bodies before IO', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error();
  };
  for (const q of [
    '',
    '?limit=0',
    '?limit=21',
    '?limit=02',
    '?limit=2&limit=2',
    '?limit=2&after=bad',
    '?limit=2&tenantId=' + id(2),
    '?%6cimit=2',
  ])
    assert.equal((await boundary(req('branches', q), 'branches', env, fetcher)).status, 400);
  assert.equal(
    (
      await boundary(
        req('branches', '?limit=2', { headers: { 'content-type': 'application/json' } }),
        'branches',
        env,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});
test('directory BFF sanitizes malformed/upstream private failure and exposes no credentials', async () => {
  for (const transport of [
    async () => {
      throw Error('synthetic.bearer.signature private');
    },
    async () => Response.json({ policy: 'staff-branch-page-v1', items: [], nextAfter: id(2) }),
    async () =>
      Response.json(
        { error: { code: 'FORBIDDEN', message: 'synthetic.bearer.signature private' } },
        { status: 403 },
      ),
  ]) {
    const r = await boundary(req(), 'branches', env, transport);
    assert.ok(r.status >= 400);
    assert.deepEqual(await r.json(), { error: 'STAFF_DIRECTORY_UNAVAILABLE' });
  }
});

test('directory BFF accepts Next Node loopback metadata without forwarding it as authority', async () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    let calls = 0;
    const response = await boundary(
      req('branches', '?limit=2', {
        headers: {
          'x-forwarded-host': '127.0.0.1:3120',
          'x-forwarded-port': '3120',
          'x-forwarded-proto': 'http',
          'x-forwarded-for': address,
        },
      }),
      'branches',
      env,
      async (_url, init) => {
        calls++;
        const headers = new Headers(init.headers);
        for (const key of [
          'x-forwarded-host',
          'x-forwarded-port',
          'x-forwarded-proto',
          'x-forwarded-for',
        ])
          assert.equal(headers.has(key), false);
        assert.equal(headers.get('authorization'), 'Bearer synthetic.bearer.signature');
        return Response.json({ policy: 'staff-branch-page-v1', items: [], nextAfter: null });
      },
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  }
});

test('directory BFF rejects incomplete, chained or foreign forwarded metadata before IO', async () => {
  let calls = 0;
  const good = {
    'x-forwarded-host': '127.0.0.1:3120',
    'x-forwarded-port': '3120',
    'x-forwarded-proto': 'http',
    'x-forwarded-for': '127.0.0.1',
  };
  for (const headers of [
    { 'x-forwarded-host': good['x-forwarded-host'] },
    { ...good, 'x-forwarded-host': 'foreign.invalid' },
    { ...good, 'x-forwarded-port': '03120' },
    { ...good, 'x-forwarded-proto': 'https' },
    { ...good, 'x-forwarded-for': '198.51.100.1' },
    { ...good, 'x-forwarded-for': '127.0.0.1, 127.0.0.1' },
    { ...good, 'x-forwarded-user': id(2) },
    { ...good, 'x-actor-id': id(2) },
  ]) {
    const response = await boundary(
      req('branches', '?limit=2', { headers }),
      'branches',
      env,
      async () => {
        calls++;
        throw Error();
      },
    );
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);
});

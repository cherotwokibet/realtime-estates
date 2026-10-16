import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiService } from '../dist/service.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(11),
  listing = id(100),
  operation = id(200),
  job = id(300),
  media = id(400);
const path = `/v2/staff/listings/${listing}/revisions/1/media-attach-intents`;
const common = {
  kind: 'attach_media',
  operationId: operation,
  jobId: job,
  listingId: listing,
  revision: 1,
  expectedVersion: '2',
};
const ready = { ...common, altText: 'Synthetic entrance', status: 'ready', receipt: null };
const applied = {
  ...ready,
  status: 'applied',
  receipt: {
    ...common,
    version: '3',
    outcome: 'applied',
    reason: null,
    mediaId: media,
    position: 0,
    completedAt: '2026-10-11T01:02:03.123456Z',
  },
};
function fixture({ role = 'agent', result = ready, code } = {}) {
  const calls = [];
  const service = createApiService({
    tenantId: tenant,
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async (request) => {
      if (request.headers.get('authorization') !== 'Bearer synthetic-agent')
        throw new Error('PRIVATE IDENTITY');
      return { actorId: actor };
    },
    database: {
      transaction: async (context, run) =>
        run({
          query: async (sql, values) => {
            calls.push({ context, sql, values });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (code) throw Object.assign(new Error('PRIVATE SQL DETAIL'), { code });
            return { rows: [{ receipt: result }] };
          },
        }),
    },
  });
  const call = (
    url = path,
    {
      method = 'POST',
      body = { operationId: operation, jobId: job, expectedVersion: 2 },
      token = 'synthetic-agent',
      headers = {},
    } = {},
  ) =>
    service(
      new Request('https://synthetic.invalid' + url, {
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(method === 'GET' || body === undefined
          ? {}
          : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }),
    );
  return { calls, call };
}

test('attach creation sends the URL tuple to SQL before mutation and returns acknowledgement only', async () => {
  const f = fixture(),
    response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ready);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
  assert.match(
    f.calls[1].sql,
    /create_media_attach_intent\(\$1::uuid,\$2::integer,\$3::bigint,\$4::uuid,\$5::uuid\)/,
  );
  assert.deepEqual(f.calls[1].values, [listing, 1, 2, operation, job]);
  assert.equal(f.calls[1].context.tenantId, tenant);
  assert.equal(f.calls[1].context.actorId, actor);
  assert.equal(f.calls.length, 2);
  assert.equal(ready.receipt, null);
});
test('attach commands and receipt reads require verified identity and current staff role', async () => {
  for (const token of [null, 'forged']) {
    const f = fixture();
    assert.equal((await f.call(undefined, { token })).status, 401);
    assert.equal(f.calls.length, 0);
  }
  for (const role of ['customer', null])
    for (const [url, method] of [
      [path, 'POST'],
      [path + '/' + operation, 'GET'],
    ]) {
      const f = fixture({ role });
      assert.equal((await f.call(url, { method })).status, 403);
      assert.equal(f.calls.length, 1);
    }
});
test('attach bodies admit exactly operation, job and original safe integer version', async () => {
  for (const key of [
    'tenantId',
    'actorId',
    'altText',
    'manifest',
    'outputId',
    'sha256',
    'accepted',
    'mediaId',
    'position',
    'status',
    'receipt',
    'version',
  ]) {
    const f = fixture();
    assert.equal(
      (
        await f.call(undefined, {
          body: { operationId: operation, jobId: job, expectedVersion: 2, [key]: 'forged' },
        })
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
  for (const body of [
    { operationId: operation, expectedVersion: 2 },
    { operationId: 'bad', jobId: job, expectedVersion: 2 },
    { operationId: job, jobId: job, expectedVersion: 2 },
  ]) {
    const f = fixture();
    assert.equal((await f.call(undefined, { body })).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const max = '9007199254740990',
    f = fixture({ result: { ...ready, expectedVersion: max } });
  assert.equal(
    (
      await f.call(undefined, {
        body: { operationId: operation, jobId: job, expectedVersion: Number(max) },
      })
    ).status,
    200,
  );
  assert.equal(f.calls[1].values[2], Number(max));
});
test('attach checks original version tokens and decoded duplicate keys before JSON numeric coercion', async () => {
  for (const token of [
    '2.00000000000000001',
    '2e0',
    '0',
    '-1',
    '9007199254740991',
    '9007199254740992',
    '"2"',
    'null',
  ]) {
    const f = fixture();
    assert.equal(
      (
        await f.call(undefined, {
          body: `{"operationId":"${operation}","jobId":"${job}","expectedVersion":${token}}`,
        })
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
  for (const duplicate of [
    '"expectedVersion":2',
    '"\\u0065xpectedVersion":2',
    `"jobId":"${job}"`,
    `"oper\\u0061tionId":"${operation}"`,
  ]) {
    const f = fixture();
    assert.equal(
      (
        await f.call(undefined, {
          body: `{"operationId":"${operation}","jobId":"${job}","expectedVersion":2,${duplicate}}`,
        })
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal(
    (
      await f.call(undefined, {
        body: `{"operationId":"${operation}","jobId":"${job}","\\u0065xpectedVersion":2}`,
      })
    ).status,
    200,
  );
});
test('attach rejects query context, wrong methods, bad paths and oversized/non-JSON input', async () => {
  const f = fixture();
  for (const query of ['tenantId=forged', 'jobId=forged', 'limit=1'])
    assert.equal((await f.call(path + '?' + query)).status, 400);
  for (const url of [
    path.replace(listing, 'bad'),
    path.replace('/1/', '/2147483648/'),
    path + '/bad',
  ])
    assert.equal((await f.call(url)).status, 400);
  const get = await f.call(path, { method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  const post = await f.call(path + '/' + operation);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  assert.equal(
    (await f.call(undefined, { headers: { 'Content-Type': 'text/plain' } })).status,
    415,
  );
  assert.equal((await f.call(undefined, { body: ' '.repeat(8193) })).status, 413);
  assert.equal((await f.call(path + '/finalize')).status, 400);
  assert.equal((await f.call(path.replace('media-attach-intents', 'media-finalize'))).status, 404);
  assert.equal(f.calls.length, 0);
});
test('attach readback binds URL identity and projects only public envelope and terminal fields', async () => {
  const f = fixture({
    result: {
      ...applied,
      outputId: 'PRIVATE',
      manifest: { secret: true },
      receipt: { ...applied.receipt, storageKey: 'PRIVATE', sha256: 'PRIVATE' },
    },
  });
  const response = await f.call(path + '/' + operation, { method: 'GET' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...applied,
    receipt: { ...applied.receipt, completedAt: '2026-10-11T01:02:03.123Z' },
  });
  assert.deepEqual(f.calls[1].values, [operation]);
  for (const changes of [{ listingId: id(101) }, { revision: 2 }, { operationId: id(201) }]) {
    const wrong = fixture({ result: { ...ready, ...changes } });
    assert.equal((await wrong.call(path + '/' + operation, { method: 'GET' })).status, 404);
  }
  for (const changes of [{ jobId: id(301) }, { expectedVersion: '3' }]) {
    const wrong = fixture({ result: { ...ready, ...changes } });
    assert.equal((await wrong.call()).status, 503);
  }
});
test('attach response validates terminal outcome, reason, resulting version and media facts', async () => {
  const failures = {
    conflict: ['VERSION_CONFLICT', 'ASSIGNMENT_CHANGED'],
    expired: ['JOB_EXPIRED'],
    rejected: [
      'REVISION_NOT_DRAFT',
      'DUPLICATE_OUTPUT',
      'CAPACITY_REACHED',
      'JOB_ALREADY_ATTACHED',
      'PROVENANCE_CHANGED',
    ],
  };
  for (const [status, reasons] of Object.entries(failures))
    for (const reason of reasons) {
      const result = {
        ...ready,
        status,
        receipt: {
          ...common,
          version: '2',
          outcome: status,
          reason,
          mediaId: null,
          position: null,
          completedAt: '2020-01-01T00:00:00.000000Z',
        },
      };
      const f = fixture({ result });
      assert.equal((await f.call(path + '/' + operation, { method: 'GET' })).status, 200);
    }
  const missing = { ...applied.receipt };
  delete missing.version;
  for (const result of [
    { ...ready, receipt: applied.receipt },
    { ...ready, status: 'queued' },
    { ...ready, altText: ' bad ' },
    { ...applied, receipt: null },
    { ...applied, receipt: missing },
    ...[
      { jobId: id(301) },
      { version: '4' },
      { version: '9007199254740992' },
      { reason: 'VERSION_CONFLICT' },
      { mediaId: null },
      { mediaId: job },
      { mediaId: operation },
      { position: 12 },
      { position: 0.5 },
      { outcome: 'conflict' },
      { completedAt: 'invalid' },
      { completedAt: '2026-02-30T01:02:03.123456Z' },
      { completedAt: '2026-10-11T01:02:03.123456+00:00' },
    ].map((patch) => ({ ...applied, receipt: { ...applied.receipt, ...patch } })),
    {
      ...ready,
      status: 'expired',
      receipt: {
        ...applied.receipt,
        outcome: 'expired',
        reason: 'VERSION_CONFLICT',
        mediaId: null,
        position: null,
      },
    },
  ]) {
    const f = fixture({ result });
    assert.equal((await f.call(path + '/' + operation, { method: 'GET' })).status, 503);
  }
});
test('attach SQL failures return safe definite errors without exposing private details', async () => {
  for (const [code, status] of [
    ['42501', 403],
    ['P0002', 404],
    ['40001', 409],
    ['23514', 422],
    ['unexpected', 503],
  ]) {
    const f = fixture({ code }),
      response = await f.call();
    assert.equal(response.status, status);
    assert.equal((await response.text()).includes('PRIVATE'), false);
  }
});

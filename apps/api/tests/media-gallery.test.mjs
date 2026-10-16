import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiService } from '../dist/service.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(11),
  listing = id(100),
  operation = id(200),
  target = id(300),
  a = id(301),
  b = id(302);
const base = `/v2/staff/listings/${listing}/revisions/1`,
  remove = base + '/media-removals',
  reorder = base + '/media-reorders',
  read = base + '/media-operations/' + operation;
const facts = {
  kind: 'remove_media',
  operationId: operation,
  listingId: listing,
  revision: 1,
  expectedVersion: '2',
  version: '3',
  outcome: 'applied',
  reason: null,
  mediaId: target,
  orderedIds: [a, b],
  completedAt: '2026-10-11T01:02:03.123456Z',
};
const wire = (value) => ({ ...value, completedAt: value.completedAt.slice(0, 23) + 'Z' });
function fixture({ role = 'agent', result = facts, code } = {}) {
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
    url = remove,
    {
      method = 'POST',
      body = { operationId: operation, mediaId: target, expectedVersion: 2 },
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
test('gallery removal sends exact URL tuple and original command to SQL', async () => {
  const f = fixture(),
    response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), wire(facts));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(
    f.calls[1].sql,
    /remove_draft_media\(\$1::uuid,\$2::integer,\$3::bigint,\$4::uuid,\$5::uuid\)/,
  );
  assert.deepEqual(f.calls[1].values, [listing, 1, 2, operation, target]);
  assert.equal(f.calls[1].context.actorId, actor);
  assert.equal(f.calls[1].context.tenantId, tenant);
  assert.equal(f.calls.length, 2);
});
test('gallery reorder sends the complete order and historical read sends only operation UUID', async () => {
  const result = { ...facts, kind: 'reorder_media', mediaId: null, orderedIds: [b, a] },
    f = fixture({ result });
  assert.equal(
    (
      await f.call(reorder, {
        body: { operationId: operation, orderedIds: [b, a], expectedVersion: 2 },
      })
    ).status,
    200,
  );
  assert.match(f.calls[1].sql, /reorder_draft_media.*\$5::uuid\[\]/);
  assert.deepEqual(f.calls[1].values, [listing, 1, 2, operation, [b, a]]);
  const response = await f.call(read, { method: 'GET' });
  assert.deepEqual(await response.json(), wire(result));
  assert.match(f.calls[3].sql, /read_media_operation\(\$1::uuid\)/);
  assert.deepEqual(f.calls[3].values, [operation]);
});
test('all gallery commands require verified identity and current staff membership', async () => {
  for (const [url, method] of [
    [remove, 'POST'],
    [reorder, 'POST'],
    [read, 'GET'],
  ]) {
    for (const token of [null, 'forged']) {
      const f = fixture();
      assert.equal((await f.call(url, { method, token })).status, 401);
      assert.equal(f.calls.length, 0);
    }
    for (const role of ['customer', null]) {
      const f = fixture({ role });
      assert.equal(
        (
          await f.call(url, {
            method,
            body:
              url === reorder
                ? { operationId: operation, orderedIds: [a, b], expectedVersion: 2 }
                : undefined,
          })
        ).status,
        403,
      );
      assert.equal(f.calls.length, 1);
    }
  }
  // Valid removal body reaches the membership check, never the mutation.
  const f = fixture({ role: 'customer' });
  assert.equal((await f.call()).status, 403);
  assert.equal(f.calls.length, 1);
});
test('gallery rejects context overrides and arbitrary metadata before SQL', async () => {
  for (const [url, body] of [
    [remove, { operationId: operation, mediaId: target, expectedVersion: 2 }],
    [reorder, { operationId: operation, orderedIds: [a, b], expectedVersion: 2 }],
  ]) {
    for (const key of [
      'tenantId',
      'actorId',
      'storageKey',
      'accepted',
      'manifest',
      'version',
      'receipt',
      'position',
      'jobId',
    ]) {
      const f = fixture();
      assert.equal((await f.call(url, { body: { ...body, [key]: 'forged' } })).status, 400);
      assert.equal(f.calls.length, 0);
    }
    for (const key of Object.keys(body)) {
      const bad = { ...body };
      delete bad[key];
      const f = fixture();
      assert.equal((await f.call(url, { body: bad })).status, 400);
      assert.equal(f.calls.length, 0);
    }
    for (const expectedVersion of [0, -1, 1.5, '2', null, 9007199254740991]) {
      const f = fixture();
      assert.equal((await f.call(url, { body: { ...body, expectedVersion } })).status, 400);
      assert.equal(f.calls.length, 0);
    }
  }
});
test('gallery raw version literals and decoded duplicate keys are checked before parse', async () => {
  for (const endpoint of ['media-removals', 'media-reorders']) {
    const payload =
      endpoint === 'media-removals' ? `"mediaId":"${target}"` : `"orderedIds":["${a}","${b}"]`;
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
          await f.call(base + '/' + endpoint, {
            body: `{"operationId":"${operation}",${payload},"expectedVersion":${token}}`,
          })
        ).status,
        400,
      );
      assert.equal(f.calls.length, 0);
    }
    for (const duplicate of [
      '"expectedVersion":2',
      '"\\u0065xpectedVersion":2',
      `"oper\\u0061tionId":"${operation}"`,
      payload,
    ]) {
      const f = fixture();
      assert.equal(
        (
          await f.call(base + '/' + endpoint, {
            body: `{"operationId":"${operation}",${payload},"expectedVersion":2,${duplicate}}`,
          })
        ).status,
        400,
      );
      assert.equal(f.calls.length, 0);
    }
  }
  const max = '9007199254740990',
    f = fixture({ result: { ...facts, expectedVersion: max, version: '9007199254740991' } });
  assert.equal(
    (
      await f.call(remove, {
        body: `{"operationId":"${operation}","mediaId":"${target}","\\u0065xpectedVersion":${max}}`,
      })
    ).status,
    200,
  );
});
test('gallery complete-order structural validation includes empty order and case-insensitive duplicates', async () => {
  for (const orderedIds of [
    null,
    {},
    ['bad'],
    [a, a],
    [a, a.toUpperCase()],
    Array.from({ length: 13 }, (_, n) => id(400 + n)),
    [a, null],
    [[a]],
  ]) {
    const f = fixture();
    assert.equal(
      (await f.call(reorder, { body: { operationId: operation, orderedIds, expectedVersion: 2 } }))
        .status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
  const result = {
      ...facts,
      kind: 'reorder_media',
      mediaId: null,
      orderedIds: [],
      version: '2',
      outcome: 'noop',
    },
    f = fixture({ result });
  assert.equal(
    (
      await f.call(reorder, {
        body: { operationId: operation, orderedIds: [], expectedVersion: 2 },
      })
    ).status,
    200,
  );
});
test('gallery paths, methods, content type and body bounds fail before SQL', async () => {
  const f = fixture();
  for (const url of [remove + '?tenantId=forged', reorder + '?limit=1', read + '?actorId=forged'])
    assert.equal((await f.call(url)).status, 400);
  for (const url of [
    remove.replace(listing, 'bad'),
    remove.replace('/1/', '/2147483648/'),
    base + '/media-operations/bad',
  ])
    assert.equal((await f.call(url)).status, 400);
  for (const url of [
    base + '/media-operations',
    remove + '/' + operation,
    reorder + '/' + operation,
  ])
    assert.equal((await f.call(url)).status, 404);
  assert.equal((await f.call(remove, { method: 'GET' })).headers.get('allow'), 'POST');
  assert.equal((await f.call(read)).headers.get('allow'), 'GET');
  assert.equal(
    (await f.call(undefined, { headers: { 'Content-Type': 'text/plain' } })).status,
    415,
  );
  assert.equal((await f.call(undefined, { body: ' '.repeat(8193) })).status, 413);
  assert.equal(f.calls.length, 0);
});
test('gallery receipt read projects allowed fields and rejects wrong URL tuple', async () => {
  const f = fixture({
      result: { ...facts, storageKey: 'PRIVATE', requesterId: actor, manifest: { secret: true } },
    }),
    response = await f.call(read, { method: 'GET' });
  assert.deepEqual(await response.json(), wire(facts));
  for (const patch of [{ listingId: id(101) }, { revision: 2 }, { operationId: id(201) }]) {
    const wrong = fixture({ result: { ...facts, ...patch } });
    assert.equal((await wrong.call(read, { method: 'GET' })).status, 404);
  }
  for (const patch of [
    { kind: 'reorder_media', mediaId: null },
    { mediaId: a },
    { expectedVersion: '3', version: '4' },
  ]) {
    const wrong = fixture({ result: { ...facts, ...patch } });
    assert.equal((await wrong.call()).status, 503);
  }
});
test('gallery projection validates correlated outcome, order, version and strict timestamps', async () => {
  const valid = [
    facts,
    { ...facts, kind: 'reorder_media', mediaId: null, orderedIds: [b, a] },
    ...['REVISION_NOT_DRAFT', 'MEDIA_NOT_FOUND', 'MEDIA_SET_CHANGED'].map((reason) => ({
      ...facts,
      outcome: 'rejected',
      reason,
      version: '2',
      orderedIds: reason === 'MEDIA_NOT_FOUND' ? [a, b] : [target, a, b],
    })),
    {
      ...facts,
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      version: '4',
      orderedIds: [target, a, b],
    },
    { ...facts, kind: 'reorder_media', mediaId: null, outcome: 'noop', reason: null, version: '2' },
  ];
  for (const result of valid) {
    const f = fixture({ result });
    assert.equal((await f.call(read, { method: 'GET' })).status, 200);
  }
  for (const patch of [
    { kind: 'attach_media' },
    { outcome: 'ready' },
    { version: '4' },
    { version: '03' },
    { version: '9007199254740992' },
    { expectedVersion: '9007199254740991' },
    { mediaId: null },
    { orderedIds: [a, a] },
    { orderedIds: [target, a] },
    { reason: 'VERSION_CONFLICT' },
    { outcome: 'noop', version: '2' },
    { outcome: 'conflict', reason: 'VERSION_CONFLICT', version: '2' },
    { outcome: 'rejected', reason: 'JOB_EXPIRED' },
    { completedAt: '2026-02-30T00:00:00.000000Z' },
    { completedAt: '2026-10-11T00:00:00.000Z' },
    { completedAt: null },
  ]) {
    const f = fixture({ result: { ...facts, ...patch } });
    assert.equal((await f.call(read, { method: 'GET' })).status, 503, JSON.stringify(patch));
  }
  const absent = fixture({
    result: {
      ...facts,
      outcome: 'rejected',
      reason: 'MEDIA_NOT_FOUND',
      version: '2',
      orderedIds: [target, a, b],
    },
  });
  assert.equal((await absent.call(read, { method: 'GET' })).status, 503);
  const f = fixture({
    result: { ...facts, kind: 'reorder_media', mediaId: null, orderedIds: [a, b] },
  });
  assert.equal(
    (
      await f.call(reorder, {
        body: { operationId: operation, orderedIds: [b, a], expectedVersion: 2 },
      })
    ).status,
    503,
  );
});
test('gallery SQL failures expose bounded safe HTTP errors', async () => {
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

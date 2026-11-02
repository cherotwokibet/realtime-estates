import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  L = id(100),
  OP = id(200),
  actor = id(11);
const command = {
  policy: 'synthetic-listing-video-command-v1',
  operationId: OP,
  listingId: L,
  revision: 1,
  expectedVersion: '1',
  video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic' },
};
const path = `/v2/staff/listings/${L}/video-operations/${OP}`;
const options = {
  tenantId: id(1),
  privacyNoticeVersion: 'synthetic',
  verifyAuthorization: async () => ({ actorId: actor }),
  database: {
    transaction: async (_c, fn) =>
      fn({
        query: async () => ({
          rows: [
            {
              value: {
                policy: 'synthetic-listing-video-record-v1',
                command,
                actorId: actor,
                resultVersion: '2',
              },
            },
          ],
        }),
      }),
  },
};
const request = (suffix = '', method = 'POST', body = JSON.stringify(command), extra = {}) =>
  new Request('http://synthetic.test' + path + suffix, {
    method,
    headers: {
      authorization: 'Bearer synthetic',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    ...(method === 'POST' ? { body } : {}),
  });
test('video API is absent by default and rejects invalid/production configuration', async () => {
  assert.equal((await createApiService(options)(request())).status, 404);
  assert.throws(() => createApiService({ ...options, listingVideoMode: 'wrong' }));
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() =>
      createApiService({ ...options, listingVideoMode: 'synthetic-private-listing-video-v1' }),
    );
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
});
test('enabled video API returns exact server-authorized command and no-store response', async () => {
  let context, sql;
  const run = createApiService({
    ...options,
    listingVideoMode: 'synthetic-private-listing-video-v1',
    database: {
      transaction: async (c, fn) => {
        context = c;
        return fn({
          query: async (s) => {
            sql = s;
            return {
              rows: [
                {
                  value: {
                    policy: 'synthetic-listing-video-record-v1',
                    command,
                    actorId: actor,
                    resultVersion: '2',
                  },
                },
              ],
            };
          },
        });
      },
    },
  });
  const r = await run(request());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(context.actorId, actor);
  assert.equal(context.tenantId, id(1));
  assert.match(sql, /save_synthetic_listing_video/);
  assert.deepEqual((await r.json()).command, command);
});
test('video route refuses context headers, query, duplicate keys, changed targets and missing identity before database', async () => {
  let calls = 0;
  const run = createApiService({
    ...options,
    listingVideoMode: 'synthetic-private-listing-video-v1',
    database: {
      transaction: async () => {
        calls++;
        throw Error();
      },
    },
  });
  for (const req of [
    request('?tenant=x'),
    request('', 'POST', JSON.stringify({ ...command, listingId: id(999) })),
    request(
      '',
      'POST',
      JSON.stringify(command).replace('"revision":1', '"revision":1,"revision":1'),
    ),
    request('', 'POST', JSON.stringify(command), { 'x-actor-id': actor }),
    request('', 'POST', JSON.stringify(command), { cookie: 'secret=x' }),
  ])
    assert.equal((await run(req)).status, 400);
  const guest = new Request('http://synthetic.test' + path);
  assert.equal((await run(guest)).status, 401);
  assert.equal(calls, 0);
});

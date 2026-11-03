import test from 'node:test';
import assert from 'node:assert/strict';
import { createListingVideoClient } from '../dist/tests/lib/listing-video-client.js';
import { listingVideoRequest } from '../dist/tests/lib/listing-video-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  scope = { instanceId: id(1), tenantId: id(2), actorId: id(3), listingId: id(4), revision: 1 },
  command = {
    policy: 'synthetic-listing-video-command-v1',
    operationId: id(5),
    listingId: id(4),
    revision: 1,
    expectedVersion: '3',
    video: null,
  },
  record = {
    policy: 'synthetic-listing-video-record-v1',
    command,
    actorId: id(3),
    resultVersion: '4',
  };
test('browser adapter uses bounded same-origin body without upstream token; recovery never calls a save endpoint', async () => {
  const seen = [],
    c = createListingVideoClient(scope, async (url, options) => {
      seen.push({ url, options });
      return Response.json(record, {
        headers: { 'cache-control': 'private, no-store, max-age=0' },
      });
    });
  await c.save(command);
  await c.recover(command);
  assert.ok(seen[1].url.endsWith('/recover'));
  for (const x of seen) {
    assert.equal(x.options.credentials, 'omit');
    assert.equal(x.options.redirect, 'error');
    assert.equal(x.options.headers.Authorization, undefined);
    assert.equal(JSON.parse(x.options.body).expectedVersion, '3');
  }
});
test('browser adapter rejects changed/cached/unknown successful results and marks only writes uncertain', async () => {
  for (const response of [
    () => Response.json(record),
    () =>
      Response.json({ ...record, actorId: id(8) }, { headers: { 'cache-control': 'no-store' } }),
    () =>
      Response.json(
        { ...record, resultVersion: '9' },
        { headers: { 'cache-control': 'no-store' } },
      ),
  ]) {
    const c = createListingVideoClient(scope, async () => response());
    await assert.rejects(c.save(command), (e) => e.submissionUncertain === true);
    await assert.rejects(c.recover(command), (e) => e.submissionUncertain === false);
  }
});
test('BFF refuses omitted configuration before reading identity or dispatching', async () => {
  let count = 0;
  const r = await listingVideoRequest(
    new Request(
      'http://127.0.0.1:3132/api/staff/listings/' + id(4) + '/video-operations/' + id(5),
      { method: 'POST' },
    ),
    {},
    async () => {
      count++;
      throw Error();
    },
  );
  assert.equal(r.status, 403);
  assert.equal(count, 0);
  assert.equal((await r.json()).submissionUncertain, false);
});

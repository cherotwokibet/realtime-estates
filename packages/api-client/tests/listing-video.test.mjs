import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  command = {
    policy: 'synthetic-listing-video-command-v1',
    operationId: id(1),
    listingId: id(2),
    revision: 1,
    expectedVersion: '1',
    video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic tour' },
  };
const record = {
    policy: 'synthetic-listing-video-record-v1',
    command,
    actorId: id(3),
    resultVersion: '2',
  },
  auth = { bearerToken: 'synthetic-video-only' };
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch,
  });
const reply = (v) => Response.json(v, { headers: { 'cache-control': 'no-store' } });
test('video SDK snapshots nested command before asynchronous transport and uses no-store credential-free request', async () => {
  const input = structuredClone(command);
  let sent;
  const client = api(async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return reply(record);
  });
  const promise = client.savePrivateListingVideo(input, auth);
  input.video.title = 'Changed';
  const r = await promise;
  assert.equal(r.command.video.title, command.video.title);
  assert.equal(sent.body.video.title, command.video.title);
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.cache, 'no-store');
  assert.equal(sent.options.redirect, 'error');
});
test('invalid video input and revision targets fail before fetch', async () => {
  let calls = 0;
  const client = api(async () => {
    calls++;
    return reply(record);
  });
  await assert.rejects(
    () =>
      client.savePrivateListingVideo(
        { ...command, video: { ...command.video, url: 'https://private.test' } },
        auth,
      ),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => client.getPrivateListingVideo(id(2), 1.5, auth),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
});
test('malformed or changed video write replies stay uncertain without retries', async () => {
  for (const output of [
    { ...record, resultVersion: '9' },
    { ...record, command: { ...command, video: null } },
    { unexpected: true },
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        api(async () => {
          calls++;
          return reply(output);
        }).savePrivateListingVideo(command, auth),
      (e) => e.submissionUncertain && e.kind === 'INVALID_RESPONSE',
    );
    assert.equal(calls, 1);
  }
});
test('video original recovery is GET-only and rejects another original or cacheable successful read', async () => {
  let method;
  const client = api(async (_url, o) => {
    method = o.method;
    return reply(record);
  });
  assert.deepEqual(await client.getPrivateListingVideoOriginal(command, auth), record);
  assert.equal(method, 'GET');
  await assert.rejects(
    () =>
      api(async () =>
        reply({ ...record, command: { ...command, video: null } }),
      ).getPrivateListingVideoOriginal(command, auth),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    () => api(async () => Response.json(record)).getPrivateListingVideoOriginal(command, auth),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { photoPreviewRequest } from '../dist/tests/lib/photo-preview-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const params = { id: id(1), revision: '1', jobId: id(2), uploadId: id(3) },
  instance = id(9);
const job = {
  kind: 'register_media_upload',
  operationId: id(4),
  jobId: id(2),
  listingId: id(1),
  revision: 1,
  expectedVersion: '2',
  altText: 'Synthetic photo',
  registeredAt: '2026-10-11T00:00:00.000Z',
  expiresAt: '2099-10-12T00:00:00.000Z',
  state: 'registered',
};
// The SDK requires exactly 24h expiry. Generate a current fixture rather than
// making production timing assumptions from a fixed test date.
job.registeredAt = new Date(Date.now() - 1000).toISOString();
job.expiresAt = new Date(Date.parse(job.registeredAt) + 86400000).toISOString();
const status = { listingId: id(1), revision: 1, jobId: id(2), uploadId: id(3), state: 'verified' };
const make = (body = new Uint8Array([1, 2, 3]), patch = {}) =>
  new Request(
    `http://127.0.0.1:3001/api/staff/drafts/${id(1)}/1/media-jobs/${id(2)}/uploads/${id(3)}`,
    {
      method: 'PUT',
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'x-preview-instance': instance,
        'content-type': 'application/octet-stream',
        ...patch,
      },
      body,
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    },
  );
test('photo BFF rejects unavailable/cross-origin resources before bytes and forwards one bounded binary body', async (t) => {
  const old = { ...process.env };
  let gets = 0,
    puts = 0,
    finalizes = 0;
  const bodies = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('Content-Type', 'application/json');
    assert.equal(request.headers.authorization, 'Bearer a.b.c');
    if (request.url.endsWith('/finalize')) {
      finalizes++;
      assert.equal(Buffer.concat(chunks).length, 0);
      assert.equal(request.headers['content-type'], undefined);
      response.end(
        JSON.stringify({
          kind: 'attach_media',
          operationId: id(6),
          jobId: id(2),
          listingId: id(1),
          revision: 1,
          expectedVersion: '2',
          altText: 'Synthetic photo',
          status: 'applied',
          receipt: {
            kind: 'attach_media',
            operationId: id(6),
            jobId: id(2),
            listingId: id(1),
            revision: 1,
            expectedVersion: '2',
            version: '3',
            outcome: 'applied',
            reason: null,
            mediaId: id(7),
            position: 0,
            completedAt: new Date().toISOString(),
          },
        }),
      );
      return;
    }
    if (request.method === 'GET') {
      gets++;
      response.end(JSON.stringify(job));
    } else {
      puts++;
      bodies.push(Buffer.concat(chunks));
      assert.equal(request.headers['content-type'], 'application/octet-stream');
      response.end(JSON.stringify(status));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(old, key)) delete process.env[key];
    Object.assign(process.env, old);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_MEDIA: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: `http://127.0.0.1:${server.address().port}`,
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  for (const patch of [
    { origin: 'https://other.invalid' },
    { 'x-preview-instance': 'old' },
    { authorization: 'Bearer selected' },
    { host: 'other.invalid' },
  ])
    assert.equal((await photoPreviewRequest(make(undefined, patch), params, 'upload')).status, 403);
  process.env.NODE_ENV = 'production';
  assert.equal((await photoPreviewRequest(make(), params, 'upload')).status, 403);
  process.env.NODE_ENV = 'development';
  assert.equal(
    (await photoPreviewRequest(make(), { ...params, uploadId: 'bad' }, 'upload')).status,
    400,
  );
  assert.equal(
    (await photoPreviewRequest(make(undefined, { 'content-encoding': 'gzip' }), params, 'upload'))
      .status,
    400,
  );
  assert.equal(gets, 0);
  assert.equal(puts, 0);
  const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
  assert.equal((await photoPreviewRequest(make(tooLarge), params, 'upload')).status, 400);
  assert.equal(gets, 1);
  assert.equal(puts, 0);
  let chunks = 0;
  const streamed = new ReadableStream({
    pull(controller) {
      chunks++;
      if (chunks < 10) controller.enqueue(new Uint8Array());
      else if (chunks < 14) controller.enqueue(new Uint8Array([chunks]));
      else controller.close();
    },
  });
  const result = await photoPreviewRequest(make(streamed), params, 'upload');
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), status);
  assert.equal(gets, 2);
  assert.equal(puts, 1);
  assert.deepEqual([...bodies[0]], [10, 11, 12, 13]);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await photoPreviewRequest(make(undefined, { 'content-length': '9' }), params, 'upload'))
      .status,
    400,
  );
  assert.equal(puts, 1);
  const empty = (body) =>
    new Request('http://127.0.0.1:3001/api/finalize', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'x-preview-instance': instance,
      },
      body,
    });
  assert.equal(
    (
      await photoPreviewRequest(
        empty(new Uint8Array([1])),
        { id: id(1), revision: '1', operationId: id(6) },
        'finalize',
      )
    ).status,
    400,
  );
  assert.equal(finalizes, 0);
  const finalized = await photoPreviewRequest(
    empty(new Uint8Array()),
    { id: id(1), revision: '1', operationId: id(6) },
    'finalize',
  );
  assert.equal(finalized.status, 200);
  assert.equal((await finalized.json()).status, 'applied');
  assert.equal(finalizes, 1);
});

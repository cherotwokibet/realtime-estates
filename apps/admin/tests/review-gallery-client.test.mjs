import test from 'node:test';
import assert from 'node:assert/strict';
import { readReviewGallery } from '../dist/tests/lib/review-gallery-client.js';
import { createReviewImageBatch } from '../dist/tests/lib/private-image.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  scope = { instanceId: id(1), listingId: id(2), revision: 12, version: '7' };
const gallery = () => ({
  kind: 'review_media_gallery',
  listingId: scope.listingId,
  revision: 12,
  version: '7',
  state: 'pending',
  photos: Array.from({ length: 4 }, (_, position) => ({
    id: id(100 + position),
    alt: 'Synthetic',
    position,
  })),
});
test('browser gallery fixes same-origin path and exact tuple without credentials or implicit retry', async () => {
  let calls = 0;
  const g = await readReviewGallery(scope, new AbortController().signal, async (path, init) => {
    calls++;
    assert.equal(path, `/api/staff/reviews/${scope.listingId}/12/media-gallery`);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, {
      'X-Preview-Instance': scope.instanceId,
      'X-Revision-Version': '7',
    });
    return Response.json(gallery());
  });
  assert.equal(calls, 1);
  assert.deepEqual(g, gallery());
  assert.ok(Object.isFrozen(g.photos[0]));
});
test('browser gallery rejects changed tuples malformed UTF8 oversized bodies and denial', async () => {
  for (const response of [
    Response.json({ ...gallery(), version: '8' }),
    Response.json({ ...gallery(), photos: [] }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    new Response(' '.repeat(32769), { headers: { 'Content-Type': 'application/json' } }),
    Response.json(gallery(), { status: 409 }),
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      readReviewGallery(scope, new AbortController().signal, async () => {
        calls++;
        return response;
      }),
    );
    assert.equal(calls, 1);
  }
});
test('browser gallery aborts before dispatch and cancels a late ignored fetch response', async () => {
  let calls = 0;
  const early = new AbortController();
  early.abort();
  await assert.rejects(() =>
    readReviewGallery(scope, early.signal, async () => {
      calls++;
      return Response.json(gallery());
    }),
  );
  assert.equal(calls, 0);
  let release,
    cancelled = 0;
  const controller = new AbortController();
  const work = readReviewGallery(
    scope,
    controller.signal,
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  controller.abort();
  await assert.rejects(() => work);
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, 1);
});
const bytes = () => {
  const b = Buffer.alloc(24);
  b.write('RIFF');
  b.writeUInt32LE(16, 4);
  b.write('WEBP', 8);
  return b;
};
test('review image factory pins reviewer paths and revokes owned URLs on close and decode failure', async () => {
  const states = [],
    revoked = [];
  let calls = 0;
  const batch = createReviewImageBatch([{ ...scope, mediaId: id(100) }], {
    onState: (s) => states.push(s),
    onStale: () => {},
    createUrl: () => 'blob:owned-review',
    revokeUrl: (url) => revoked.push(url),
    fetch: async (path, init) => {
      calls++;
      assert.equal(path, `/api/staff/reviews/${scope.listingId}/12/media/${id(100)}/preview`);
      assert.equal(init.credentials, 'omit');
      return new Response(bytes(), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '24',
          'X-Revision-Version': '7',
        },
      });
    },
  });
  batch.start();
  for (let n = 0; n < 50 && !states.some((s) => s.phase === 'ready'); n++)
    await new Promise((r) => setTimeout(r, 1));
  assert.ok(states.some((s) => s.phase === 'ready'));
  batch.decodeFailed(id(100), 'blob:owned-review');
  batch.close();
  assert.deepEqual(revoked, ['blob:owned-review']);
  assert.equal(calls, 1);
});
test('review batch rejects a response URL from the draft policy before creating a URL', async () => {
  const states = [];
  let created = 0;
  const batch = createReviewImageBatch([{ ...scope, mediaId: id(100) }], {
    onState: (s) => states.push(s),
    onStale: () => {},
    createUrl: () => {
      created++;
      return 'blob:bad';
    },
    fetch: async () => {
      const r = new Response(bytes(), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '24',
          'X-Revision-Version': '7',
        },
      });
      Object.defineProperty(r, 'url', {
        value: `http://127.0.0.1:3001/api/staff/drafts/${scope.listingId}/12/media/${id(100)}/preview`,
      });
      return r;
    },
  });
  batch.start();
  for (let n = 0; n < 50 && !states.some((s) => s.phase === 'unavailable'); n++)
    await new Promise((r) => setTimeout(r, 1));
  assert.ok(states.some((s) => s.phase === 'unavailable'));
  assert.equal(created, 0);
  batch.close();
});

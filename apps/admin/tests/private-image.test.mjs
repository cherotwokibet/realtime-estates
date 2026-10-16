import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPrivateImageBatch,
  privateGalleryScope,
  privateImageKey,
} from '../dist/tests/lib/private-image.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const resource = (n) => ({
  instanceId: id(1),
  listingId: id(2),
  revision: 1,
  version: '7',
  mediaId: id(n + 20),
});
const wait = () => new Promise((resolve) => setTimeout(resolve, 1));
async function until(check) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await wait();
  }
  assert.fail('Image state did not settle.');
}
function webp() {
  const bytes = new Uint8Array(24);
  bytes.set([82, 73, 70, 70], 0);
  new DataView(bytes.buffer).setUint32(4, 16, true);
  bytes.set([87, 69, 66, 80], 8);
  return bytes;
}
function response({ status = 200, data = webp(), headers = {} } = {}) {
  return new Response(data, {
    status,
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(data.byteLength),
      'X-Revision-Version': '7',
      ...headers,
    },
  });
}
function fixture(resources = [resource(0)], extra = {}) {
  const states = [],
    stale = [],
    denied = [],
    created = [],
    revoked = [],
    calls = [];
  const batch = createPrivateImageBatch(resources, {
    onState: (value) => states.push(value),
    onStale: (value) => stale.push(value),
    onDenied: (value) => denied.push(value),
    fetch: async (path, options) => {
      calls.push({ path, options });
      return response();
    },
    createUrl: (blob) => {
      const url = `blob:synthetic-${created.length}`;
      created.push({ url, blob });
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
    ...extra,
  });
  return { batch, states, stale, denied, created, revoked, calls };
}
test('eligible saved draft scope excludes default legacy/unaccepted/non-draft images and ignores proposed order/text', () => {
  const workspace = {
    listingId: id(2),
    draft: { revision: 1, version: '7', state: 'draft', content: { title: 'raw' } },
    photos: [
      { id: id(20), accepted: true, provenance: 'sealed' },
      { id: id(21), accepted: true, provenance: 'legacy' },
      { id: id(22), accepted: false, provenance: 'sealed' },
    ],
  };
  const original = privateGalleryScope(workspace, id(1), true);
  assert.deepEqual(original.resources, [resource(0)]);
  assert.ok(Object.isFrozen(original.resources[0]));
  assert.equal(
    privateGalleryScope(
      {
        ...workspace,
        draft: { ...workspace.draft, content: { title: 'changed' } },
        photos: [...workspace.photos].reverse(),
      },
      id(1),
      true,
    ).key,
    original.key,
  );
  for (const state of ['pending', 'approved', 'rejected'])
    assert.deepEqual(
      privateGalleryScope({ ...workspace, draft: { ...workspace.draft, state } }, id(1), true)
        .resources,
      [],
    );
  assert.deepEqual(privateGalleryScope(workspace, id(1), false).resources, []);
  assert.notEqual(
    privateGalleryScope({ ...workspace, draft: { ...workspace.draft, version: '8' } }, id(1), true)
      .key,
    original.key,
  );
  for (const extra of [{ version: '07' }, { version: '9007199254740992' }, { revision: 0 }])
    assert.throws(() =>
      privateGalleryScope({ ...workspace, draft: { ...workspace.draft, ...extra } }, id(1), true),
    );
  assert.throws(() =>
    privateGalleryScope(
      { ...workspace, photos: Array.from({ length: 13 }, () => workspace.photos[0]) },
      id(1),
      true,
    ),
  );
});
test('one bounded batch captures each original tuple and starts at most two reads without repeat', async () => {
  const resources = Array.from({ length: 12 }, (_, n) => resource(n)),
    pending = [];
  let active = 0,
    maximum = 0;
  const f = fixture(resources, {
    fetch: (path, options) =>
      new Promise((resolve) => {
        active++;
        maximum = Math.max(maximum, active);
        pending.push({
          path,
          options,
          finish: () => {
            active--;
            resolve(response());
          },
        });
      }),
  });
  f.batch.start();
  f.batch.start();
  assert.equal(pending.length, 2);
  resources[0].version = '8';
  for (let n = 0; n < 12; n++) {
    await until(() => pending.length > n);
    assert.equal(pending[n].options.headers['X-Revision-Version'], '7');
    pending[n].finish();
    await wait();
  }
  await until(() => f.created.length === 12);
  assert.equal(maximum, 2);
  assert.equal(pending.length, 12);
  assert.equal(f.states.filter((value) => value.phase === 'ready').length, 12);
  assert.equal(pending[0].options.credentials, 'omit');
  assert.equal(pending[0].options.cache, 'no-store');
  assert.equal(pending[0].options.redirect, 'error');
  assert.equal(pending[0].options.body, undefined);
  assert.deepEqual(pending[0].options.headers, {
    'X-Preview-Instance': id(1),
    'X-Revision-Version': '7',
  });
  f.batch.close();
  f.batch.close();
  assert.equal(f.revoked.length, 12);
  assert.equal(new Set(f.revoked).size, 12);
});
test('response body collects tiny/empty chunks once into an exact private WebP blob', async () => {
  let index = 0;
  const bytes = webp(),
    body = new ReadableStream({
      pull(controller) {
        if (index === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array());
        controller.enqueue(bytes.slice(index, index + 1));
        index++;
      },
    });
  const f = fixture(undefined, {
    fetch: async () =>
      new Response(body, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '24',
          'X-Revision-Version': '7',
        },
      }),
  });
  f.batch.start();
  await until(() => f.created.length === 1);
  assert.equal(f.created[0].blob.type, 'image/webp');
  assert.deepEqual(new Uint8Array(await f.created[0].blob.arrayBuffer()), bytes);
  assert.equal(f.states.at(-1).key, privateImageKey(resource(0)));
  f.batch.close();
});
test('wrong version/type/framing/byte count and invalid WebP remain unavailable without object URLs or retries', async () => {
  const corrupt = webp();
  corrupt[0] = 0;
  for (const value of [
    response({ headers: { 'X-Revision-Version': '8' } }),
    response({ headers: { 'Content-Type': 'image/png' } }),
    response({ headers: { 'Content-Length': '0' } }),
    response({ headers: { 'Content-Length': '10485761' } }),
    response({ headers: { 'Content-Length': '23' } }),
    response({ headers: { 'Content-Length': '25' } }),
    response({ headers: { 'Content-Encoding': 'gzip' } }),
    response({ headers: { 'Content-Range': 'bytes 0-23/24' } }),
    response({ data: corrupt }),
    response({ status: 503 }),
  ]) {
    let calls = 0;
    const f = fixture(undefined, {
      fetch: async () => {
        calls++;
        return value;
      },
    });
    f.batch.start();
    await until(() => f.states.at(-1)?.phase === 'unavailable');
    assert.equal(f.created.length, 0);
    assert.equal(calls, 1);
    assert.equal(f.stale.length, 0);
    f.batch.close();
  }
});
test('stale response revokes existing URLs, aborts in-flight/queued work and emits one scoped conflict', async () => {
  const pending = [];
  const f = fixture(
    Array.from({ length: 5 }, (_, n) => resource(n)),
    { fetch: (path, options) => new Promise((resolve) => pending.push({ options, resolve })) },
  );
  f.batch.start();
  pending[0].resolve(response());
  await until(() => f.created.length === 1 && pending.length === 3);
  pending[1].resolve(response({ status: 409 }));
  await until(() => f.stale.length === 1);
  assert.deepEqual(f.stale[0], resource(1));
  assert.deepEqual(f.revoked, [f.created[0].url]);
  assert.equal(pending.length, 3);
  assert.ok(pending[2].options.signal.aborted);
  pending[2].resolve(response());
  await wait();
  assert.equal(f.created.length, 1);
  assert.equal(
    f.states.slice(-5).every((value) => value.phase === 'stale'),
    true,
  );
  f.batch.close();
  assert.equal(f.revoked.length, 1);
});
test('known access/resource loss revokes ready siblings and cancels the whole batch without a false stale signal', async () => {
  for (const status of [401, 403, 404]) {
    const pending = [],
      f = fixture(
        Array.from({ length: 5 }, (_, n) => resource(n)),
        { fetch: (path, options) => new Promise((resolve) => pending.push({ options, resolve })) },
      );
    f.batch.start();
    pending[0].resolve(response());
    await until(() => f.created.length === 1 && pending.length === 3);
    pending[1].resolve(response({ status }));
    await until(() => f.denied.length === 1);
    assert.deepEqual(f.denied[0], resource(1));
    assert.equal(f.stale.length, 0);
    assert.equal(pending.length, 3);
    assert.ok(pending[2].options.signal.aborted);
    assert.deepEqual(f.revoked, [f.created[0].url]);
    assert.equal(
      f.states.slice(-5).every((value) => value.phase === 'unavailable'),
      true,
    );
    pending[2].resolve(response());
    await wait();
    assert.equal(f.created.length, 1);
    f.batch.close();
    assert.equal(f.revoked.length, 1);
  }
});
test('redirected and mismatched response URLs cannot create private image URLs', async () => {
  const expected = `http://127.0.0.1:3001/api/staff/drafts/${id(2)}/1/media/${id(20)}/preview`;
  for (const patch of [
    { redirected: true },
    { url: expected + '?version=8' },
    { url: expected.replace(id(20), id(21)) },
    { url: expected.replace('http://127.0.0.1:3001', 'https://foreign.invalid') },
  ]) {
    const value = response();
    for (const [key, data] of Object.entries(patch))
      Object.defineProperty(value, key, { value: data });
    const f = fixture(undefined, { fetch: async () => value });
    f.batch.start();
    await until(() => f.states.at(-1)?.phase === 'unavailable');
    assert.equal(f.created.length, 0);
    f.batch.close();
  }
});
test('obsolete completion after cleanup cannot create URL, update state or raise a stale conflict', async () => {
  for (const status of [200, 409]) {
    let finish;
    const f = fixture(undefined, {
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    f.batch.start();
    const count = f.states.length;
    f.batch.close();
    finish(response({ status }));
    await wait();
    await wait();
    assert.equal(f.states.length, count);
    assert.equal(f.created.length, 0);
    assert.equal(f.stale.length, 0);
  }
});
test('decode failure revokes only the exact current object URL and never retries', async () => {
  const f = fixture();
  f.batch.start();
  await until(() => f.created.length === 1);
  const url = f.created[0].url;
  f.batch.decodeFailed(resource(0).mediaId, 'blob:obsolete');
  assert.equal(f.revoked.length, 0);
  f.batch.decodeFailed(resource(0).mediaId, url);
  assert.equal(f.states.at(-1).phase, 'unavailable');
  assert.deepEqual(f.revoked, [url]);
  f.batch.decodeFailed(resource(0).mediaId, url);
  f.batch.close();
  assert.equal(f.revoked.length, 1);
  assert.equal(f.calls.length, 1);
});
test('pending fetch/body and immediate empty-chunk producer respect deadline and cancel without retry', async () => {
  const fetchPending = fixture(undefined, { timeoutMs: 10, fetch: () => new Promise(() => {}) });
  fetchPending.batch.start();
  await until(() => fetchPending.states.at(-1)?.phase === 'unavailable');
  fetchPending.batch.close();
  for (const empty of [false, true]) {
    let cancelled = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (empty) controller.enqueue(new Uint8Array());
        else return new Promise(() => {});
      },
      cancel() {
        cancelled++;
      },
    });
    const f = fixture(undefined, {
      timeoutMs: 10,
      fetch: async () =>
        new Response(body, {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Length': '24',
            'X-Revision-Version': '7',
          },
        }),
    });
    f.batch.start();
    await until(() => f.states.at(-1)?.phase === 'unavailable');
    assert.equal(f.created.length, 0);
    await until(() => cancelled === 1);
    f.batch.close();
  }
});
test('ambiguous batches cannot mix saved identities or exceed twelve photos', () => {
  const options = { onState: () => {}, onStale: () => {} };
  for (const resources of [
    [resource(0), resource(0)],
    [resource(0), { ...resource(1), version: '8' }],
    [resource(0), { ...resource(1), instanceId: id(9) }],
    Array.from({ length: 13 }, (_, n) => resource(n)),
  ])
    assert.throws(() => createPrivateImageBatch(resources, options));
});

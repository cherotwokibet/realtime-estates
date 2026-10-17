import test from 'node:test';
import assert from 'node:assert/strict';
import { readListingImportPreview } from '../dist/tests/lib/listing-import-client.js';
import { LISTING_IMPORT_COLUMNS, previewListingImport } from '@realtor/domain';
const instance = '00000000-0000-4000-8000-000000000009',
  csv =
    LISTING_IMPORT_COLUMNS.join(',') +
    '\n' +
    [
      'new-stock',
      'Synthetic title',
      '',
      'rent',
      'apartment',
      '20000.05',
      'month',
      '1',
      '1',
      '',
      'KE',
      'Synthetic locality',
      'area',
    ].join(',');
const data = () => previewListingImport(csv, [], true);
test('import browser transport fixes same-origin POST with instance only and frozen CSV-bound response', async () => {
  let calls = 0;
  const result = await readListingImportPreview(
    instance,
    csv,
    new AbortController().signal,
    async (url, init) => {
      calls++;
      assert.equal(url, '/api/staff/listing-import-preview');
      assert.equal(init.method, 'POST');
      assert.deepEqual(init.headers, {
        'Content-Type': 'application/json',
        'X-Preview-Instance': instance,
      });
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.deepEqual(JSON.parse(init.body), { csv });
      return Response.json(data());
    },
  );
  assert.equal(result.rows[0].content.amountMinor, 2000005);
  assert.ok(Object.isFrozen(result));
  assert.equal(calls, 1);
});
test('invalid CSV, instance and predispatch cancellation do not dispatch', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    throw Error();
  };
  await assert.rejects(() =>
    readListingImportPreview(instance, 'bad', new AbortController().signal, transport),
  );
  await assert.rejects(() =>
    readListingImportPreview('bad', csv, new AbortController().signal, transport),
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(() => readListingImportPreview(instance, csv, c.signal, transport));
  assert.equal(calls, 0);
});
test('bad facts, framing, size, UTF8, duplicate keys and denied access fail without returning prior data', async () => {
  const bad = JSON.parse(JSON.stringify(data()));
  bad.validRows = 99;
  for (const response of [
    () => Response.json(bad),
    () => new Response('{"x":1,"x":2}', { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }),
    () =>
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '3' },
      }),
    () => new Response('x'.repeat(1048577), { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      readListingImportPreview(instance, csv, new AbortController().signal, async () => {
        calls++;
        return response();
      }),
    );
    assert.equal(calls, 1);
  }
});
test('cancellation ignores and cancels a late response, and closes stalled response reads', async () => {
  let resolve,
    cancelled = 0;
  const c = new AbortController(),
    pending = new Promise((r) => (resolve = r));
  const read = readListingImportPreview(instance, csv, c.signal, async () => {
    await pending;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  c.abort();
  await assert.rejects(() => read);
  resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelled, 1);
  const d = new AbortController();
  let started;
  const ready = new Promise((r) => (started = r));
  const stalled = readListingImportPreview(
    instance,
    csv,
    d.signal,
    async () =>
      new Response(
        new ReadableStream({
          start() {
            started();
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  await ready;
  await new Promise((r) => setTimeout(r, 0));
  d.abort();
  await assert.rejects(() => stalled);
  assert.equal(cancelled, 2);
});

test('downloadable template matches the maintained exact CSV header', async () => {
  const { readFile } = await import('node:fs/promises');
  const template = await readFile(
    new URL('../public/listing-import-template.csv', import.meta.url),
    'utf8',
  );
  assert.equal(template.trim(), LISTING_IMPORT_COLUMNS.join(','));
});

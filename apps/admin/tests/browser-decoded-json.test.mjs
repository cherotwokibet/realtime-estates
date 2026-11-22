import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import {
  readBrowserDecodedJson,
  browserDecodedJsonLength,
} from '../dist/tests/lib/browser-decoded-json.js';
import { readReferenceJson } from '../dist/tests/lib/reference-draft-wire.js';
import { readReferenceModerationJson } from '../dist/tests/lib/reference-moderation-wire.js';
import { readPrivateWorkspaceLease } from '../dist/tests/lib/private-workspace-lease-client.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const encoders = {
  gzip: gzipSync,
  br: brotliCompressSync,
  deflate: deflateSync,
  identity: (b) => b,
};
async function serving(text, encoding, run) {
  const bytes = Buffer.from(text),
    encoded = encoders[encoding](bytes),
    server = createServer((req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': encoding,
        'content-length': encoded.length,
        'cache-control': 'no-store',
      });
      res.end(encoded);
    });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await run('http://127.0.0.1:' + server.address().port, encoded.length, bytes.length);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
test('actual listening HTTP Fetch decodes gzip, br, deflate and identity without equating encoded and decoded lengths', async () => {
  for (const encoding of Object.keys(encoders)) {
    const value = { text: 'synthetic'.repeat(300) };
    await serving(JSON.stringify(value), encoding, async (origin, wire, decoded) => {
      const response = await fetch(origin);
      assert.equal(response.headers.get('content-encoding'), encoding);
      if (encoding !== 'identity') assert.notEqual(wire, decoded);
      assert.deepEqual(
        await readBrowserDecodedJson(response, 4096, AbortSignal.timeout(5000)),
        value,
      );
    });
  }
  const now = Date.now(),
    lease = {
      policy: 'staff-access-lease-v1',
      tenantId: id(1),
      actorId: id(10),
      role: 'admin',
      checkedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30000).toISOString(),
    };
  await serving(JSON.stringify(lease), 'gzip', async (origin) => {
    const result = await readPrivateWorkspaceLease(
      { profile: 'staff', instanceId: id(9) },
      AbortSignal.timeout(5000),
      async (path, init) => {
        assert.equal(init.credentials, 'omit');
        assert.equal(path, '/api/private-workspace/lease/staff');
        const r = await fetch(origin, init);
        Object.defineProperty(r, 'url', { value: origin + path });
        return r;
      },
    );
    assert.deepEqual(result, lease);
  });
});
test('small compressed responses cannot exceed the decoded byte limit', async () => {
  await serving(JSON.stringify({ text: 'x'.repeat(10000) }), 'gzip', async (origin, wire) => {
    assert.ok(wire < 4096);
    await assert.rejects(() =>
      fetch(origin).then((r) => readBrowserDecodedJson(r, 4096, AbortSignal.timeout(5000))),
    );
  });
});
test('unsupported encodings, malformed lengths, identity mismatches, duplicate keys and bad UTF8 remain rejected', async () => {
  for (const headers of [
    { 'content-encoding': 'unknown' },
    { 'content-encoding': 'gzip, br' },
    { 'content-encoding': '' },
    { 'content-length': '01' },
    { 'content-length': '99999' },
  ])
    await assert.rejects(() =>
      readBrowserDecodedJson(
        new Response('{}', { headers: { 'content-type': 'application/json', ...headers } }),
        4096,
        AbortSignal.timeout(5000),
      ),
    );
  for (const [body, headers] of [
    ['{}', { 'content-length': '1' }],
    ['{"x":1,"x":2}', { 'content-encoding': 'gzip' }],
    [new Uint8Array([255]), { 'content-encoding': 'br' }],
  ])
    await assert.rejects(() =>
      readBrowserDecodedJson(
        new Response(body, { headers: { 'content-type': 'application/json', ...headers } }),
        4096,
        AbortSignal.timeout(5000),
      ),
    );
  assert.throws(() => browserDecodedJsonLength(Response.json({}), 0));
});
test('raw Request compression is still refused while decoded moderation responses retain lexical validation', async () => {
  const headers = { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    request = new Request('http://127.0.0.1', {
      method: 'POST',
      headers,
      body: gzipSync(Buffer.from('{"position":1}')),
    });
  await assert.rejects(() => readReferenceJson(request, 4096, AbortSignal.timeout(5000)));
  await assert.rejects(() =>
    readReferenceModerationJson(
      new Request('http://127.0.0.1', { method: 'POST', headers, body: '{"position":1}' }),
      AbortSignal.timeout(5000),
    ),
  );
  assert.deepEqual(
    await readReferenceModerationJson(
      new Response('{"position":1}', { headers }),
      AbortSignal.timeout(5000),
    ),
    { position: 1 },
  );
  await assert.rejects(() =>
    readReferenceModerationJson(
      new Response('{"position":1e0}', { headers }),
      AbortSignal.timeout(5000),
    ),
  );
});
test('cancellation interrupts an uncooperative decoded stream without accepting a late body', async () => {
  let cancelled = false;
  const controller = new AbortController(),
    response = new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          cancelled = true;
        },
      }),
      {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '12',
        },
      },
    ),
    pending = readBrowserDecodedJson(response, 4096, controller.signal);
  controller.abort();
  await assert.rejects(() => pending);
  await Promise.resolve();
  assert.equal(cancelled, true);
});

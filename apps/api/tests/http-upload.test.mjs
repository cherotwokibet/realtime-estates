import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import test from 'node:test';
import { AuthenticationError, parseBearerHeader } from '../dist/auth.js';
import { createDevelopmentServer } from '../dist/http.js';

const LISTING = '00000000-0000-4000-8000-000000000400';
const JOB = '00000000-0000-4000-8000-000000000500';
const UPLOAD = '00000000-0000-4000-8000-000000000600';
const PATH = `/v2/staff/listings/${LISTING}/revisions/1/media-jobs/${JOB}/uploads/${UPLOAD}`;
async function timely(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Socket operation did not settle.')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function withServer(
  uploadHandler,
  run,
  handler = async () => new Response('ordinary', { status: 202 }),
  clients = new WeakMap(),
) {
  const server = createDevelopmentServer(handler, clients, uploadHandler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await run(server.address().port, server);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
function message(
  port,
  path = PATH,
  { method = 'PUT', headers = [], body = Buffer.alloc(0), length = body.length, close = true } = {},
) {
  return Buffer.concat([
    Buffer.from(
      `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${close ? 'Connection: close\r\n' : ''}${length === undefined ? '' : `Content-Length: ${length}\r\n`}${headers.join('\r\n')}${headers.length ? '\r\n' : ''}\r\n`,
    ),
    body,
  ]);
}
async function exchange(port, bytes) {
  let socket;
  try {
    return await timely(
      new Promise((resolve, reject) => {
        const received = [];
        socket = connect({ host: '127.0.0.1', port }, () => socket.write(bytes));
        socket.on('data', (chunk) => received.push(chunk));
        socket.once('error', reject);
        socket.once('end', () => resolve(Buffer.concat(received).toString('latin1')));
      }),
    );
  } finally {
    socket?.destroy();
  }
}
function status(raw) {
  return Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);
}
function responseBody(raw) {
  const boundary = raw.indexOf('\r\n\r\n'),
    headers = raw.slice(0, boundary),
    body = raw.slice(boundary + 4);
  if (!/transfer-encoding: chunked/i.test(headers)) return body;
  const chunks = [];
  let offset = 0;
  for (;;) {
    const end = body.indexOf('\r\n', offset);
    assert.ok(end >= offset, 'chunk size is present');
    const size = Number.parseInt(body.slice(offset, end), 16);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    if (size === 0) return chunks.join('');
    offset = end + 2;
    chunks.push(body.slice(offset, offset + size));
    offset += size;
    assert.equal(body.slice(offset, offset + 2), '\r\n');
    offset += 2;
  }
}

test('upload hook receives headers and socket context before the client sends or ends its declared body', async () => {
  let ordinaryCalls = 0,
    uploadCalls = 0;
  const clients = new WeakMap();
  await withServer(
    async (request, _source) => {
      uploadCalls++;
      assert.equal(request.body, null);
      assert.equal(request.bodyUsed, false);
      assert.equal(request.headers.get('content-length'), String(1024 * 1024));
      assert.equal(clients.get(request), '127.0.0.1');
      assert.equal(request.headers.get('x-forwarded-for'), 'attacker-selected');
      return new Response('synthetic authorization denied', { status: 401 });
    },
    async (port) => {
      // Only headers are written. The socket stays writable; no request end/body follows.
      const raw = await exchange(
        port,
        message(port, PATH, {
          length: 1024 * 1024,
          close: false,
          headers: ['X-Forwarded-For: attacker-selected'],
        }),
      );
      assert.equal(status(raw), 401);
      assert.match(raw, /connection: close/i);
      assert.match(responseBody(raw), /synthetic authorization denied/);
      assert.equal(uploadCalls, 1);
      assert.equal(ordinaryCalls, 0);
    },
    async () => {
      ordinaryCalls++;
      return new Response('unexpected');
    },
    clients,
  );
});

test('only exact raw upload paths and GET or PUT methods reach the streaming hook', async () => {
  let hookCalls = 0,
    ordinaryCalls = 0;
  await withServer(
    async (request) => {
      hookCalls++;
      assert.equal(request.body, null);
      return new Response('hook', { status: 209 });
    },
    async (port) => {
      for (const [method, path] of [
        ['GET', PATH],
        ['PUT', PATH],
        ['PUT', PATH.replace('/revisions/1/', '/revisions/2147483647/')],
      ]) {
        assert.equal(
          status(await exchange(port, message(port, path, { method }))),
          209,
          `${method} ${path}`,
        );
      }
      const accepted = hookCalls;
      for (const [method, path] of [
        ['POST', PATH],
        ['HEAD', PATH],
        ['OPTIONS', PATH],
        ['PATCH', PATH],
        ['PUT', PATH + '/'],
        ['PUT', PATH + '?x=1'],
        ['PUT', PATH + '?'],
        ['PUT', PATH + '#fragment'],
        ['PUT', PATH.replace('/v2/', '/V2/')],
        ['PUT', PATH.replace('/revisions/1/', '/revisions/01/')],
        ['PUT', PATH.replace('/revisions/1/', '/revisions/0/')],
        ['PUT', PATH.replace('/revisions/1/', '/revisions/2147483648/')],
        ['PUT', PATH.replace('/revisions/1/', '/revisions/1/./')],
        ['PUT', '/prefix/..' + PATH],
        ['PUT', PATH.replace('/media-jobs/', '/media%2Djobs/')],
        ['PUT', PATH.replace(LISTING, 'invalid')],
        ['PUT', PATH.replace(LISTING, LISTING.replace('-4000-', '-0000-'))],
        ['PUT', `http://127.0.0.1:${port}${PATH}`],
      ]) {
        assert.equal(
          status(await exchange(port, message(port, path, { method }))),
          202,
          `${method} ${path}`,
        );
        assert.equal(hookCalls, accepted, `${method} ${path} must not enter the hook`);
      }
      assert.equal(accepted, 3);
      assert.equal(ordinaryCalls, 18);
    },
    async () => {
      ordinaryCalls++;
      return new Response('ordinary', { status: 202 });
    },
  );
});

test('the hook lazily receives binary bytes beyond the ordinary JSON cap without attaching them to Request', async () => {
  const payload = Buffer.alloc(96 * 1024, 173);
  let hookCalls = 0;
  await withServer(
    async (request, source) => {
      hookCalls++;
      assert.equal(request.body, null);
      assert.equal(request.bodyUsed, false);
      const hash = createHash('sha256');
      let length = 0;
      for await (const chunk of source) {
        assert.ok(chunk instanceof Uint8Array);
        length += chunk.length;
        hash.update(chunk);
      }
      assert.equal(request.body, null);
      assert.equal(request.bodyUsed, false);
      return new Response(JSON.stringify({ length, hash: hash.digest('hex') }));
    },
    async (port) => {
      const raw = await exchange(
        port,
        message(port, PATH, { body: payload, headers: ['Content-Type: application/octet-stream'] }),
      );
      assert.equal(status(raw), 200);
      assert.deepEqual(JSON.parse(responseBody(raw)), {
        length: payload.length,
        hash: createHash('sha256').update(payload).digest('hex'),
      });
      assert.equal(hookCalls, 1);
    },
  );
});

test('returning from a partially consumed upload iterator permits the denial response before closing the unread body', async () => {
  let received = 0;
  await withServer(
    async (_request, source) => {
      for await (const chunk of source) {
        received += chunk.length;
        break;
      }
      return new Response('synthetic body refused', { status: 422 });
    },
    async (port) => {
      const raw = await exchange(
        port,
        message(port, PATH, { length: 1024, body: Buffer.from([7]), close: false }),
      );
      assert.equal(status(raw), 422);
      assert.match(responseBody(raw), /synthetic body refused/);
      assert.equal(received, 1);
      assert.match(raw, /connection: close/i);
    },
  );
});

test('installing the hook preserves the general 64-KiB and exact draft 128-KiB body caps', async () => {
  let hookCalls = 0,
    ordinaryCalls = 0;
  const draft = `/v2/staff/listings/${LISTING}/drafts/1`;
  await withServer(
    async () => {
      hookCalls++;
      return new Response('unexpected');
    },
    async (port) => {
      const allowed = await exchange(
        port,
        message(port, '/v1/enquiries', { method: 'POST', body: Buffer.alloc(64 * 1024, 120) }),
      );
      assert.equal(status(allowed), 200);
      assert.equal(responseBody(allowed), String(64 * 1024));
      for (const path of ['/v1/enquiries', PATH + '?untrusted=1']) {
        const rejected = await exchange(
          port,
          message(port, path, { body: Buffer.alloc(64 * 1024 + 1, 120) }),
        );
        assert.equal(status(rejected), 413);
      }
      const larger = await exchange(
        port,
        message(port, draft, { body: Buffer.alloc(128 * 1024, 120) }),
      );
      assert.equal(status(larger), 200);
      assert.equal(responseBody(larger), String(128 * 1024));
      assert.equal(
        status(
          await exchange(port, message(port, draft, { body: Buffer.alloc(128 * 1024 + 1, 120) })),
        ),
        413,
      );
      assert.equal(hookCalls, 0);
      assert.equal(ordinaryCalls, 2);
    },
    async (request) => {
      ordinaryCalls++;
      return new Response(String((await request.arrayBuffer()).byteLength));
    },
  );
});

test('raw duplicate authorization values remain ambiguous for the actual bearer parser', async () => {
  const seen = [];
  await withServer(
    async (request, _source) => {
      const header = request.headers.get('authorization');
      seen.push(header);
      assert.throws(() => parseBearerHeader(header ?? undefined), AuthenticationError);
      return new Response('denied', { status: 401 });
    },
    async (port) => {
      for (const headers of [
        ['Authorization: Bearer a.b.c', 'authorization: Bearer d.e.f'],
        ['Authorization: Bearer a.b.c', 'authorization:'],
      ]) {
        const raw = await exchange(
          port,
          message(port, PATH, { headers, length: 100, close: false }),
        );
        assert.equal(status(raw), 401);
      }
      assert.equal(seen[0], 'Bearer a.b.c, Bearer d.e.f');
      assert.match(seen[1], /,/);
    },
  );
});

test('ambiguous Host headers are rejected before either handler', async () => {
  let calls = 0;
  await withServer(
    async () => {
      calls++;
      return new Response('unexpected');
    },
    async (port) => {
      const raw = await exchange(
        port,
        message(port, PATH, { headers: ['Host: other.example.test'] }),
      );
      assert.equal(status(raw), 400);
      assert.equal(calls, 0);
    },
    async () => {
      calls++;
      return new Response('unexpected');
    },
  );
});

test('client interruption aborts the headers-only Request for incomplete PUT and complete GET requests', async () => {
  for (const method of ['PUT', 'GET']) {
    let started, observed;
    const entered = new Promise((resolve) => {
        started = resolve;
      }),
      aborted = new Promise((resolve) => {
        observed = resolve;
      });
    await withServer(
      async (request) => {
        assert.equal(request.signal.aborted, false);
        started(request);
        await new Promise((resolve) =>
          request.signal.addEventListener(
            'abort',
            () => {
              observed(request.signal.aborted);
              resolve();
            },
            { once: true },
          ),
        );
        return new Response('interrupted', { status: 400 });
      },
      async (port) => {
        const socket = connect({ host: '127.0.0.1', port }, () =>
          socket.write(
            message(port, PATH, { method, length: method === 'PUT' ? 10 : 0, close: false }),
          ),
        );
        socket.on('error', () => undefined);
        try {
          const request = await timely(entered);
          socket.destroy();
          assert.equal(await timely(aborted), true);
          assert.equal(request.signal.aborted, true);
        } finally {
          socket.destroy();
        }
      },
    );
  }
});

test('upload Expect headers receive 417 without an interim 100 or hook/body admission', async () => {
  let calls = 0;
  await withServer(
    async () => {
      calls++;
      return new Response('unexpected');
    },
    async (port) => {
      for (const expectation of ['100-continue', 'unsupported-expectation']) {
        const raw = await exchange(
          port,
          message(port, PATH, {
            length: 1024 * 1024,
            close: false,
            headers: [`Expect: ${expectation}`],
          }),
        );
        assert.equal(status(raw), 417);
        assert.doesNotMatch(raw, /HTTP\/1\.1 100 /);
        assert.equal(calls, 0);
      }
    },
  );
});

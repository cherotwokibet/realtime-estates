import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createDevelopmentServer } from '../dist/http.js';

test('only exact creation, successor and reference draft POST receive bounded 128KiB transport allowance', async () => {
  let calls = 0;
  const server = createDevelopmentServer(async (r) => {
    calls++;
    return new Response(String((await r.arrayBuffer()).byteLength));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`,
    path =
      '/v2/staff/listings/00000000-0000-4000-8000-000000000003/creation-operations/00000000-0000-4000-8000-000000000004',
    body = '界'.repeat(43690) + 'xx';
  try {
    for (const operationPath of [
      path,
      path.replace('/creation-operations/', '/revision-operations/'),
      path.replace('/v2/', '/v3/').replace('/creation-operations/', '/reference-draft-operations/'),
    ]) {
      assert.equal((await fetch(origin + operationPath, { method: 'POST', body })).status, 200);
      for (const [method, p] of [
        ['PUT', operationPath],
        ['POST', operationPath + '?x=1'],
        ['POST', operationPath + '/'],
        ['POST', operationPath.replace('000000000004', 'invalid')],
      ])
        assert.equal((await fetch(origin + p, { method, body })).status, 413);
      assert.equal(
        (await fetch(origin + operationPath, { method: 'POST', body: 'x'.repeat(128 * 1024 + 1) }))
          .status,
        413,
      );
    }
    assert.equal(calls, 3);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('HTTP bridge derives client address from socket and preserves ambiguous authorization for rejection', async () => {
  const clients = new WeakMap();
  const server = createDevelopmentServer(
    async (request) =>
      new Response(
        JSON.stringify({
          authorization: request.headers.get('authorization'),
          client: clients.get(request),
          body: await request.json(),
        }),
      ),
    clients,
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/enquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': 'attacker-selected',
        Authorization: 'Bearer one, Bearer two',
      },
      body: JSON.stringify({ message: 'synthetic' }),
    });
    const result = await response.json();
    assert.equal(result.authorization, 'Bearer one, Bearer two');
    assert.equal(result.client, '127.0.0.1');
    assert.deepEqual(result.body, { message: 'synthetic' });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('HTTP bridge caps received bodies before application handler', async () => {
  let calls = 0;
  const server = createDevelopmentServer(async () => {
    calls++;
    return new Response('unexpected');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/enquiries`, {
      method: 'POST',
      body: 'x'.repeat(65537),
    });
    assert.equal(response.status, 413);
    assert.equal(calls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('only exact v2 draft PUTs receive the larger UTF-8 body allowance', async () => {
  let calls = 0;
  const server = createDevelopmentServer(async (request) => {
    calls++;
    return new Response(String((await request.arrayBuffer()).byteLength));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = '/v2/staff/listings/00000000-0000-4000-8000-000000000400/drafts/1';
  try {
    const body = '界'.repeat(30000);
    assert.equal(Buffer.byteLength(body), 90000);
    const accepted = await fetch(origin + path, { method: 'PUT', body });
    assert.equal(accepted.status, 200);
    assert.equal(await accepted.text(), '90000');
    assert.equal(calls, 1);
    const exactBoundary = await fetch(origin + path, {
      method: 'PUT',
      body: 'x'.repeat(128 * 1024),
    });
    assert.equal(exactBoundary.status, 200);
    assert.equal(await exactBoundary.text(), String(128 * 1024));
    assert.equal(calls, 2);
    for (const [method, rejectedPath] of [
      ['PUT', path.replace('/v2/', '/v1/')],
      ['POST', path],
      ['POST', path + '/submit'],
      ['PUT', path + '/submit'],
      ['PUT', path + '/'],
      ['PUT', path + '?tenantId=untrusted'],
      ['PUT', path.replace('/v2/', '/V2/')],
      ['PUT', path.replace('/drafts/1', '/drafts/01')],
      ['PUT', path.replace('/drafts/1', '/drafts/2147483648')],
      ['PUT', path.replace('000000000400', 'invalid')],
    ]) {
      const response = await fetch(origin + rejectedPath, { method, body });
      assert.equal(response.status, 413, `${method} ${rejectedPath}`);
      assert.equal(calls, 2);
    }
    const tooLarge = await fetch(origin + path, {
      method: 'PUT',
      body: 'x'.repeat(128 * 1024 + 1),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(calls, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('v2 draft body limit also applies to chunked requests without Content-Length', async () => {
  let calls = 0;
  const server = createDevelopmentServer(async (request) => {
    calls++;
    return new Response(String((await request.arrayBuffer()).byteLength));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v2/staff/listings/00000000-0000-4000-8000-000000000400/drafts/1`;
  const send = (length) =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        url,
        { method: 'PUT', headers: { 'Transfer-Encoding': 'chunked' } },
        (incoming) => {
          const chunks = [];
          incoming.on('data', (chunk) => chunks.push(chunk));
          incoming.once('end', () =>
            resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      outgoing.once('error', reject);
      for (let sent = 0; sent < length; sent += 16384)
        outgoing.write('x'.repeat(Math.min(16384, length - sent)));
      outgoing.end();
    });
  try {
    assert.deepEqual(await send(128 * 1024), { status: 200, body: String(128 * 1024) });
    assert.equal(calls, 1);
    const rejected = await send(128 * 1024 + 1);
    assert.equal(rejected.status, 413);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

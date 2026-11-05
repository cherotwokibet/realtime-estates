import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createDevelopmentServer } from '../dist/http.js';
import { createIdentityVerifier, parseBearerHeader } from '../dist/auth.js';
import { setup, id } from './floor-plan-api-fixture.mjs';
import {
  asActor,
  scalar,
  T,
  AGENT,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
import { convertSyntheticFloorPlan } from '../../../packages/media/dist/index.js';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const command = {
  policy: 'synthetic-floor-plan-preparation-command-v1',
  listingId: LISTING,
  revision: 1,
  expectedVersion: '2',
  requestId: id(2400),
};
const path = `/v2/staff/listings/${LISTING}/floor-plan-inputs/1/2/${command.requestId}`;
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
async function fixture(t, settings = {}) {
  const f = await setup(t),
    keys = await generateKeyPair('RS256'),
    jwks = JSON.stringify({
      keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'floor-http', alg: 'RS256' }],
    });
  const auth = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(jwks);
  });
  const issuer = await listen(auth);
  t.after(() => close(auth));
  const verify = createIdentityVerifier({
    issuer,
    audience: 'synthetic-floor-http',
    jwksUrl: issuer + '/jwks',
    allowLoopbackHttpForTests: true,
  });
  const sign = async (actor = AGENT, key = keys.privateKey) =>
    new SignJWT({ role: 'admin', tenant_id: id(999) })
      .setProtectedHeader({ alg: 'RS256', kid: 'floor-http', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('synthetic-floor-http')
      .setSubject(actor)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  const calls = { iterations: 0, prepare: 0, recover: 0, ordinary: 0 };
  let original;
  const service = f.open({
    verifyAuthorization: (request) =>
      verify(parseBearerHeader(request.headers.get('authorization') ?? undefined)),
    floorPlanImageRead: f.image,
    floorPlanPreparation: {
      ...(settings.bodyTimeoutMs ? { bodyTimeoutMs: settings.bodyTimeoutMs } : {}),
      prepare: async (ctx, c, source) => {
        calls.prepare++;
        assert.equal(ctx.tenantId, T);
        assert.equal(ctx.actorId, AGENT);
        const converted = await convertSyntheticFloorPlan(source);
        await asActor(f.db, ctx.tenantId, ctx.actorId, () =>
          scalar(f.db, 'SELECT app_api.register_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7)', [
            c.listingId,
            c.revision,
            Number(c.expectedVersion),
            c.requestId,
            createHash('sha256').update(source).digest('hex'),
            source.length,
            'png',
          ]),
        );
        original = {
          ...c,
          policy: 'synthetic-floor-plan-prepared-v1',
          width: converted.manifest.width,
          height: converted.manifest.height,
          bytes: converted.manifest.bytes,
          sha256: converted.manifest.sha256,
        };
        return { state: 'prepared', prepared: original };
      },
      recover: async () => {
        calls.recover++;
        return { state: 'prepared', prepared: original };
      },
    },
  });
  const server = createDevelopmentServer(
    async (r) => {
      calls.ordinary++;
      return service(r);
    },
    new WeakMap(),
    undefined,
    undefined,
    (r, source) =>
      service(r, {
        async *[Symbol.asyncIterator]() {
          calls.iterations++;
          yield* source;
        },
      }),
  );
  const origin = await listen(server);
  t.after(() => close(server));
  return { ...f, calls, service, server, origin, sign, keys };
}
async function raw(origin, target = path, headers = [], settings = {}) {
  const port = new URL(origin).port;
  let socket, timer;
  try {
    return await Promise.race([
      new Promise((resolve, reject) => {
        const chunks = [];
        socket = connect({ host: '127.0.0.1', port: Number(port) }, () =>
          socket.write(
            `${settings.method ?? 'PUT'} ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n${settings.binaryType === false ? '' : 'Content-Type: application/octet-stream\r\n'}${settings.length === false ? '' : `Content-Length: ${settings.length ?? 100000}\r\n`}${headers.join('\r\n')}${headers.length ? '\r\n' : ''}\r\n`,
          ),
        );
        socket.on('data', (x) => chunks.push(x));
        socket.once('error', reject);
        socket.once('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Headers-only denial stalled')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    socket?.destroy();
  }
}
const status = (wire) => Number(/^HTTP\/1\.1 (\d{3})/.exec(wire)?.[1]);
test('signed listening HTTP accepts real synthetic PNG larger than64KiB and GET recovery never reads or resends source', async (t) => {
  const f = await fixture(t);
  let seed = 123;
  const source = syntheticPng(256, 256, () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return [seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255];
  });
  assert.ok(source.length > 65536);
  assert.ok(source.length < 10485760);
  const api = new RealtorApiClient({
      baseUrl: f.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic',
    }),
    options = { bearerToken: await f.sign() };
  const result = await api.prepareFloorPlan(command, source, options);
  assert.equal(result.width, 256);
  assert.equal(result.requestId, command.requestId);
  assert.deepEqual(await api.getFloorPlanPreparationOriginal(command, options), result);
  assert.equal(f.calls.iterations, 1);
  assert.equal(f.calls.prepare, 1);
  assert.equal(f.calls.recover, 1);
  const ordinary = await fetch(f.origin + '/unrelated', {
    method: 'POST',
    body: Buffer.alloc(65537),
  });
  assert.equal(ordinary.status, 413);
  // A separate already-sealed fixture output proves image framing on the same socket bridge.
  const attach = {
    policy: 'synthetic-floor-plan-attachment-command-v1',
    operationId: id(1800),
    listingId: LISTING,
    revision: 1,
    expectedVersion: '2',
    requestId: id(1801),
  };
  await api.saveFloorPlanAttachment(attach, options);
  const image = await fetch(
    f.origin + `/v2/staff/listings/${LISTING}/floor-plan-images/1/${attach.operationId}`,
    { headers: { authorization: 'Bearer ' + options.bearerToken } },
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), f.result.data);
  assert.equal(f.calls.iterations, 1);
});
test('signed authorization and stale draft refusal finish from headers before source iteration or preparation', async (t) => {
  const f = await fixture(t),
    signed = await f.sign(),
    wrong = (await generateKeyPair('RS256')).privateKey;
  for (const [token, target, expected] of [
    [null, path, 401],
    [await f.sign(AGENT, wrong), path, 401],
    [await f.sign(id(13)), path, 403],
    [signed, path.replace('/1/2/', '/1/1/'), 409],
  ]) {
    const response = await raw(f.origin, target, token ? ['Authorization: Bearer ' + token] : []);
    assert.equal(status(response), expected);
    assert.doesNotMatch(response, /100 Continue/);
  }
  assert.equal(f.calls.iterations, 0);
  assert.equal(f.calls.prepare, 0);
});
test('raw aliases and Expect never receive100 or enter ordinary/body handlers', async (t) => {
  const f = await fixture(t),
    token = await f.sign();
  for (const alias of [
    path + '?x=1',
    '/prefix/..' + path,
    path.replace('floor-plan-inputs', 'floor%2dplan-inputs'),
    f.origin + path,
    path.replace('/1/2/', '/01/2/'),
  ]) {
    const response = await raw(f.origin, alias, ['Authorization: Bearer ' + token]);
    assert.equal(status(response), 404);
    assert.doesNotMatch(response, /100 Continue/);
  }
  for (const expectation of ['100-continue', 'unsupported']) {
    const response = await raw(f.origin, path, [
      'Authorization: Bearer ' + token,
      'Expect: ' + expectation,
    ]);
    assert.equal(status(response), 417);
    assert.doesNotMatch(response, /100 Continue/);
  }
  assert.equal(f.calls.ordinary, 0);
  assert.equal(f.calls.iterations, 0);
  assert.equal(f.calls.prepare, 0);
});

test('GET body framing and oversized declarations refuse without reading socket bytes', async (t) => {
  const f = await fixture(t),
    authorization = 'Authorization: Bearer ' + (await f.sign());
  const imagePath = `/v2/staff/listings/${LISTING}/floor-plan-images/1/${id(1800)}`;
  for (const target of [path, imagePath]) {
    assert.equal(
      status(
        await raw(f.origin, target, [authorization], {
          method: 'GET',
          binaryType: false,
          length: 0,
        }),
      ),
      400,
    );
    assert.equal(
      status(
        await raw(f.origin, target, [authorization, 'Transfer-Encoding: chunked'], {
          method: 'GET',
          binaryType: false,
          length: false,
        }),
      ),
      400,
    );
  }
  assert.equal(status(await raw(f.origin, path, [authorization], { length: 10485761 })), 413);
  assert.equal(f.calls.iterations, 0);
  assert.equal(f.calls.prepare, 0);
  assert.equal(f.calls.image, undefined);
});
test('authorized stalled source times out and releases the preparation guard for a later request', async (t) => {
  const f = await fixture(t, { bodyTimeoutMs: 30 }),
    token = await f.sign();
  assert.equal(status(await raw(f.origin, path, ['Authorization: Bearer ' + token])), 408);
  assert.equal(f.calls.iterations, 1);
  assert.equal(f.calls.prepare, 0);
  const api = new RealtorApiClient({
    baseUrl: f.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic',
  });
  assert.equal(
    (await api.prepareFloorPlan(command, syntheticPng(), { bearerToken: token })).requestId,
    command.requestId,
  );
  assert.equal(f.calls.prepare, 1);
  assert.equal(f.calls.iterations, 2);
});

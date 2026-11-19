import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createCloudRunInvocationTransport,
  readCloudRunInvocationEnvironment,
} from '../dist/cloud-run-invocation.js';
const audience = 'https://synthetic-api-123456.africa-south1.run.app';
const config = { policy: 'cloud-run-invocation-v1', audience };
const env = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  K_SERVICE: 'synthetic-web',
  GOOGLE_CLOUD_PROJECT: 'realtor-synthetic-staging',
  HOSTED_API_INVOCATION_CONFIG: JSON.stringify(config),
};
const headers = { authorization: 'Bearer firebase.user.signature' };
const service = 'Bearer google.workload.signature';
const url = audience + '/v2/customer/account';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test('private invocation requires explicit attached staging identity and a fixed canonical service audience', () => {
  assert.deepEqual(
    readCloudRunInvocationEnvironment(env, audience, env.GOOGLE_CLOUD_PROJECT),
    config,
  );
  assert.equal(
    readCloudRunInvocationEnvironment({}, 'https://synthetic-api.example', 'example-project'),
    null,
  );
  assert.throws(() => readCloudRunInvocationEnvironment({}, audience, env.GOOGLE_CLOUD_PROJECT));
  for (const bad of [
    { NODE_ENV: 'test' },
    { APP_ENV: 'production' },
    { K_SERVICE: '' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'synthetic.json' },
    { GOOGLE_CLOUD_PROJECT: 'other-project' },
    { HOSTED_API_INVOCATION_CONFIG: JSON.stringify({ ...config, token: 'secret' }) },
    { HOSTED_API_INVOCATION_CONFIG: JSON.stringify({ ...config, audience: audience + '/' }) },
    { HOSTED_API_INVOCATION_CONFIG: JSON.stringify({ ...config, policy: 'none' }) },
  ])
    assert.throws(() =>
      readCloudRunInvocationEnvironment({ ...env, ...bad }, audience, env.GOOGLE_CLOUD_PROJECT),
    );
  for (const target of [
    'http://synthetic.run.app',
    'https://synthetic.example',
    'https://synthetic.run.app:444',
    'https://synthetic.run.app/path',
    'https://synthetic.run.app?x=1',
  ])
    assert.throws(() => createCloudRunInvocationTransport({ ...config, audience: target }));
  assert.doesNotThrow(() =>
    createCloudRunInvocationTransport({
      ...config,
      audience: 'https://synthetic-old-uc.a.run.app',
    }),
  );
});
test('concurrent callers share lazy workload client/token acquisition and preserve independent Firebase authority', async () => {
  let clients = 0,
    tokens = 0,
    calls = 0;
  const ready = deferred();
  const transport = createCloudRunInvocationTransport(config, {
    client: async (a) => {
      clients++;
      assert.equal(a, audience);
      return {
        getRequestHeaders: async () => {
          tokens++;
          await ready.promise;
          return new Headers({ authorization: service });
        },
      };
    },
    transport: async (r) => {
      calls++;
      assert.equal(r.headers.get('authorization'), 'Bearer firebase.user.signature');
      assert.equal(r.headers.get('x-serverless-authorization'), service);
      assert.equal(r.redirect, 'error');
      assert.equal(r.credentials, 'omit');
      assert.equal(r.cache, 'no-store');
      assert.equal(r.referrerPolicy, 'no-referrer');
      return Response.json({ ok: true });
    },
  });
  assert.equal(clients, 0);
  const first = transport(url, { headers }),
    second = transport(url, { headers });
  ready.resolve();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(clients, 1);
  assert.equal(tokens, 1);
  assert.equal(calls, 2);
  await transport(url, { headers });
  assert.equal(clients, 1);
  assert.equal(tokens, 2); // SDK owns expiry/refresh cache.
});
test('wrong targets, caller service credentials and missing Firebase bearer refuse before Google/network access', async () => {
  let used = 0;
  const t = createCloudRunInvocationTransport(config, {
    client: async () => {
      used++;
      throw Error('must not run');
    },
    transport: async () => {
      used++;
      throw Error('must not run');
    },
  });
  for (const [target, options] of [
    ['https://other.run.app/v2/customer/account', { headers }],
    [audience + '/healthz', { headers }],
    [url + '#fragment', { headers }],
    [url, { headers: { ...headers, 'x-serverless-authorization': service } }],
    [url, { headers: { cookie: 'secret', ...headers } }],
    [url, { headers: { authorization: 'Bearer opaque' } }],
    [url, { headers, method: 'DELETE' }],
    [url, {}],
  ])
    await assert.rejects(t(target, options), /^Error: Private API unavailable\.$/);
  assert.equal(used, 0);
});
test('workload token errors/invalid tokens never fall back or send an application request', async () => {
  for (const failure of ['throw', 'missing', 'malformed', 'large']) {
    let sent = 0;
    const t = createCloudRunInvocationTransport(config, {
      client: async () => ({
        getRequestHeaders: async () => {
          if (failure === 'throw') throw Error('synthetic-secret-provider-diagnostic');
          return new Headers(
            failure === 'missing'
              ? {}
              : {
                  authorization:
                    failure === 'large' ? 'Bearer ' + 'x'.repeat(17000) : 'Bearer invalid',
                },
          );
        },
      }),
      transport: async () => {
        sent++;
        return Response.json({});
      },
    });
    await assert.rejects(t(url, { headers }), /^Error: Private API unavailable\.$/);
    assert.equal(sent, 0);
  }
});
test('failed client initialization can recover on a later explicit call without replaying the failed call', async () => {
  let clients = 0,
    sent = 0;
  const t = createCloudRunInvocationTransport(config, {
    client: async () => {
      if (++clients === 1) throw Error('provider unavailable');
      return { getRequestHeaders: async () => new Headers({ authorization: service }) };
    },
    transport: async () => {
      sent++;
      return Response.json({});
    },
  });
  await assert.rejects(t(url, { headers }));
  assert.equal(sent, 0);
  await t(url, { headers });
  assert.equal(clients, 2);
  assert.equal(sent, 1);
});
test('cancellation/deadline while acquiring service identity cannot send a delayed application request', async () => {
  for (const mode of ['cancel', 'timeout', 'already-aborted']) {
    let sent = 0;
    const token = deferred(),
      controller = new AbortController();
    const t = createCloudRunInvocationTransport(config, {
      timeoutMs: 20,
      client: async () => ({
        getRequestHeaders: async () => {
          await token.promise;
          return new Headers({ authorization: service });
        },
      }),
      transport: async () => {
        sent++;
        return Response.json({});
      },
    });
    if (mode === 'already-aborted') controller.abort();
    const pending = t(url, { headers, signal: controller.signal });
    if (mode === 'cancel') controller.abort();
    await assert.rejects(pending, /Private API unavailable/);
    token.resolve();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(sent, 0);
  }
});
test('redirects and uncertain POST acknowledgements cannot trigger automatic replays or leak either token', async () => {
  for (const outcome of ['redirect', 'lost', 'cross-origin']) {
    let calls = 0;
    const t = createCloudRunInvocationTransport(config, {
      client: async () => ({
        getRequestHeaders: async () => new Headers({ authorization: service }),
      }),
      transport: async () => {
        calls++;
        if (outcome === 'lost') throw Error('synthetic lost acknowledgement with secret');
        if (outcome === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { location: 'https://other.example' },
          });
        const r = Response.json({});
        Object.defineProperty(r, 'url', { value: 'https://other.example' });
        return r;
      },
    });
    await assert.rejects(
      t(audience + '/v2/customer/favourites', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
      }),
      /^Error: Private API unavailable\.$/,
    );
    assert.equal(calls, 1);
  }
});
test('real loopback HTTP receives separate service/user credentials and a committed lost POST stays single', async () => {
  let writes = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer firebase.user.signature');
    assert.equal(req.headers['x-serverless-authorization'], service);
    if (req.method === 'POST') {
      writes++;
      req.resume();
      await once(req, 'end');
      res.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const transport = createCloudRunInvocationTransport(config, {
      client: async () => ({
        getRequestHeaders: async () => new Headers({ authorization: service }),
      }),
      transport: async (r) =>
        fetch('http://127.0.0.1:' + server.address().port + new URL(r.url).pathname, {
          method: r.method,
          headers: r.headers,
          signal: r.signal,
          redirect: r.redirect,
          ...(r.body ? { body: await r.text() } : {}),
        }).then((r) => {
          // Test adapter represents TLS/Cloud Run ingress; real IAM is not exercised.
          Object.defineProperty(r, 'url', { value: '' });
          return r;
        }),
    });
    assert.equal((await transport(url, { headers })).status, 200);
    await assert.rejects(
      transport(audience + '/v2/customer/favourites', { method: 'POST', headers, body: '{}' }),
    );
    assert.equal(writes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

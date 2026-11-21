import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateRecoveryCipher } from '../dist/tests/lib/private-recovery-cipher.js';
import { privateRecoveryRequest } from '../dist/tests/lib/private-recovery-server.js';
import { createPrivateRecoveryClient } from '../dist/tests/lib/private-recovery-client.js';
import { createSealedRecoveryStore } from '../dist/tests/lib/private-recovery-store.js';
import {
  captureRecoveryScope,
  recoveryEnvelope,
  recoveryCommand,
} from '../dist/tests/lib/private-recovery-contract.js';
import {
  POST,
  dynamic,
  runtime,
} from '../dist/tests/app/api/private-workspace/recovery/[kind]/[action]/route.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  scope = { instanceId: id(90), tenantId: id(1), actorId: id(10) },
  key = '0c'.repeat(32);
const settings = {
  policy: 'company-settings-command-v1',
  operationId: id(100),
  expectedVersion: '0',
  approval: 'approved-for-publication',
  content: {
    companyName: 'Synthetic agency',
    summary: 'PRIVATE_RECOVERY_CANARY',
    about: 'Fictional content.',
    officeAddress: null,
    openingHours: null,
    colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
  },
};
const report = {
  policy: 'listing-report-decision-command-v1',
  operationId: id(101),
  reportId: id(200),
  expectedVersion: '1',
  decision: 'reviewed',
  reason: 'PRIVATE_RECOVERY_CANARY',
};
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:49000',
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
  STAFF_PREVIEW_TOKEN: 'synthetic.actor.signature',
  PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
  PRIVATE_RECOVERY_STORAGE_KEY: key,
};
const lease = (patch = {}) => {
  const when = Date.now();
  return {
    policy: 'staff-access-lease-v1',
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    role: 'admin',
    checkedAt: new Date(when).toISOString(),
    expiresAt: new Date(when + 30000).toISOString(),
    ...patch,
  };
};
const request = (kind, action, body, patch = {}) =>
  new Request('http://127.0.0.1:49001/api/private-workspace/recovery/' + kind + '/' + action, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:49001',
      origin: 'http://127.0.0.1:49001',
      'x-preview-instance': scope.instanceId,
      'content-type': 'application/json',
      ...patch,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const memory = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
for (const [kind, command] of [
  ['settings', settings],
  ['report', report],
]) {
  test(
    kind +
      ' cipher preserves normalized original across fresh instances without exposing command/key, with a fresh nonce',
    () => {
      const cipher = createPrivateRecoveryCipher(key),
        sealed = cipher.seal(scope, kind, command),
        next = cipher.seal(scope, kind, command);
      assert.notEqual(sealed.sealed, next.sealed);
      assert.doesNotMatch(
        JSON.stringify(sealed),
        /PRIVATE_RECOVERY_CANARY|signature|companyName|reason/,
      );
      assert.deepEqual(
        createPrivateRecoveryCipher(key).open(scope, kind, sealed),
        recoveryCommand(kind, command),
      );
    },
  );
  test(
    kind +
      ' ciphertext-only store survives disposal and current-authorized reopening; retaining the same original is idempotent',
    async () => {
      const cipher = createPrivateRecoveryCipher(key),
        storage = memory(),
        codec = {
          seal: async (c) => cipher.seal(scope, kind, c),
          open: async (e) => cipher.open(scope, kind, e),
        };
      const store = createSealedRecoveryStore(storage, scope, kind, codec);
      assert.equal(await store.load(), null);
      const sealed = await store.retain(command),
        saved = [...storage.map];
      assert.deepEqual(await store.retain(command), sealed);
      assert.deepEqual([...storage.map], saved);
      assert.deepEqual(await store.load(), recoveryCommand(kind, command));
      assert.ok(!JSON.stringify(saved).includes('PRIVATE_RECOVERY_CANARY'));
      store.dispose();
      await assert.rejects(store.load());
      assert.deepEqual([...storage.map], saved);
      const restored = createSealedRecoveryStore(storage, scope, kind, codec);
      assert.deepEqual(await restored.load(), recoveryCommand(kind, command));
      restored.dispose();
    },
  );
}
test('authenticated envelopes refuse wrong key, IV/tag/ciphertext tamper, metadata substitution, malformed encoding and unbounded inputs', () => {
  const cipher = createPrivateRecoveryCipher(key),
    sealed = cipher.seal(scope, 'report', report);
  for (const offset of [0, 12, 28]) {
    const bytes = Buffer.from(sealed.sealed, 'base64url');
    bytes[offset] ^= 1;
    assert.throws(() =>
      cipher.open(scope, 'report', { ...sealed, sealed: bytes.toString('base64url') }),
    );
  }
  for (const changed of [
    { operationId: id(102) },
    { policy: 'unknown' },
    { kind: 'settings' },
    { scope: { ...scope, actorId: id(11) } },
    { scope: { ...scope, tenantId: id(2) } },
    { scope: { ...scope, instanceId: id(91) } },
    { sealed: sealed.sealed + '=' },
    { sealed: 'a'.repeat(175001) },
    { command: report },
  ])
    assert.throws(() => cipher.open(scope, 'report', { ...sealed, ...changed }));
  assert.throws(() => createPrivateRecoveryCipher('0d'.repeat(32)).open(scope, 'report', sealed));
  for (const bad of ['', '00', undefined, {}])
    assert.throws(() => createPrivateRecoveryCipher(bad));
  assert.throws(() => cipher.seal(scope, 'settings', report));
  let read = 0;
  const bad = { ...scope };
  Object.defineProperty(bad, 'actorId', {
    enumerable: true,
    get() {
      read++;
      return id(10);
    },
  });
  assert.throws(() => captureRecoveryScope(bad));
  assert.equal(read, 0);
});
test('recovery BFF defaults closed, pins same-origin nonce and refuses authority/cookies/duplicates before releasing any plaintext', async () => {
  let calls = 0;
  const api = async (url, init) => {
    calls++;
    assert.equal(new URL(url).pathname, '/v2/staff/session-lease');
    assert.equal(init.headers.Authorization, 'Bearer synthetic.actor.signature');
    return Response.json(lease());
  };
  for (const override of [
    { NODE_ENV: 'production' },
    { PRIVATE_RECOVERY_MODE: undefined },
    { PRIVATE_RECOVERY_STORAGE_KEY: undefined },
    { PRIVATE_RECOVERY_STORAGE_KEY: 'invalid' },
  ])
    assert.equal(
      (
        await privateRecoveryRequest(
          request('settings', 'seal', { scope, command: settings }),
          'settings',
          'seal',
          { ...env, ...override },
          api,
        )
      ).status,
      503,
    );
  assert.equal(calls, 0);
  for (const [headers, status] of [
    [{ 'x-preview-instance': id(91) }, 403],
    [{ origin: 'http://127.0.0.1:1' }, 403],
    [{ authorization: 'Bearer forged' }, 403],
    [{ cookie: 'forged' }, 400],
    [{ 'x-role': 'admin' }, 400],
  ])
    assert.equal(
      (
        await privateRecoveryRequest(
          request('settings', 'seal', { scope, command: settings }, headers),
          'settings',
          'seal',
          env,
          api,
        )
      ).status,
      status,
    );
  assert.equal(calls, 0);
  for (const suffix of ['?', '?role=admin', '#fragment']) {
    const base = request('settings', 'seal', { scope, command: settings });
    const bad = new Request(base.url + suffix, {
      method: 'POST',
      headers: base.headers,
      body: JSON.stringify({ scope, command: settings }),
    });
    assert.equal((await privateRecoveryRequest(bad, 'settings', 'seal', env, api)).status, 400);
  }
  assert.equal(calls, 0);
  for (const body of [
    { scope: { ...scope, role: 'admin' }, command: settings },
    { scope: { ...scope, actorId: id(11) }, command: settings },
    { scope, command: { ...settings, unexpected: true } },
    JSON.stringify({ scope, command: settings }).replace('"scope":', '"scope":{},"scope":'),
  ])
    assert.ok(
      (
        await privateRecoveryRequest(
          request('settings', 'seal', body),
          'settings',
          'seal',
          env,
          api,
        )
      ).status >= 400,
    );
  assert.equal(dynamic, 'force-dynamic');
  assert.equal(runtime, 'nodejs');
  assert.equal(typeof POST, 'function');
});
test('BFF rechecks SQL-derived role/actor after a body read and does not decrypt on denied, expired or changed authority', async () => {
  const cipher = createPrivateRecoveryCipher(key),
    envelope = cipher.seal(scope, 'report', report);
  for (const replies of [
    [lease({ role: 'agent' })],
    [lease(), lease({ role: 'agent' })],
    [lease(), lease({ actorId: id(11) })],
    [lease(), lease({ tenantId: id(2) })],
  ]) {
    let i = 0;
    const response = await privateRecoveryRequest(
      request('report', 'open', { scope, envelope }),
      'report',
      'open',
      env,
      async () => Response.json(replies[Math.min(i++, replies.length - 1)]),
    );
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /PRIVATE_RECOVERY_CANARY/);
  }
  for (const status of [401, 403, 503]) {
    const response = await privateRecoveryRequest(
      request('report', 'open', { scope, envelope }),
      'report',
      'open',
      env,
      async () => Response.json({ error: 'DENIED' }, { status }),
    );
    assert.equal(response.status, status);
  }
  const api = async () => Response.json(lease());
  const sealed = await privateRecoveryRequest(
    request('report', 'seal', { scope, command: report }),
    'report',
    'seal',
    env,
    api,
  );
  assert.equal(sealed.status, 200);
  assert.match(sealed.headers.get('cache-control'), /no-store/);
  const restored = await privateRecoveryRequest(
    request('report', 'open', { scope, envelope: await sealed.json() }),
    'report',
    'open',
    env,
    api,
  );
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), recoveryCommand('report', report));
});
test('browser recovery client fixes paths, strips credentials and rejects scope/operation/redirect substitution', async () => {
  const cipher = createPrivateRecoveryCipher(key),
    envelope = cipher.seal(scope, 'report', report);
  let seen;
  const client = createPrivateRecoveryClient(scope, 'report', async (path, init) => {
    seen = { path, init };
    return Response.json(envelope);
  });
  assert.deepEqual(await client.seal(report, new AbortController().signal), envelope);
  assert.equal(seen.path, '/api/private-workspace/recovery/report/seal');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(new Headers(seen.init.headers).has('authorization'), false);
  for (const value of [
    { ...envelope, operationId: id(105) },
    { ...envelope, scope: { ...scope, actorId: id(11) } },
    { ...envelope, key },
  ])
    await assert.rejects(
      createPrivateRecoveryClient(scope, 'report', async () => Response.json(value)).seal(
        report,
        new AbortController().signal,
      ),
    );
  for (const url of [
    'http://user:pass@127.0.0.1/api/private-workspace/recovery/report/seal',
    'http://127.0.0.1/api/private-workspace/recovery/report/seal?',
    'http://127.0.0.1/api/private-workspace/recovery/report/seal#fragment',
  ]) {
    const response = Response.json(envelope);
    Object.defineProperty(response, 'url', { value: url });
    await assert.rejects(
      createPrivateRecoveryClient(scope, 'report', async () => response).seal(
        report,
        new AbortController().signal,
      ),
    );
  }
  for (const status of [401, 403])
    await assert.rejects(
      createPrivateRecoveryClient(scope, 'report', async () => new Response(null, { status })).open(
        envelope,
        new AbortController().signal,
      ),
      (e) => e.status === status,
    );
});
test('sealed store refuses replacement, concurrent preparation and failed persistence/readback without a write permission claim', async () => {
  const cipher = createPrivateRecoveryCipher(key),
    storage = memory(),
    codec = {
      seal: async (c) => cipher.seal(scope, 'report', c),
      open: async (e) => cipher.open(scope, 'report', e),
    },
    store = createSealedRecoveryStore(storage, scope, 'report', codec);
  await store.retain(report);
  const saved = [...storage.map];
  await assert.rejects(store.retain({ ...report, reason: 'different original' }));
  assert.deepEqual([...storage.map], saved);
  store.dispose();
  for (const broken of [
    {
      getItem: () => null,
      setItem() {
        throw Error('full');
      },
    },
    { getItem: () => null, setItem() {} },
  ])
    await assert.rejects(createSealedRecoveryStore(broken, scope, 'report', codec).retain(report));
  let release;
  const empty = memory(),
    held = createSealedRecoveryStore(empty, scope, 'report', {
      ...codec,
      seal: () => new Promise((r) => (release = r)),
    });
  const pending = held.retain(report);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(held.retain({ ...report, operationId: id(105) }));
  held.dispose();
  await assert.rejects(pending);
  release(cipher.seal(scope, 'report', report));
  await new Promise((r) => setImmediate(r));
  assert.equal(empty.map.size, 0);
});
test('store abort/denial preserves stored ciphertext and no cached callback can load or replace it', async () => {
  const cipher = createPrivateRecoveryCipher(key),
    storage = memory(),
    codec = {
      seal: async (c) => cipher.seal(scope, 'report', c),
      open: async (e) => cipher.open(scope, 'report', e),
    };
  const base = createSealedRecoveryStore(storage, scope, 'report', codec);
  await base.retain(report);
  base.dispose();
  const saved = [...storage.map];
  let calls = 0,
    closed = 0;
  const denied = createSealedRecoveryStore(
    storage,
    scope,
    'report',
    {
      ...codec,
      open: async () => {
        calls++;
        throw Object.assign(Error('Denied'), { status: 403 });
      },
    },
    () => closed++,
  );
  await assert.rejects(denied.load());
  assert.equal(closed, 1);
  await assert.rejects(denied.load());
  assert.equal(calls, 1);
  assert.deepEqual([...storage.map], saved);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    createSealedRecoveryStore(storage, scope, 'report', codec).load(abort.signal),
  );
  assert.deepEqual([...storage.map], saved);
});

for (const [kind, command] of [
  ['settings', settings],
  ['report', report],
]) {
  test(
    kind +
      ' confirmed release requires complete original, current actor and intact matching ciphertext',
    async () => {
      const cipher = createPrivateRecoveryCipher(key),
        storage = memory(),
        codec = {
          seal: async (c) => cipher.seal(scope, kind, c),
          open: async (e) => cipher.open(scope, kind, e),
        };
      const store = createSealedRecoveryStore(storage, scope, kind, codec);
      await store.retain(command);
      const saved = [...storage.map];
      const receipt =
        kind === 'settings'
          ? {
              version: '1',
              operationId: command.operationId,
              actorId: scope.actorId,
              recordedAt: '2026-11-22T00:00:00.000Z',
              request: command,
            }
          : {
              policy: 'listing-report-decision-receipt-v1',
              operationId: command.operationId,
              reportId: command.reportId,
              version: '2',
              decision: command.decision,
              reason: command.reason,
              actorId: scope.actorId,
              recordedAt: '2026-11-22T00:00:00.000Z',
            };
      for (const bad of [
        { ...receipt, actorId: id(11) },
        { ...receipt, operationId: id(999) },
        kind === 'settings'
          ? {
              ...receipt,
              request: { ...command, content: { ...command.content, summary: 'changed' } },
            }
          : { ...receipt, reason: 'changed' },
        {},
      ]) {
        await assert.rejects(async () => store.releaseConfirmed(command, bad));
        assert.deepEqual([...storage.map], saved);
      }
      assert.deepEqual(await store.releaseConfirmed(command, receipt), receipt);
      assert.equal(storage.map.size, 0);
      store.dispose();
      await assert.rejects(store.releaseConfirmed(command, receipt));
    },
  );
}
test('confirmed release refuses a replacement during current-authorized reopening and preserves the replacement bytes', async () => {
  const cipher = createPrivateRecoveryCipher(key),
    storage = memory();
  let release;
  const codec = {
    seal: async (c) => cipher.seal(scope, 'report', c),
    open: async (e) => new Promise((r) => (release = () => r(cipher.open(scope, 'report', e)))),
  };
  const store = createSealedRecoveryStore(storage, scope, 'report', codec);
  await store.retain(report);
  const receipt = {
    policy: 'listing-report-decision-receipt-v1',
    operationId: report.operationId,
    reportId: report.reportId,
    version: '2',
    decision: report.decision,
    reason: report.reason,
    actorId: scope.actorId,
    recordedAt: '2026-11-22T00:00:00.000Z',
  };
  const pending = store.releaseConfirmed(report, receipt);
  await new Promise((r) => setImmediate(r));
  const slot = [...storage.map.keys()][0],
    replacement = JSON.stringify(cipher.seal(scope, 'report', { ...report, operationId: id(999) }));
  storage.map.set(slot, replacement);
  release();
  await assert.rejects(pending);
  assert.equal(storage.map.get(slot), replacement);
  store.dispose();
});
test('recovery readiness verifies captured scope and key configuration without returning a command or mutation permission', async () => {
  const api = async () => Response.json(lease());
  const result = await privateRecoveryRequest(
    request('settings', 'check', { scope }),
    'settings',
    'check',
    env,
    api,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    policy: 'private-recovery-ready-v1',
    scope,
    kind: 'settings',
  });
  const client = createPrivateRecoveryClient(scope, 'settings', async () =>
    Response.json({ policy: 'private-recovery-ready-v1', scope, kind: 'settings' }),
  );
  await client.check(new AbortController().signal);
  await assert.rejects(
    createPrivateRecoveryClient(scope, 'settings', async () =>
      Response.json({
        policy: 'private-recovery-ready-v1',
        scope: { ...scope, actorId: id(11) },
        kind: 'settings',
      }),
    ).check(new AbortController().signal),
  );
});

test('browser decoded JSON permits standard compression with bounded decoded bytes and rejects wire/framing/duplicate ambiguity', async () => {
  const { readBrowserDecodedJson } = await import('../dist/tests/lib/browser-decoded-json.js');
  const signal = new AbortController().signal;
  for (const encoding of ['gzip', 'br', 'deflate', 'identity']) {
    const text = JSON.stringify({ value: 'x'.repeat(100) });
    const headers = {
      'content-type': 'application/json',
      'content-encoding': encoding,
      'content-length': String(encoding === 'identity' ? text.length : 12),
    };
    assert.deepEqual(await readBrowserDecodedJson(new Response(text, { headers }), 200, signal), {
      value: 'x'.repeat(100),
    });
  }
  for (const [text, extra] of [
    ['{}', { 'content-encoding': 'unknown' }],
    ['{}', { 'content-length': '3' }],
    ['{}', { 'content-length': '01' }],
    ['{"v":1,"v":2}', {}],
    [
      JSON.stringify({ v: 'x'.repeat(1000) }),
      { 'content-encoding': 'gzip', 'content-length': '12' },
    ],
  ])
    await assert.rejects(
      readBrowserDecodedJson(
        new Response(text, { headers: { 'content-type': 'application/json', ...extra } }),
        200,
        signal,
      ),
    );
});

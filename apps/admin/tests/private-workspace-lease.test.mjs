import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateWorkspaceLease } from '../dist/tests/lib/private-workspace-lease.js';
import { readPrivateWorkspaceLease } from '../dist/tests/lib/private-workspace-lease-client.js';
import { privateWorkspaceLeaseRequest } from '../dist/tests/lib/private-workspace-lease-server.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const base = Date.now();
function rig(extra = {}) {
  let time = 0,
    serial = 0,
    calls = 0,
    ready = 0;
  const timers = new Map(),
    closed = [];
  const lease = (patch = {}) => ({
    policy: 'staff-access-lease-v1',
    tenantId: id(1),
    actorId: id(10),
    role: 'admin',
    checkedAt: new Date(base + time).toISOString(),
    expiresAt: new Date(base + time + 30000).toISOString(),
    ...patch,
  });
  const options = {
    scope: { tenantId: id(1), actorId: id(10) },
    read: async () => {
      calls++;
      return lease();
    },
    onReady: () => ready++,
    onClose: (r) => closed.push(r),
    monotonic: () => time,
    wallNow: () => base + time,
    schedule: (fn, delay) => {
      timers.set(++serial, { fn, at: time + delay });
      return serial;
    },
    cancel: (n) => timers.delete(n),
    ...extra,
  };
  const controller = createPrivateWorkspaceLease(options);
  const advance = (ms) => {
    const end = time + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    time = end;
  };
  return {
    controller,
    options,
    lease,
    closed,
    advance,
    timers,
    calls: () => calls,
    ready: () => ready,
    time: () => time,
    setTime: (n) => {
      time = n;
    },
  };
}
test('a fresh lease gates readiness, renews a bounded lifetime and never reopens after expiry', async () => {
  const r = rig({ foreground: () => false });
  assert.equal(r.controller.active, false);
  await r.controller.refresh();
  assert.equal(r.ready(), 1);
  assert.equal(r.controller.active, true);
  r.advance(30000);
  assert.deepEqual(r.closed, ['expired']);
  assert.equal(r.controller.active, false);
  await r.controller.refresh();
  assert.equal(r.calls(), 1);
  assert.equal(r.timers.size, 0);
});
test('active renewal preserves one ready transition while identity or role changes close the old view', async () => {
  const r = rig();
  await r.controller.refresh();
  r.advance(10000);
  await r.controller.refresh();
  assert.equal(r.ready(), 1);
  assert.equal(r.controller.active, true);
  r.options.read = async () => r.lease({ role: 'agent' });
  r.advance(100);
  await r.controller.refresh();
  assert.deepEqual(r.closed, ['access-changed']);
  for (const patch of [{ actorId: id(11) }, { tenantId: id(2) }]) {
    const q = rig();
    q.options.read = async () => q.lease(patch);
    await q.controller.refresh();
    assert.equal(q.ready(), 0);
    assert.deepEqual(q.closed, ['access-changed']);
  }
});
test('a held renewal cannot extend an expired lease, and uncooperative initial reads have a five-second deadline', async () => {
  const r = rig({ foreground: () => false });
  await r.controller.refresh();
  let release, signal;
  r.options.read = (s) => {
    signal = s;
    return new Promise((resolve) => (release = resolve));
  };
  r.advance(29000);
  const pending = r.controller.refresh();
  await Promise.resolve();
  r.advance(1000);
  await pending;
  assert.deepEqual(r.closed, ['expired']);
  assert.equal(signal.aborted, true);
  release(r.lease());
  assert.equal(r.ready(), 1);
  const q = rig({ read: () => new Promise(() => {}) });
  const waiting = q.controller.refresh();
  await Promise.resolve();
  q.advance(5000);
  await waiting;
  assert.deepEqual(q.closed, ['access-unavailable']);
});
test('replayed lease metadata, transport failure and a backwards monotonic clock fail closed', async () => {
  const r = rig();
  const original = r.lease();
  r.options.read = async () => original;
  await r.controller.refresh();
  r.advance(10);
  await r.controller.refresh();
  assert.deepEqual(r.closed, ['access-unavailable']);
  const q = rig({
    read: async () => {
      throw { status: 403 };
    },
  });
  await q.controller.refresh();
  assert.equal(q.ready(), 0);
  assert.equal(q.controller.closed, true);
  const c = rig();
  await c.controller.refresh();
  c.advance(100);
  await c.controller.refresh();
  c.setTime(10);
  await c.controller.refresh();
  assert.deepEqual(c.closed, ['access-unavailable']);
});
test('unmount cancels timers and readers without updating the disposed owner', async () => {
  const r = rig();
  await r.controller.refresh();
  r.controller.dispose();
  await r.controller.refresh();
  assert.deepEqual(r.closed, []);
  assert.equal(r.timers.size, 0);
  assert.equal(r.calls(), 1);
});
test('lease browser reader pins the relative endpoint, omits cookies and rejects false-status or scope-changing responses', async () => {
  const r = rig(),
    access = { profile: 'staff', instanceId: id(90) };
  let seen;
  await readPrivateWorkspaceLease(access, new AbortController().signal, async (path, init) => {
    const when = Date.now();
    seen = { path, init };
    return Response.json(
      r.lease({
        checkedAt: new Date(when).toISOString(),
        expiresAt: new Date(when + 30000).toISOString(),
      }),
    );
  });
  assert.equal(seen.path, '/api/private-workspace/lease/staff');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.cache, 'no-store');
  for (const response of [
    Response.json(r.lease(), { status: 403 }),
    Response.json({ ...r.lease(), token: 'untrusted' }),
  ])
    await assert.rejects(
      readPrivateWorkspaceLease(access, new AbortController().signal, async () => response),
    );
});
test('server lease BFF is default-off, binds fixed nonce/actor/role and never emits bearer credentials', async () => {
  const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:49000',
    STAFF_PREVIEW_INSTANCE: id(90),
    STAFF_PREVIEW_TOKEN: 'synthetic.actor.signature',
  };
  const request = (headers = {}, suffix = '') =>
    new Request('http://127.0.0.1:49001/api/private-workspace/lease/staff' + suffix, {
      headers: { host: '127.0.0.1:49001', 'x-preview-instance': id(90), ...headers },
    });
  let calls = 0;
  const transport = async (url, init) => {
    const when = Date.now();
    calls++;
    assert.equal(new URL(url).pathname, '/v2/staff/session-lease');
    assert.equal(init.headers.Authorization, 'Bearer synthetic.actor.signature');
    return Response.json({
      policy: 'staff-access-lease-v1',
      tenantId: id(1),
      actorId: id(10),
      role: 'admin',
      checkedAt: new Date(when).toISOString(),
      expiresAt: new Date(when + 30000).toISOString(),
    });
  };
  const result = await privateWorkspaceLeaseRequest(request(), 'staff', env, transport);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.doesNotMatch(await result.text(), /synthetic.actor.signature/);
  assert.equal(
    (
      await privateWorkspaceLeaseRequest(
        request(),
        'staff',
        { ...env, NODE_ENV: 'production' },
        transport,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await privateWorkspaceLeaseRequest(
        request({ 'x-preview-instance': id(91) }),
        'staff',
        env,
        transport,
      )
    ).status,
    403,
  );
  assert.equal(
    (await privateWorkspaceLeaseRequest(request({}, '?role=admin'), 'staff', env, transport))
      .status,
    400,
  );
  assert.equal(calls, 1);
});

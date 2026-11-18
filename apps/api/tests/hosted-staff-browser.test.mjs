import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  fixture,
  asActor,
  T,
  OTHER,
  ADMIN,
  AGENT,
} from '../../../database/tests/public-media-fixtures.mjs';
import { createApiService } from '../dist/service.js';
import { createPostgresBrowserIdentityStore } from '../dist/browser-identity-store.js';
import { createFirebaseBrowserIdentity } from '../dist/firebase-browser-identity.js';
import { createStaffOriginals } from '../dist/staff-browser-originals.js';
import { createCustomerOriginals } from '../dist/customer-browser-originals.js';
import { createHostedStaffBrowser } from '../dist/hosted-staff-browser.js';
import { AuthenticationError } from '../dist/auth.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const origin = 'https://synthetic-staff.example',
  apiOrigin = 'https://synthetic-api.example',
  PEER = id(15),
  CUSTOMER = id(13);
const command = (n = 7101) => ({
  policy: 'staff-branch-command-v1',
  operationId: id(n),
  branchId: id(7100),
  expectedVersion: '0',
  name: 'Synthetic northern branch',
  active: true,
  reason: 'Synthetic branch creation.',
});
async function setup() {
  const db = await fixture();
  for (const name of [
    'staff-branches.sql',
    'staff-directory-reads.sql',
    'browser-identity-state.sql',
    'staff-browser-originals.sql',
    'customer-browser-originals.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
    );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [T, PEER],
  );
  const cookies = new Map();
  let bridge,
    bff,
    actor = ADMIN,
    posts = 0,
    mode = 'normal',
    after = async () => {},
    wrongScope = false;
  const tokens = new Map([
    [ADMIN, 'admin.payload.signature'],
    [AGENT, 'agent.payload.signature'],
    [CUSTOMER, 'customer.payload.signature'],
    [PEER, 'peer.payload.signature'],
  ]);
  const api = createApiService({
    tenantId: T,
    privacyNoticeVersion: 'synthetic-staff-v1',
    staffInvitationMode: 'synthetic-capture-only-v1',
    database: { transaction: (ctx, fn) => asActor(db, ctx.tenantId, ctx.actorId, fn) },
    verifyAuthorization: async (r) => {
      const found = [...tokens].find(([, v]) => 'Bearer ' + v === r.headers.get('authorization'));
      if (!found) throw new AuthenticationError();
      return { actorId: found[0] };
    },
  });
  const store = () => createStaffOriginals(db, '05'.repeat(32));
  function restart() {
    bridge = createFirebaseBrowserIdentity(
      { projectId: 'realtor-synthetic-staging', applicationOrigin: origin, tenantId: T },
      createPostgresBrowserIdentityStore(db, '03'.repeat(32)),
      async (token) => {
        const found = [...tokens].find(([, v]) => v === token);
        if (!found) throw Error();
        return { actorId: found[0], expiresAt: Date.now() + 600000 };
      },
    );
    bff = createHostedStaffBrowser(
      {
        applicationOrigin: origin,
        apiOrigin,
        tenantId: T,
        privacyNoticeVersion: 'synthetic-staff-v1',
      },
      {
        handle: (r) => bridge.handle(r),
        authenticateSession: async (r) => {
          try {
            return await bridge.authenticateSession(r);
          } catch {
            throw new AuthenticationError();
          }
        },
      },
      store(),
      async (url, opts) => {
        assert.ok(String(url).startsWith(apiOrigin + '/v2/staff/'));
        if (opts.method === 'POST') {
          posts++;
          if (mode === 'lost-before') throw Error('Synthetic interrupted request');
        }
        if (wrongScope && String(url).endsWith('/session'))
          return Response.json({
            policy: 'current-staff-session-v2',
            tenantId: OTHER,
            actorId: actor,
          });
        const r = await api(new Request(url, opts));
        if (opts.method === 'POST' && mode === 'lost-after') {
          assert.equal(r.status, 200);
          throw Error('Synthetic acknowledgement lost after commit');
        }
        await after(String(url));
        return r;
      },
    );
  }
  const request = (path, body, headers = {}) =>
    new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
        ...(body === undefined
          ? {}
          : { 'content-type': 'application/json', 'x-staff-intent': 'hosted-staff-v1' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  function accept(r) {
    for (const c of r.headers.getSetCookie()) {
      const p = c.split(';')[0],
        at = p.indexOf('=');
      if (p.slice(at + 1)) cookies.set(p.slice(0, at), p.slice(at + 1));
      else cookies.delete(p.slice(0, at));
    }
    return r;
  }
  async function login(a = ADMIN) {
    actor = a;
    const start = accept(await bridge.handle(request('/auth/login', {})));
    assert.equal(start.status, 200);
    const { state } = await start.json();
    const r = accept(
      await bridge.handle(request('/auth/firebase', { state, idToken: tokens.get(a) })),
    );
    assert.equal(r.status, 200);
    return bridge.authenticateSession(request('/api/hosted-staff/session'));
  }
  restart();
  return {
    db,
    store,
    login,
    restart,
    request,
    get bridge() {
      return bridge;
    },
    get bff() {
      return bff;
    },
    get posts() {
      return posts;
    },
    set mode(v) {
      mode = v;
    },
    set after(v) {
      after = v;
    },
    set wrongScope(v) {
      wrongScope = v;
    },
    async call(path, body, csrf) {
      return accept(
        await bff.handle(
          request('/api/hosted-staff/' + path, body, csrf ? { 'x-staff-csrf': csrf } : {}),
        ),
      );
    },
  };
}
test('hosted branch lost acknowledgement survives recreation; original recovery and settlement cause one SQL change', async () => {
  const f = await setup();
  try {
    const s = await f.login(),
      c = command();
    f.mode = 'lost-after';
    assert.equal((await f.call('command', c, s.csrf)).status, 503);
    assert.equal(f.posts, 1);
    f.restart();
    f.mode = 'normal';
    const meta = await (await f.call('session')).json();
    assert.deepEqual(meta.pending, c);
    assert.equal(meta.account.actorId, ADMIN);
    assert.ok(!JSON.stringify(meta).includes('payload.signature'));
    assert.equal((await f.call('command', command(7102), s.csrf)).status, 409);
    assert.equal((await f.call('retry', { operationId: c.operationId }, s.csrf)).status, 409);
    const original = await f.call('original');
    assert.equal(original.status, 200);
    assert.equal((await original.json()).receipt.actorId, ADMIN);
    assert.equal((await f.call('settle', { operationId: c.operationId }, s.csrf)).status, 200);
    assert.equal(await f.store().read({ tenantId: T, actorId: ADMIN }), null);
    assert.equal((await (await f.call('branches?limit=10')).json()).page.items[0].name, c.name);
    assert.equal(f.posts, 1);
    assert.equal(
      (await f.db.query('SELECT count(*)::int AS n FROM app_private.staff_branch_operations'))
        .rows[0].n,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test('a missing original permits only one deliberate retry of the retained branch bytes', async () => {
  const f = await setup();
  try {
    const s = await f.login(),
      c = command();
    f.mode = 'lost-before';
    assert.equal((await f.call('command', c, s.csrf)).status, 503);
    assert.equal((await f.call('retry', { operationId: c.operationId }, s.csrf)).status, 409);
    assert.equal((await f.call('original')).status, 404);
    f.restart();
    f.mode = 'normal';
    assert.equal((await f.call('retry', { operationId: c.operationId }, s.csrf)).status, 200);
    assert.equal((await f.call('retry', { operationId: c.operationId }, s.csrf)).status, 409);
    assert.equal(f.posts, 2);
  } finally {
    await f.db.close();
  }
});
test('current SQL admin policy denies agents/customers, isolates peer originals and permits logout after revocation', async () => {
  const f = await setup();
  try {
    let s = await f.login();
    f.mode = 'lost-after';
    await f.call('command', command(), s.csrf);
    f.mode = 'normal';
    for (const actor of [AGENT, CUSTOMER]) {
      s = await f.login(actor);
      assert.equal((await f.call('session')).status, 403);
      assert.equal((await f.call('original')).status, 403);
    }
    await f.login(PEER);
    assert.equal((await (await f.call('session')).json()).pending, null);
    s = await f.login();
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    assert.equal((await f.call('session')).status, 403);
    assert.equal((await f.call('sign-out', {}, s.csrf)).status, 200);
    assert.equal((await f.call('session')).status, 401);
    await f.db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=null WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await f.login();
    assert.deepEqual((await (await f.call('session')).json()).pending, command());
  } finally {
    await f.db.close();
  }
});
test('logout and membership revocation during asynchronous replies suppress branch data', async () => {
  const f = await setup();
  try {
    const s = await f.login();
    let fired = false;
    f.after = async (url) => {
      if (!fired && url.includes('/branches/operations/')) {
        fired = true;
        assert.equal(
          (await f.bridge.handle(f.request('/auth/logout', {}, { 'x-csrf-token': s.csrf }))).status,
          200,
        );
      }
    };
    const r = await f.call('command', command(), s.csrf);
    assert.equal(r.status, 401);
    assert.ok(!(await r.text()).includes('receipt'));
    assert.equal(f.posts, 1);
    await f.login();
    f.after = async (url) => {
      if (url.includes('/branches?limit=10'))
        await f.db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, ADMIN],
        );
    };
    const page = await f.call('branches?limit=10');
    assert.equal(page.status, 403);
    assert.ok(!(await page.text()).includes(command().name));
  } finally {
    await f.db.close();
  }
});
test('scope mismatch, posted roles, CSRF, preview headers and malformed commands do not forward writes', async () => {
  const f = await setup();
  try {
    const s = await f.login();
    f.wrongScope = true;
    assert.equal((await f.call('session')).status, 403);
    f.wrongScope = false;
    for (const extra of [
      { 'x-role': 'admin' },
      { 'x-actor-id': PEER },
      { 'x-preview-instance': id(88) },
      { origin: 'https://attacker.example' },
      { 'x-staff-csrf': 'wrong' },
    ])
      assert.ok(
        [400, 403].includes(
          (
            await f.bff.handle(
              f.request('/api/hosted-staff/command', command(), {
                'x-staff-csrf': s.csrf,
                ...extra,
              }),
            )
          ).status,
        ),
      );
    assert.equal((await f.call('command', { ...command(), role: 'admin' }, s.csrf)).status, 400);
    assert.equal(f.posts, 0);
  } finally {
    await f.db.close();
  }
});
test('sealed staff originals reject table/actor swaps and ordinary API-role reads, with one atomic reservation', async () => {
  const f = await setup();
  try {
    const scope = { tenantId: T, actorId: ADMIN },
      store = f.store();
    assert.deepEqual(
      (
        await Promise.all([store.reserve(scope, command()), store.reserve(scope, command(7102))])
      ).sort(),
      [false, true],
    );
    const row = (
      await f.db.query('SELECT operation_id,sealed FROM identity.staff_browser_originals')
    ).rows[0];
    assert.ok(!row.sealed.includes('reason'));
    await f.db.query(
      'INSERT INTO identity.customer_browser_originals(tenant_id,actor_id,operation_id,sealed) VALUES($1,$2,$3,$4)',
      [T, ADMIN, row.operation_id, row.sealed],
    );
    await assert.rejects(createCustomerOriginals(f.db, '05'.repeat(32)).read(scope));
    await f.db.query('UPDATE identity.staff_browser_originals SET actor_id=$1', [PEER]);
    await assert.rejects(store.read({ tenantId: T, actorId: PEER }));
    await f.db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await assert.rejects(f.db.query('SELECT * FROM identity.staff_browser_originals'));
    } finally {
      await f.db.exec('ROLLBACK');
    }
  } finally {
    await f.db.close();
  }
});

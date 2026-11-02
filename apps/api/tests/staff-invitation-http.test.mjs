import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { RealtorApiClient } from '@realtor/api-client';
import { createApiService } from '../dist/service.js';
import { createDevelopmentServer } from '../dist/http.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = 'http-staff@example.invalid';
const issue = () => ({
  policy: 'staff-invitation-issue-command-v1',
  operationId: id(300),
  invitationId: id(200),
});
const redeem = () => ({
  policy: 'staff-invitation-redemption-command-v1',
  operationId: id(400),
  invitationId: id(200),
});
const path = (lane = 'issues', op = 300) =>
  `/v2/staff/invitation-${lane}/${id(200)}/operations/${id(op)}`;
let jwksServer, issuer, key, wrongKey;
const config = () => ({
  issuer,
  audience: 'synthetic-http-staff',
  jwksUrl: issuer + '/jwks',
  allowLoopbackHttpForTests: true,
});
before(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  wrongKey = (await generateKeyPair('RS256')).privateKey;
  const body = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'http-staff', alg: 'RS256' }],
  });
  jwksServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  issuer = 'http://127.0.0.1:' + jwksServer.address().port;
});
after(async () => {
  jwksServer?.closeAllConnections();
  if (jwksServer) await new Promise((resolve) => jwksServer.close(resolve));
});
const signed = (user = 10, patch = {}, signing = key) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: 'synthetic-http-staff',
    sub: id(user),
    iat: now - 1,
    exp: now + 120,
    email,
    email_verified: true,
    ...patch,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'http-staff' })
    .sign(signing);
};
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  for (const file of [
    'staff-branches.sql',
    'staff-invitation-requests.sql',
    'staff-membership-changes.sql',
    'staff-invitation-redemption.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + file, import.meta.url), 'utf8'),
    );
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'http-invitation','Synthetic HTTP')",
    [id(1)],
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [id(1), id(10)],
  );
  const control = { transactions: 0, writes: 0, corruptIssue: false, corruptRedemption: false };
  const database = {
    async transaction(context, operation) {
      control.transactions++;
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [context.tenantId, context.actorId ?? ''],
        );
        const result = await operation({
          async query(sql, args) {
            if (
              sql.includes('app_api.issue_staff_invitation(') ||
              sql.includes('app_api.redeem_staff_invitation(')
            )
              control.writes++;
            const result = await db.query(sql, args);
            if (
              (control.corruptIssue && sql.includes('app_api.issue_staff_invitation(')) ||
              (control.corruptRedemption && sql.includes('app_api.redeem_staff_invitation('))
            )
              return {
                rows: [
                  { result: { ...result.rows[0].result, unexpected: 'refuse-before-commit' } },
                ],
              };
            return result;
          },
        });
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
    q.query("SELECT app_api.record_staff_invitation_request($1,$2,'agent',NULL,24)", [
      id(200),
      email,
    ]),
  );
  const options = {
    database,
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async () => {
      throw Error('Ordinary authorization hook must not replace signed recipient proof.');
    },
    requestLimiter: { consume: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    staffInvitationRedemption: { mode: 'synthetic-single-use-invitations-v1', identity: config() },
  };
  const handler = createApiService(options),
    server = createDevelopmentServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  const client = (fetcher) =>
    new RealtorApiClient({
      baseUrl,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-v1',
      ...(fetcher ? { fetch: fetcher } : {}),
    });
  return {
    db,
    control,
    options,
    handler,
    client,
    baseUrl,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}
const count = async (db, table) =>
  Number((await db.query('SELECT count(*) AS n FROM app_private.' + table)).rows[0].n);
async function post(f, token, body = issue(), target = path(), headers = {}) {
  return f.handler(
    new Request('http://synthetic.invalid' + target, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
    }),
  );
}

test('default-off HTTP routes never authenticate or touch SQL; explicit mode refuses production and unknown policies', async () => {
  let touched = 0;
  const options = {
    database: {
      transaction: () => {
        touched++;
        throw Error();
      },
    },
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async () => {
      touched++;
      throw Error();
    },
  };
  const handler = createApiService(options);
  for (const target of [path(), path('redemptions', 400), path() + '/state'])
    assert.equal(
      (
        await handler(
          new Request('http://synthetic.invalid' + target, { method: 'POST', body: 'invalid' }),
        )
      ).status,
      404,
    );
  assert.equal(touched, 0);
  assert.throws(() =>
    createApiService({
      ...options,
      staffInvitationRedemption: { mode: 'other', identity: config() },
    }),
  );
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() =>
      createApiService({
        ...options,
        staffInvitationRedemption: {
          mode: 'synthetic-single-use-invitations-v1',
          identity: config(),
        },
      }),
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('native loopback HTTP and SDK connect signed issue, metadata-only recovery, current state and one membership grant', async () => {
  const f = await fixture();
  try {
    const api = f.client(),
      admin = { bearerToken: await signed() },
      recipient = { bearerToken: await signed(50, { role: 'admin', tenant_id: id(999) }) };
    const issued = await api.issueStaffInvitation(issue(), admin);
    assert.equal(issued.secret.length, 43);
    assert.equal(issued.record.membershipGranted, false);
    assert.equal(issued.record.actorId, id(10));
    assert.deepEqual(await api.getStaffInvitationIssue(issue(), admin), issued.record);
    assert.equal((await api.getIssuedStaffInvitationState(issue(), admin)).state, 'issued');
    const saved = await api.redeemStaffInvitation(redeem(), issued.secret, recipient);
    assert.equal(saved.memberId, id(50));
    assert.equal(saved.requestedRole, 'agent');
    assert.deepEqual(await api.getStaffInvitationRedemption(redeem(), recipient), saved);
    assert.equal((await api.getIssuedStaffInvitationState(issue(), admin)).state, 'used');
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now(),admin_version=2 WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(50)],
    );
    assert.deepEqual(await api.redeemStaffInvitation(redeem(), issued.secret, recipient), saved);
    assert.equal(
      (await f.db.query('SELECT active FROM app_private.memberships WHERE user_id=$1', [id(50)]))
        .rows[0].active,
      false,
    );
    assert.equal(await count(f.db, 'staff_invitation_redemptions'), 1);
    assert.equal(await count(f.db, 'staff_invitation_issues'), 1);
    assert.ok(
      !JSON.stringify((await f.db.query('SELECT * FROM app_private.audit_events')).rows).includes(
        issued.secret,
      ),
    );
  } finally {
    await f.close();
  }
});

test('lost committed HTTP disclosure stays uncertain; GET and explicit replay cannot mint a replacement secret', async () => {
  const f = await fixture();
  try {
    const admin = { bearerToken: await signed() },
      calls = [];
    const api = f.client(async (url, init) => {
      calls.push(init.method);
      const reply = await fetch(url, init);
      if (init.method === 'POST' && calls.length === 1) {
        await reply.arrayBuffer();
        return new Response('{invalid', {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      return reply;
    });
    await assert.rejects(
      () => api.issueStaffInvitation(issue(), admin),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain === true,
    );
    assert.equal(await count(f.db, 'staff_invitation_issues'), 1);
    const writes = f.control.writes;
    const original = await api.getStaffInvitationIssue(issue(), admin);
    assert.equal(original.operationId, id(300));
    assert.deepEqual(calls, ['POST', 'GET']);
    assert.equal(f.control.writes, writes);
    const replay = await api.issueStaffInvitation(issue(), admin);
    assert.equal(replay.secret, null);
    assert.deepEqual(replay.record, original);
    assert.equal(f.control.writes, writes);
    assert.equal(await count(f.db, 'staff_invitation_issues'), 1);
  } finally {
    await f.close();
  }
});

test('bounded HTTP rejects duplicate JSON, extra authority, invalid UTF8, oversized bodies, headers and route aliases before SQL', async () => {
  const f = await fixture();
  try {
    const token = await signed(),
      before = f.control.transactions;
    const invalid = [
      [JSON.stringify({ ...issue(), actorId: id(10) }), 400],
      [JSON.stringify({ ...issue(), operationId: id(301) }), 400],
      [
        '{"policy":"staff-invitation-issue-command-v1","operationId":"' +
          id(300) +
          '","invitationId":"' +
          id(200) +
          '","\\u0069nvitationId":"' +
          id(200) +
          '"}',
        400,
      ],
      [new Uint8Array([0xc3, 0x28]), 400],
      [' '.repeat(2049), 413],
    ];
    for (const [body, status] of invalid) assert.equal((await post(f, token, body)).status, status);
    for (const headers of [
      { cookie: 'secret=x' },
      { 'if-none-match': '*' },
      { 'idempotency-key': id(300) },
      { 'content-type': 'application/json; charset=utf-8' },
      { 'content-encoding': 'gzip' },
      { 'content-length': '2049' },
    ])
      assert.ok([400, 413].includes((await post(f, token, issue(), path(), headers)).status));
    for (const target of [
      path() + '?tenantId=' + id(9),
      path() + '#fragment',
      path() + '/',
      path().replace(id(200), '%30' + id(200).slice(1)),
      path('redemptions', 400) + '/state',
    ])
      assert.equal((await post(f, token, issue(), target)).status, 404);
    const method = await f.handler(
      new Request('http://synthetic.invalid' + path(), {
        method: 'DELETE',
        headers: { authorization: 'Bearer ' + token },
      }),
    );
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'GET, POST');
    assert.equal(f.control.transactions, before);
    assert.equal(await count(f.db, 'staff_invitation_issues'), 0);
  } finally {
    await f.close();
  }
});

test('signed route cannot use an ordinary authorization hook or caller company/role claims as recipient proof', async () => {
  const f = await fixture();
  try {
    const admin = { bearerToken: await signed() },
      issued = await f.client().issueStaffInvitation(issue(), admin),
      before = f.control.transactions;
    for (const token of [
      await signed(50, { email_verified: false }),
      await signed(50, {}, wrongKey),
      await signed(50, { iss: issuer + '/other' }),
      await signed(50, { aud: 'other' }),
    ]) {
      const response = await post(
        f,
        token,
        { command: redeem(), secret: issued.secret },
        path('redemptions', 400),
      );
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!(await response.text()).includes(issued.secret));
    }
    assert.equal(f.control.transactions, before);
    const foreign = await post(
      f,
      await signed(50, { email: 'different@example.invalid', role: 'admin', tenant_id: id(1) }),
      { command: redeem(), secret: issued.secret },
      path('redemptions', 400),
    );
    assert.equal(foreign.status, 404);
    const forbidden = await post(f, await signed(50, { role: 'admin', tenant_id: id(1) }));
    assert.equal(forbidden.status, 403);
    assert.equal(await count(f.db, 'staff_invitation_redemptions'), 0);
  } finally {
    await f.close();
  }
});

test('malformed SQL issue and redemption receipts roll back before generic HTTP errors disclose any facts', async () => {
  const f = await fixture();
  try {
    const admin = await signed();
    f.control.corruptIssue = true;
    const failed = await post(f, admin);
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('refuse-before-commit'));
    assert.equal(await count(f.db, 'staff_invitation_issues'), 0);
    f.control.corruptIssue = false;
    const issued = await f.client().issueStaffInvitation(issue(), { bearerToken: admin });
    f.control.corruptRedemption = true;
    const result = await post(
      f,
      await signed(50),
      { command: redeem(), secret: issued.secret },
      path('redemptions', 400),
    );
    assert.equal(result.status, 503);
    assert.ok(!(await result.text()).includes(issued.secret));
    assert.equal(await count(f.db, 'staff_invitation_redemptions'), 0);
    assert.equal(
      (
        await f.db.query('SELECT count(*) AS n FROM app_private.memberships WHERE user_id=$1', [
          id(50),
        ])
      ).rows[0].n,
      0,
    );
    f.control.corruptRedemption = false;
    assert.equal(
      (await f.client().getIssuedStaffInvitationState(issue(), { bearerToken: admin })).state,
      'issued',
    );
  } finally {
    await f.close();
  }
});

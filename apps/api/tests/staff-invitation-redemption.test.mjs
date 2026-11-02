import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import {
  createStaffInvitationRedemptionCandidate,
  StaffInvitationCandidateError,
} from '../dist/staff-invitation-redemption.js';
import { AuthenticationError } from '../dist/auth.js';
import { hashStaffInvitationSecret } from '../dist/staff-invitation-secret.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = 'new-staff@example.invalid';
const command = (op = 300, invitation = 200) => ({
  tenantId: id(1),
  operationId: id(op),
  invitationId: id(invitation),
});
let server, issuer, key, wrongKey;
const config = () => ({
  issuer,
  audience: 'synthetic-single-use-staff',
  jwksUrl: issuer + '/jwks',
  allowLoopbackHttpForTests: true,
});
before(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  wrongKey = (await generateKeyPair('RS256')).privateKey;
  const body = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'single-use-staff', alg: 'RS256' }],
  });
  server = createServer((req, res) => {
    res.writeHead(req.url === '/jwks' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(req.url === '/jwks' ? body : '{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
});
const signed = (user = 50, patch = {}, signing = key) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: 'synthetic-single-use-staff',
    sub: id(user),
    iat: now - 1,
    exp: now + 120,
    email,
    email_verified: true,
    ...patch,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'single-use-staff' })
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
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'signed-invite','Synthetic A')",
    [id(1)],
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [id(1), id(10)],
  );
  const control = {
    transactions: 0,
    loseCommit: false,
    corruptReceipt: false,
    corruptIssue: false,
    corruptState: false,
    writeCalls: 0,
  };
  const database = {
    async transaction(context, operation) {
      control.transactions++;
      let committed = false;
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [context.tenantId, context.actorId ?? ''],
        );
        const query = {
          async query(sql, args) {
            if (
              sql.includes('app_api.issue_staff_invitation(') ||
              sql.includes('app_api.redeem_staff_invitation(')
            )
              control.writeCalls++;
            const result = await db.query(sql, args);
            if (
              (control.corruptIssue && sql.includes('app_api.issue_staff_invitation(')) ||
              (control.corruptState && sql.includes('app_api.read_issued_staff_invitation('))
            )
              return {
                rows: [
                  { result: { ...result.rows[0].result, unexpected: 'refuse-malformed-facts' } },
                ],
              };
            if (control.corruptReceipt && sql.includes('app_api.redeem_staff_invitation('))
              return {
                rows: [
                  { result: { ...result.rows[0].result, unexpected: 'refuse-before-commit' } },
                ],
              };
            return result;
          },
        };
        const result = await operation(query);
        await db.exec('COMMIT');
        committed = true;
        if (control.loseCommit) {
          control.loseCommit = false;
          throw Error('Synthetic lost committed reply.');
        }
        return result;
      } catch (error) {
        if (!committed) await db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  await database.transaction({ tenantId: id(1), actorId: id(10) }, (query) =>
    query.query("SELECT app_api.record_staff_invitation_request($1,$2,'agent',NULL,24)", [
      id(200),
      email,
    ]),
  );
  const service = createStaffInvitationRedemptionCandidate({
    database,
    identity: config(),
    mode: 'synthetic-single-use-invitations-v1',
  });
  return { db, service, control };
}
const number = async (db, table) =>
  Number((await db.query('SELECT count(*) AS n FROM app_private.' + table)).rows[0].n);

test('signed recipient and one-reveal issuance connect to actual SQL without serializing raw secret or digest', async () => {
  const { db, service, control } = await fixture();
  try {
    const admin = await signed(10);
    const issued = await service.issue(command(), admin);
    assert.equal(issued.secretAvailable, true);
    assert.ok(Object.isFrozen(issued));
    assert.ok(Object.isFrozen(issued.receipt));
    const raw = issued.takeSecretOnce();
    assert.throws(() => issued.takeSecretOnce());
    const hash = hashStaffInvitationSecret(raw),
      serialized = JSON.stringify(issued);
    assert.ok(!serialized.includes(raw) && !serialized.includes(hash));
    const writes = control.writeCalls;
    const replay = await service.issue(command(), admin);
    assert.equal(replay.secretAvailable, false);
    assert.throws(() => replay.takeSecretOnce());
    assert.equal(control.writeCalls, writes);
    assert.deepEqual(replay.receipt, issued.receipt);
    assert.deepEqual(await service.readIssue(command(), admin), issued.receipt);
    assert.equal((await service.readState(command(), admin)).state, 'issued');
    const recipient = await signed(50, { role: 'admin', tenant_id: id(999) });
    await assert.rejects(
      () => service.readState(command(), recipient),
      (error) => error.code === '42501',
    );
    const saved = await service.redeem(command(400), recipient, raw);
    assert.equal(saved.memberId, id(50));
    assert.equal(saved.requestedRole, 'agent');
    assert.equal((await service.readState(command(), admin)).state, 'used');
    assert.deepEqual(await service.readRedemption(command(400), recipient), saved);
    assert.deepEqual(await service.redeem(command(400), recipient, raw), saved);
    assert.equal(await number(db, 'staff_invitation_redemptions'), 1);
    assert.ok(
      !JSON.stringify(
        (await db.query('SELECT * FROM app_private.staff_invitation_issues')).rows,
      ).includes(raw),
    );
    issued.destroySecret();
  } finally {
    await db.close();
  }
});

test('unverified, forged and mismatched claims and request-supplied authority never enter a transaction', async () => {
  const { db, service, control } = await fixture();
  try {
    const raw = (await service.issue(command(), await signed(10))).takeSecretOnce();
    const before = control.transactions;
    for (const token of [
      await signed(50, { email_verified: false }),
      await signed(50, {}, wrongKey),
      await signed(50, { iss: issuer + '/foreign' }),
      await signed(50, { aud: 'foreign' }),
    ])
      await assert.rejects(
        async () => service.redeem(command(400), token, raw),
        AuthenticationError,
      );
    let getters = 0;
    const hostile = Object.defineProperty({ ...command(400) }, 'tenantId', {
      enumerable: true,
      get() {
        getters++;
        throw Error('private');
      },
    });
    await assert.rejects(
      async () => service.redeem(hostile, 'unused', raw),
      StaffInvitationCandidateError,
    );
    for (const extra of [{ recipientEmail: email }, { role: 'admin' }, { actorId: id(50) }])
      await assert.rejects(
        async () => service.redeem({ ...command(400), ...extra }, 'unused', raw),
        StaffInvitationCandidateError,
      );
    assert.equal(getters, 0);
    assert.equal(control.transactions, before);
    await assert.rejects(
      async () =>
        service.redeem(command(400), await signed(50, { email: 'other@example.invalid' }), raw),
      (e) => e.code === 'P0002',
    );
    assert.equal(await number(db, 'staff_invitation_redemptions'), 0);
  } finally {
    await db.close();
  }
});

test('malformed actual SQL receipt rolls back membership, consumption and audit before commit', async () => {
  const { db, service, control } = await fixture();
  try {
    const raw = (await service.issue(command(), await signed(10))).takeSecretOnce();
    control.corruptReceipt = true;
    await assert.rejects(
      async () => service.redeem(command(400), await signed(50), raw),
      StaffInvitationCandidateError,
    );
    assert.equal(await number(db, 'staff_invitation_redemptions'), 0);
    assert.equal(
      Number(
        (
          await db.query('SELECT count(*) AS n FROM app_private.memberships WHERE user_id=$1', [
            id(50),
          ])
        ).rows[0].n,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM app_private.audit_events WHERE action='staff.invitation_redeemed'",
          )
        ).rows[0].n,
      ),
      0,
    );
    control.corruptReceipt = false;
    assert.equal(
      (await service.redeem(command(400), await signed(50), raw)).membershipGranted,
      true,
    );
  } finally {
    await db.close();
  }
});

test('lost committed issue reply recovers metadata and never regenerates or writes a replacement secret', async () => {
  const { db, service, control } = await fixture();
  try {
    control.loseCommit = true;
    await assert.rejects(
      async () => service.issue(command(), await signed(10)),
      /Synthetic lost committed reply/,
    );
    assert.equal(await number(db, 'staff_invitation_issues'), 1);
    const writes = control.writeCalls;
    const original = await service.readIssue(command(), await signed(10));
    const replay = await service.issue(command(), await signed(10));
    assert.deepEqual(replay.receipt, original);
    assert.equal(replay.secretAvailable, false);
    assert.throws(() => replay.takeSecretOnce());
    assert.equal(control.writeCalls, writes);
    assert.equal(await number(db, 'staff_invitation_redemptions'), 0);
  } finally {
    await db.close();
  }
});

test('synthetic mode and production guards remain closed and discarded secrets cannot be revealed', async () => {
  const { db, service, control } = await fixture();
  try {
    const issued = await service.issue(command(), await signed(10));
    issued.destroySecret();
    assert.throws(() => issued.takeSecretOnce());
    for (const mode of [undefined, true, 'enabled'])
      assert.throws(
        () => createStaffInvitationRedemptionCandidate({ database: {}, identity: config(), mode }),
        StaffInvitationCandidateError,
      );
    const before = control.transactions,
      previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(
        () =>
          createStaffInvitationRedemptionCandidate({
            database: {},
            identity: config(),
            mode: 'synthetic-single-use-invitations-v1',
          }),
        StaffInvitationCandidateError,
      );
      await assert.rejects(
        async () => service.issue(command(), 'unused'),
        StaffInvitationCandidateError,
      );
      await assert.rejects(
        async () => service.redeem(command(400), 'unused', 'unused'),
        StaffInvitationCandidateError,
      );
      assert.equal(control.transactions, before);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  } finally {
    await db.close();
  }
});

test('malformed issuance rolls back the digest and malformed current state never becomes authority', async () => {
  const { db, service, control } = await fixture();
  try {
    const admin = await signed(10);
    control.corruptIssue = true;
    await assert.rejects(() => service.issue(command(), admin), StaffInvitationCandidateError);
    assert.equal(await number(db, 'staff_invitation_issues'), 0);
    control.corruptIssue = false;
    const issued = await service.issue(command(), admin);
    issued.destroySecret();
    const writes = control.writeCalls;
    control.corruptState = true;
    await assert.rejects(() => service.readState(command(), admin), StaffInvitationCandidateError);
    control.corruptState = false;
    assert.equal((await service.readState(command(), admin)).state, 'issued');
    assert.equal(control.writeCalls, writes);
  } finally {
    await db.close();
  }
});

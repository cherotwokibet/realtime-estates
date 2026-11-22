import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateRecoveryCipher } from '../dist/tests/lib/private-recovery-cipher.js';
import { privateRecoveryRequest } from '../dist/tests/lib/private-recovery-server.js';
import { privateWorkspaceLeaseRequest } from '../dist/tests/lib/private-workspace-lease-server.js';
import { createPrivateRecoveryClient } from '../dist/tests/lib/private-recovery-client.js';
import { createSealedRecoveryStore } from '../dist/tests/lib/private-recovery-store.js';
import { recoveryCommand, recoveryReceipt } from '../dist/tests/lib/private-recovery-contract.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { instanceId: id(90), tenantId: id(1), actorId: id(10) };
const target = { customerId: id(40), requestId: id(41), operationId: id(42) };
const when = new Date().toISOString();
const variants = [
  [
    'deletion-triage',
    {
      ...target,
      policy: 'synthetic-customer-deletion-review-command-v1',
      disposition: 'needs_information',
    },
    {
      ...target,
      policy: 'synthetic-customer-deletion-review-v1',
      tenantId: scope.tenantId,
      reviewerId: scope.actorId,
      disposition: 'needs_information',
      reviewedAt: when,
    },
  ],
  [
    'deletion-triage',
    target,
    {
      ...target,
      policy: 'synthetic-customer-deletion-return-v1',
      tenantId: scope.tenantId,
      reviewerId: scope.actorId,
      returnedAt: when,
    },
  ],
  [
    'deletion-privacy',
    { ...target, decision: 'hold' },
    {
      ...target,
      policy: 'synthetic-deletion-privacy-decision-v1',
      retentionProfile: 'synthetic-retention-review-v1',
      tenantId: scope.tenantId,
      reviewerId: scope.actorId,
      decision: 'hold',
      decidedAt: when,
    },
  ],
];
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:49000',
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
  STAFF_PREVIEW_TOKEN: 'synthetic.triage.signature',
  STAFF_DELETION_TRIAGE_MODE: 'synthetic-v1',
  STAFF_DELETION_TRIAGE_TENANT: scope.tenantId,
  STAFF_DELETION_TRIAGE_REVIEWER: scope.actorId,
  STAFF_DELETION_PRIVACY_MODE: 'synthetic-v1',
  STAFF_DELETION_PRIVACY_TOKEN: 'synthetic.privacy.signature',
  STAFF_DELETION_PRIVACY_REVIEWER: scope.actorId,
  PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
  PRIVATE_RECOVERY_STORAGE_KEY: 'ac'.repeat(32),
};
const lease = (patch = {}) => {
  const now = Date.now();
  return {
    policy: 'staff-access-lease-v1',
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    role: 'admin',
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30000).toISOString(),
    ...patch,
  };
};
const request = (path, body) =>
  new Request('http://127.0.0.1:49001' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      host: '127.0.0.1:49001',
      origin: 'http://127.0.0.1:49001',
      'x-preview-instance': scope.instanceId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
for (const [kind, command, receipt] of variants) {
  test(
    kind +
      ' ' +
      receipt.policy +
      ': encrypted original survives disposal; only complete current-reviewer receipt can release it',
    async () => {
      const cipher = createPrivateRecoveryCipher(env.PRIVATE_RECOVERY_STORAGE_KEY),
        map = new Map();
      const storage = {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => map.set(k, v),
        removeItem: (k) => map.delete(k),
      };
      let denied = false;
      const codec = {
        seal: async (c) => cipher.seal(scope, kind, c),
        open: async (e) => {
          if (denied) throw Object.assign(Error('Denied'), { status: 403 });
          return cipher.open(scope, kind, e);
        },
      };
      const first = createSealedRecoveryStore(storage, scope, kind, codec);
      await first.retain(command);
      const saved = [...map];
      first.dispose();
      assert.doesNotMatch(JSON.stringify(saved), /customerId|requestId|disposition|decision/);
      const store = createSealedRecoveryStore(storage, scope, kind, codec);
      assert.deepEqual(await store.load(), recoveryCommand(kind, command));
      for (const patch of [
        { tenantId: id(2) },
        { reviewerId: id(11) },
        { customerId: id(50) },
        { requestId: id(51) },
        { operationId: id(52) },
        {
          ...('decision' in command
            ? { decision: 'plan_review' }
            : 'disposition' in command
              ? { disposition: 'ready_for_privacy_review' }
              : {
                  policy: 'synthetic-customer-deletion-review-v1',
                  disposition: 'ready_for_privacy_review',
                }),
        },
      ]) {
        await assert.rejects(async () => store.releaseConfirmed(command, { ...receipt, ...patch }));
        assert.deepEqual([...map], saved);
      }
      assert.throws(() =>
        recoveryReceipt(scope, kind, command, { policy: 'private-operation-resolution-v1' }),
      );
      const otherKind = kind === 'deletion-triage' ? 'deletion-privacy' : 'deletion-triage';
      assert.throws(() => cipher.open(scope, otherKind, JSON.parse(saved[0][1])));
      denied = true;
      await assert.rejects(store.releaseConfirmed(command, receipt));
      assert.deepEqual([...map], saved);
      // A fresh authorized lifetime, not the denied guard, may confirm the original.
      denied = false;
      const reopened = createSealedRecoveryStore(storage, scope, kind, codec);
      await reopened.releaseConfirmed(command, receipt);
      assert.equal(map.size, 0);
    },
  );
  test(
    kind +
      ' ' +
      receipt.policy +
      ': BFF pins configured reviewer credential and rechecks fresh authority before opening',
    async () => {
      const api = async (url, init) => {
        assert.ok(
          ['/v2/staff/session-lease', '/v2/staff/customer-deletion-privacy'].includes(
            new URL(url).pathname,
          ),
        );
        assert.equal(
          init.headers.Authorization,
          'Bearer ' +
            (kind === 'deletion-privacy'
              ? env.STAFF_DELETION_PRIVACY_TOKEN
              : env.STAFF_PREVIEW_TOKEN),
        );
        return Response.json(
          new URL(url).pathname === '/v2/staff/customer-deletion-privacy'
            ? {
                policy: 'synthetic-deletion-privacy-queue-v1',
                tenantId: scope.tenantId,
                reviewerId: scope.actorId,
                items: [],
                hasMore: false,
              }
            : lease(),
        );
      };
      const path = '/api/private-workspace/recovery/' + kind;
      const sealed = await privateRecoveryRequest(
        request(path + '/seal', { scope, command }),
        kind,
        'seal',
        env,
        api,
      );
      assert.equal(sealed.status, 200);
      const envelope = await sealed.json();
      const opened = await privateRecoveryRequest(
        request(path + '/open', { scope, envelope }),
        kind,
        'open',
        env,
        api,
      );
      assert.equal(opened.status, 200);
      assert.deepEqual(await opened.json(), recoveryCommand(kind, command));
      for (const patch of [{ role: 'agent' }, { actorId: id(11) }, { tenantId: id(2) }]) {
        const r = await privateRecoveryRequest(
          request(path + '/open', { scope, envelope }),
          kind,
          'open',
          env,
          async () => Response.json(lease(patch)),
        );
        assert.equal(r.status, 403);
      }
      let calls = 0;
      const forbidden = () => {
        calls++;
        throw Error('No terminal reviewer protocol');
      };
      assert.equal(
        (
          await privateRecoveryRequest(
            request(path + '/resolve', { scope, command }),
            kind,
            'resolve',
            env,
            forbidden,
          )
        ).status,
        404,
      );
      await assert.rejects(
        createPrivateRecoveryClient(scope, kind, forbidden).resolve(
          command,
          new AbortController().signal,
        ),
      );
      assert.equal(calls, 0);
      const route = '/api/private-workspace/lease/' + kind;
      assert.equal(
        (await privateWorkspaceLeaseRequest(request(route), kind, env, api)).status,
        200,
      );
      assert.equal(
        (
          await privateWorkspaceLeaseRequest(request(route), kind, env, async () =>
            Response.json(lease({ actorId: id(11) })),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await privateWorkspaceLeaseRequest(
            request(route),
            kind,
            { ...env, NODE_ENV: 'production' },
            forbidden,
          )
        ).status,
        503,
      );
      assert.equal(
        (
          await privateRecoveryRequest(
            request(path + '/seal', { scope, command }),
            kind,
            'seal',
            { ...env, NODE_ENV: 'production' },
            forbidden,
          )
        ).status,
        503,
      );
      assert.equal(calls, 0);
    },
  );
}

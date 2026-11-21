import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPrivateWorkspaceGuard,
  PrivateWorkspaceCleared,
} from '../dist/tests/lib/private-workspace-guard.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('invalidation immediately aborts all reads and suppresses uncooperative late private replies', async () => {
  let clears = 0;
  const guard = createPrivateWorkspaceGuard(() => clears++);
  const a = deferred(),
    b = deferred(),
    signals = [];
  const pending = [a, b].map((d) =>
    guard.run((signal) => {
      signals.push(signal);
      return d.promise;
    }),
  );
  const checked = pending.map((p) => assert.rejects(p, PrivateWorkspaceCleared));
  await Promise.resolve();
  assert.equal(signals.length, 2);
  guard.invalidate();
  guard.invalidate();
  assert.equal(clears, 1);
  assert.ok(signals.every((s) => s.aborted));
  await Promise.all(checked); // Does not wait for either transport to cooperate.
  a.resolve({ privateReview: 'late' });
  b.reject(Error('late failure'));
  let sent = false;
  await assert.rejects(
    guard.run(async () => {
      sent = true;
    }),
    PrivateWorkspaceCleared,
  );
  assert.equal(sent, false, 'cached edits cannot dispatch after local invalidation');
});

test('401 and 403 clear all current flights exactly once before denial escapes', async () => {
  for (const status of [401, 403]) {
    let clears = 0;
    const guard = createPrivateWorkspaceGuard(() => clears++),
      held = deferred();
    let signal;
    const slow = assert.rejects(
      guard.run((s) => {
        signal = s;
        return held.promise;
      }),
      PrivateWorkspaceCleared,
    );
    await assert.rejects(
      guard.run(async () => {
        throw { status, uncertain: true };
      }),
      PrivateWorkspaceCleared,
    );
    await slow;
    assert.equal(clears, 1);
    assert.equal(signal.aborted, true);
    held.resolve('private');
  }
});

test('ordinary success and uncertain non-denial errors retain their original recovery information', async () => {
  let clears = 0;
  const guard = createPrivateWorkspaceGuard(() => clears++);
  assert.deepEqual(await guard.run(async () => ({ version: '7' })), { version: '7' });
  for (const status of [0, 400, 404, 409, 422, 502, 503]) {
    const original = { status, uncertain: true, operation: 'retain-authoritative-original' };
    await assert.rejects(
      guard.run(async () => {
        throw original;
      }),
      (error) => error === original,
    );
  }
  assert.equal(clears, 0);
  assert.equal(guard.cleared, false);
});

test('legacy, logout and account-change notifications clear; sign-in never unlocks or grants authority', async () => {
  for (const event of [
    { type: 'auth-changed' },
    { type: 'auth-changed', reason: 'signing-out' },
    { type: 'auth-changed', reason: 'signed-out' },
    { type: 'auth-changed', reason: 'signed-in' },
    { type: 'auth-changed', reason: 'unknown', token: 'untrusted' },
  ]) {
    let clears = 0;
    const guard = createPrivateWorkspaceGuard(() => clears++);
    guard.observe({ type: 'unrelated' });
    assert.equal(guard.cleared, false);
    guard.observe(event);
    guard.observe({ type: 'auth-changed', reason: 'signed-in' });
    assert.equal(clears, 1);
    await assert.rejects(
      guard.run(async () => 'private'),
      PrivateWorkspaceCleared,
    );
  }
});

test('unmount disposal aborts outstanding work without notifying a disposed React owner', async () => {
  let clears = 0;
  const guard = createPrivateWorkspaceGuard(() => clears++),
    held = deferred();
  const check = assert.rejects(
    guard.run(() => held.promise),
    PrivateWorkspaceCleared,
  );
  guard.dispose();
  guard.invalidate();
  await check;
  held.resolve('late private content');
  assert.equal(clears, 0);
});

test('invalidation inside a synchronously completing task cannot return its private result', async () => {
  const guard = createPrivateWorkspaceGuard(() => {});
  await assert.rejects(
    guard.run(async () => {
      guard.invalidate();
      return 'private';
    }),
    PrivateWorkspaceCleared,
  );
});

test('a synchronous denial is handled and invalidation before dispatch never calls the transport', async () => {
  const guard = createPrivateWorkspaceGuard(() => {});
  await assert.rejects(
    guard.run(() => {
      throw { status: 403 };
    }),
    PrivateWorkspaceCleared,
  );
  const other = createPrivateWorkspaceGuard(() => {});
  let sent = false;
  const pending = other.run(async () => {
    sent = true;
  });
  other.invalidate();
  await assert.rejects(pending, PrivateWorkspaceCleared);
  assert.equal(sent, false);
});

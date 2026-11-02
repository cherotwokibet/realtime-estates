import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStaffPreviewShutdown, retireOwnedStaffChild } from './staff-preview-lifecycle.mjs';

const ownedChild = () => {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null;
  child.signalCode = null;
  child.finish = () => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };
  return child;
};

test('shutdown shares one promise and closes API even when input and child cleanup fail', async () => {
  const calls = [],
    child = ownedChild(),
    shutdown = createStaffPreviewShutdown({
      closeInput() {
        calls.push('input');
        throw Error('input failure');
      },
      takeChild: () => child,
      async retireChild(value) {
        assert.equal(value, child);
        calls.push('child');
        throw Error('child failure');
      },
      async closeApi() {
        calls.push('api');
      },
    });
  const first = shutdown.stop(),
    second = shutdown.stop();
  assert.equal(first, second);
  assert.equal(shutdown.isStopping(), true);
  await assert.rejects(first, AggregateError);
  await assert.rejects(shutdown.stop(), AggregateError);
  assert.deepEqual(calls, ['input', 'child', 'api']);
});

test('Windows retirement uses only the exact owned PID and confirms an already-exiting taskkill race', async () => {
  const child = ownedChild(),
    calls = [];
  await retireOwnedStaffChild(child, {
    platform: 'win32',
    timeoutMs: 100,
    async executeFile(...args) {
      calls.push(args);
      setImmediate(() => child.finish());
      throw Error('not found');
    },
  });
  assert.deepEqual(calls, [
    ['taskkill', ['/PID', '12345', '/T', '/F'], { windowsHide: true, timeout: 100 }],
  ]);
  assert.equal(child.listenerCount('exit'), 0);
});

test('failed child retirement without observed exit rejects while shutdown still closes fixtures', async () => {
  const child = ownedChild();
  let closed = 0;
  const shutdown = createStaffPreviewShutdown({
    closeInput() {},
    takeChild: () => child,
    retireChild: (value) =>
      retireOwnedStaffChild(value, {
        platform: 'win32',
        timeoutMs: 5,
        async executeFile() {
          throw Error('access denied');
        },
      }),
    closeApi: async () => {
      closed++;
    },
  });
  await assert.rejects(shutdown.stop(), AggregateError);
  assert.equal(closed, 1);
  assert.equal(child.listenerCount('exit'), 0);
});

test('POSIX retirement waits for actual child exit before allowing replacement work', async () => {
  const child = ownedChild(),
    calls = [];
  child.kill = (signal) => {
    calls.push(signal);
    return true;
  };
  let retired = false;
  const pending = retireOwnedStaffChild(child, { platform: 'linux', timeoutMs: 100 }).then(() => {
    retired = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retired, false);
  assert.deepEqual(calls, ['SIGTERM']);
  child.finish();
  await pending;
  assert.equal(retired, true);
});

test('already exited and never spawned children cause no process command', async () => {
  const child = ownedChild();
  child.finish();
  const options = {
    platform: 'win32',
    executeFile: async () => assert.fail('no command expected'),
  };
  await retireOwnedStaffChild(child, options);
  child.exitCode = null;
  child.pid = undefined;
  await retireOwnedStaffChild(child, options);
  await retireOwnedStaffChild(null, options);
});

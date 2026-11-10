import test from 'node:test';
import assert from 'node:assert/strict';
import { startCustomerPreview } from './customer-preview.mjs';
import { createMobileCustomerSession } from '../../mobile/src/customer-session.ts';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('native controller crosses signed HTTP and restricted SQL, recovers committed original, isolates accounts and clears revocation', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let preview, session;
  const calls = [];
  try {
    preview = await startCustomerPreview({ replyFault: 'lost-first-favourite-result-v1' });
    const fixture = preview.configuration('http://127.0.0.1:3137');
    session = createMobileCustomerSession(
      {
        mode: 'runtime-customer-v1',
        tenantId: preview.tenantId,
        apiOrigin: preview.origin,
        allowLoopbackHttp: true,
      },
      async (url, init) => {
        calls.push({ path: new URL(url).pathname, method: init.method });
        return fetch(url, init);
      },
    );
    const grant = (index) => ({
      policy: 'runtime-customer-grant-v1',
      tenantId: preview.tenantId,
      customerId: fixture.users[index].id,
      generation: id(9900 + index),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      bearerToken: fixture.users[index].bearerToken,
    });
    assert.equal(await session.activate(grant(0)), true);
    assert.equal((await session.list()).items.length, 0);
    const command = {
      policy: 'customer-favourite-command-v1',
      operationId: id(88000),
      listingId: preview.listingId,
      expectedVersion: '0',
      saved: true,
    };
    assert.equal(await session.save(command), false);
    assert.equal(session.snapshot().phase, 'uncertain');
    assert.equal(await session.retry(), false);
    assert.equal(await session.recover(), true);
    assert.equal(session.snapshot().receipt.version, '1');
    assert.equal(session.settle(), true);
    assert.equal((await session.favourite(preview.listingId)).saved, true);
    assert.equal((await session.list()).items.length, 1);
    await preview.pause();
    assert.equal((await session.list()).items[0].available, false);
    assert.equal(await session.activate(grant(1)), true);
    assert.equal((await session.list()).items.length, 0);
    assert.equal(session.snapshot().pending, null);
    assert.equal(await session.activate(grant(0)), true);
    await preview.revoke();
    assert.equal(await session.list(), null);
    assert.equal(session.snapshot().status, 'signed_out');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
    assert.equal(calls.filter((c) => c.path.endsWith('/' + command.operationId)).length, 2);
    assert(!JSON.stringify(session).includes('bearerToken'));
  } finally {
    session?.clear();
    await preview?.close();
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

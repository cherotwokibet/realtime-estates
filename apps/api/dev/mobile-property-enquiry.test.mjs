import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadMobileReferenceCatalogue } from '../../mobile/src/reference-catalogue.ts';
import { startCustomerPreview } from './customer-preview.mjs';
import { prepareSyntheticMobileEnquiry } from '../../mobile/src/property-enquiry.ts';

test('mobile property enquiry recovers a committed receipt after pause with one stored row for both brands', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    for (const tenantSlug of ['realtime-estates', 'sample-homes']) {
      const preview = await startCustomerPreview({
        tenantSlug,
        mobileMode: 'synthetic-mobile-customer-v1',
        enquiryReplyFault: 'lost-first-enquiry-result-v1',
      });
      try {
        const config = {
          mode: 'synthetic-reference-public-v1',
          tenantSlug,
          apiOrigin: preview.origin,
          allowLoopbackHttp: true,
          customerMode: 'synthetic-mobile-customer-v1',
        };
        const calls = [];
        const transport = (url, options) => {
          calls.push({ url, options });
          return fetch(url, options);
        };
        const attempt = prepareSyntheticMobileEnquiry(
          config,
          preview.listingId,
          'availability',
          randomUUID(),
          transport,
        );
        assert.equal(attempt.state.status, 'ready');
        await assert.rejects(() => attempt.submit());
        assert.equal(attempt.state.status, 'uncertain');
        assert.equal(await preview.enquiryCount(), 1);
        await assert.rejects(() => attempt.submit());
        assert.equal(calls.length, 1);
        await preview.pause();
        const receipt = await attempt.retryOriginal();
        assert.match(receipt.id, /^[0-9a-f-]{36}$/);
        assert.equal(attempt.state.status, 'received');
        assert.equal(await preview.enquiryCount(), 1);
        await assert.rejects(() => attempt.retryOriginal());
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, preview.origin + '/v1/enquiries');
        assert.equal(calls[0].options.body, calls[1].options.body);
        assert.equal(
          new Headers(calls[0].options.headers).get('idempotency-key'),
          attempt.idempotencyKey,
        );
        assert.equal(
          new Headers(calls[1].options.headers).get('idempotency-key'),
          attempt.idempotencyKey,
        );
        for (const call of calls) {
          assert.equal(call.options.credentials, 'omit');
          assert.equal(call.options.redirect, 'error');
          assert.equal(new Headers(call.options.headers).has('authorization'), false);
          assert.equal(JSON.parse(call.options.body).origin, 'mobile');
        }
        const unavailable = prepareSyntheticMobileEnquiry(
          config,
          preview.listingId,
          'viewing',
          randomUUID(),
          transport,
        );
        await assert.rejects(() => unavailable.submit(), {
          kind: 'HTTP',
          status: 404,
          serverCode: 'NOT_FOUND',
        });
        assert.equal(unavailable.state.status, 'rejected');
        assert.equal(await preview.enquiryCount(), 1);
      } finally {
        await preview.close();
      }
    }
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

test('mobile enquiry preparation rejects disabled or foreign configuration and invalid targets before dispatch', () => {
  const config = {
    mode: 'synthetic-reference-public-v1',
    tenantSlug: 'realtime-estates',
    apiOrigin: 'http://127.0.0.1:3137',
    allowLoopbackHttp: true,
    customerMode: 'synthetic-mobile-customer-v1',
  };
  let calls = 0;
  const transport = async () => {
    calls++;
    throw Error();
  };
  const id = '00000000-0000-4000-8000-000000000410';
  for (const bad of [
    { mode: 'demo' },
    { ...config, customerMode: undefined },
    { ...config, apiOrigin: 'https://foreign.invalid' },
  ])
    assert.throws(() =>
      prepareSyntheticMobileEnquiry(bad, id, 'availability', randomUUID(), transport),
    );
  assert.throws(() =>
    prepareSyntheticMobileEnquiry(config, 'bad', 'availability', randomUUID(), transport),
  );
  assert.throws(() =>
    prepareSyntheticMobileEnquiry(config, id, 'unknown', randomUUID(), transport),
  );
  assert.equal(calls, 0);
});

test(
  'the mobile preview pauses its listing and can restart on the same loopback port',
  { timeout: 30_000 },
  async (t) => {
    const launcher = fileURLToPath(
      new URL('../../../scripts/mobile-customer-preview.mjs', import.meta.url),
    );
    async function launch(port, flags = []) {
      const child = spawn(process.execPath, [launcher, 'realtime-estates', ...flags], {
        env: { ...process.env, NODE_ENV: 'development', MOBILE_PREVIEW_API_PORT: port },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const exited = once(child, 'exit');
      const output = createInterface({ input: child.stdout });
      t.after(() => {
        output.close();
        if (child.exitCode === null && child.signalCode === null) child.kill();
      });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
      });
      const lines = output[Symbol.asyncIterator]();
      const ready = await lines.next();
      return { child, exited, lines, ready, stderr: () => stderr };
    }

    const first = await launch('0', ['--lost-enquiry']);
    assert.equal(first.ready.done, false, first.stderr());
    const preview = JSON.parse(first.ready.value);
    const port = new URL(preview.MOBILE_API_ORIGIN).port;
    const config = {
      mode: preview.MOBILE_CATALOGUE_MODE,
      tenantSlug: preview.TENANT_SLUG,
      apiOrigin: preview.MOBILE_API_ORIGIN,
      allowLoopbackHttp: preview.MOBILE_ALLOW_LOOPBACK_API === 'true',
    };

    const collision = await launch(port);
    assert.equal(collision.ready.done, true, collision.stderr());
    assert.deepEqual(await collision.exited, [1, null], collision.stderr());
    assert.match(collision.stderr(), /EADDRINUSE/);
    const before = await loadMobileReferenceCatalogue(config);
    assert.equal(before.status, 'ready');
    assert.ok(before.items.some(({ property }) => property.id === preview.listingId));

    first.child.stdin.write('pause\n');
    assert.equal(
      (await first.lines.next()).value,
      'The synthetic listing is paused.',
      first.stderr(),
    );
    const after = await loadMobileReferenceCatalogue(config);
    assert.equal(after.status, 'ready');
    assert.ok(after.items.every(({ property }) => property.id !== preview.listingId));
    first.child.stdin.write('quit\n');
    assert.deepEqual(await first.exited, [0, null], first.stderr());

    const second = await launch(port);
    assert.equal(second.ready.done, false, second.stderr());
    const restarted = JSON.parse(second.ready.value);
    assert.equal(restarted.MOBILE_API_ORIGIN, preview.MOBILE_API_ORIGIN);
    const reset = await loadMobileReferenceCatalogue(config);
    assert.equal(reset.status, 'ready');
    assert.ok(reset.items.some(({ property }) => property.id === restarted.listingId));
    second.child.stdin.write('quit\n');
    assert.deepEqual(await second.exited, [0, null], second.stderr());
  },
);

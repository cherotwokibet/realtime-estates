import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
        await assert.rejects(() => unavailable.submit());
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

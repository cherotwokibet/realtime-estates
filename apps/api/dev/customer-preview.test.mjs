import test from 'node:test';
import assert from 'node:assert/strict';
import { startCustomerPreview } from './customer-preview.mjs';
import { CustomerFavouritesClient } from '@realtor/api-client';
test('owned customer preview uses signed identity and positive foreign saved fixture without serializing credentials', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    for (const slug of ['realtime-estates', 'sample-homes']) {
      const p = await startCustomerPreview({ tenantSlug: slug });
      try {
        assert(!JSON.stringify(p).includes('bearerToken'));
        const c = p.configuration('http://127.0.0.1:3137'),
          auth = { bearerToken: c.users[0].bearerToken },
          sdk = new CustomerFavouritesClient({
            baseUrl: p.origin,
            scope: { tenantId: p.tenantId, customerId: c.users[0].id },
            allowLoopbackHttp: true,
          });
        assert.equal((await sdk.getAccount(auth)).tenantId, p.tenantId);
        assert.equal((await sdk.listFavourites(auth)).items.length, 0);
        if (slug === 'sample-homes') assert.equal(p.foreignSavedFixture, true);
      } finally {
        await p.close();
      }
    }
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
test('preview refuses production or unknown policies before fixture launch', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => startCustomerPreview());
  } finally {
    process.env.NODE_ENV = 'development';
  }
  try {
    await assert.rejects(() => startCustomerPreview({ tenantSlug: 'external' }));
    await assert.rejects(() => startCustomerPreview({ replyFault: 'unknown' }));
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

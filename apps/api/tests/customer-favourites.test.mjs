import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const headers = { authorization: 'Bearer synthetic.header.signature' };
const config = {
  tenantId: id(1),
  privacyNoticeVersion: 'synthetic-customer313',
  customerFavouritesMode: 'synthetic-customer-favourites-v1',
  verifyAuthorization: async () => ({ actorId: id(13) }),
};
test('malformed database replies are refused without accessing original getters or exposing database errors', async () => {
  let getters = 0;
  const row = {};
  Object.defineProperty(row, 'listingId', {
    enumerable: true,
    get() {
      getters++;
      return id(200);
    },
  });
  const service = createApiService({
    ...config,
    database: {
      async transaction(context, fn) {
        assert.equal(context.tenantId, id(1));
        assert.equal(context.actorId, id(13));
        return fn({ query: async () => ({ rows: [{ result: row }] }) });
      },
    },
  });
  for (const path of [
    '/v2/customer/account',
    '/v2/customer/favourites/' + id(200),
    '/v2/customer/favourites',
    '/v2/customer/favourite-operations/' + id(100),
  ]) {
    const r = await service(new Request('https://synthetic.invalid' + path, { headers }));
    assert.equal(r.status, 500);
    assert(!(await r.text()).includes('listingId'));
  }
  assert.equal(getters, 0);
  const broken = createApiService({
    ...config,
    database: {
      async transaction() {
        throw Error('secret database connection');
      },
    },
  });
  const r = await broken(new Request('https://synthetic.invalid/v2/customer/account', { headers }));
  assert.equal(r.status, 500);
  assert(!(await r.text()).includes('secret'));
});
test('customer route method/path refusals and omitted mode do not touch database or verifier', async () => {
  let queries = 0,
    verified = 0;
  const opts = {
    ...config,
    verifyAuthorization: async () => {
      verified++;
      return { actorId: id(13) };
    },
    database: {
      async transaction() {
        queries++;
        throw Error('unreachable');
      },
    },
  };
  const enabled = createApiService(opts);
  assert.equal(
    (
      await enabled(
        new Request('https://synthetic.invalid/v2/customer/account', { method: 'POST', headers }),
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await enabled(
        new Request('https://synthetic.invalid/v2/customer/favourites/invalid', { headers }),
      )
    ).status,
    404,
  );
  const { customerFavouritesMode, ...off } = opts;
  assert.equal(
    (
      await createApiService(off)(
        new Request('https://synthetic.invalid/v2/customer/account', { headers }),
      )
    ).status,
    404,
  );
  assert.equal(queries, 0);
  assert.equal(verified, 0);
});

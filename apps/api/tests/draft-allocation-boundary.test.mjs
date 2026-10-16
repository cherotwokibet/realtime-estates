import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const full = normalizeStaffDraftContentV2({
  title: 'Synthetic existing edit',
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: null, town: null, area: null },
});
const { pricing, location, ...legacy } = full;
test('ordinary v1/v2 draft saves reject zero before mutation and retain typed positive-version edits', async () => {
  const writes = [];
  let verified = 0;
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async () => {
      verified++;
      return { actorId: id(2) };
    },
    database: {
      transaction: async (context, run) =>
        run({
          query: async (sql, args) => {
            writes.push({ context, sql, args });
            return { rows: [{ version: '3' }] };
          },
        }),
    },
  });
  for (const contract of ['v1', 'v2']) {
    const content = contract === 'v1' ? legacy : full;
    for (const expectedVersion of [0, '0', -1]) {
      const response = await service(
        new Request(`https://synthetic.invalid/${contract}/staff/listings/${id(3)}/drafts/2`, {
          method: 'PUT',
          headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
          body: JSON.stringify({ expectedVersion, content }),
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(writes.length, 0, 'Allocation must be rejected before a mutation transaction.');
    }
  }
  assert.equal(verified, 6);
  for (const contract of ['v1', 'v2']) {
    const content = contract === 'v1' ? legacy : full;
    const response = await service(
      new Request(`https://synthetic.invalid/${contract}/staff/listings/${id(3)}/drafts/2`, {
        method: 'PUT',
        headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 2, content }),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: '3' });
    const call = writes.at(-1);
    assert.deepEqual(call.args.slice(0, 3), [id(3), 2, 2]);
    assert.equal(call.context.actorId, id(2));
    assert.equal(call.context.tenantId, id(1));
  }
});

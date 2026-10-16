import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, validateStaffDraftContentV2 } from '../dist/index.js';
const content = () => ({
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: null, town: null, area: null },
});
test('staff SDK shared draft normalization blocks getters and hidden authority before write dispatch', async () => {
  let reads = 0,
    calls = 0;
  const api = new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic-v1',
      fetch: async () => {
        calls++;
        throw new Error('must not dispatch');
      },
    }),
    getter = content();
  Object.defineProperty(getter, 'title', {
    enumerable: true,
    get() {
      reads++;
      return 'unsafe';
    },
  });
  const hidden = content();
  Object.defineProperty(hidden, 'actorId', { value: 'unsafe' });
  for (const input of [getter, hidden]) {
    assert.throws(
      () => validateStaffDraftContentV2(input),
      (e) => e.kind === 'VALIDATION',
    );
    await assert.rejects(
      () =>
        api.saveStaffDraftV2(
          '00000000-0000-4000-8000-000000000100',
          1,
          { expectedVersion: '2', content: input },
          { bearerToken: 'synthetic' },
        ),
      (e) => e.kind === 'VALIDATION' && !e.submissionUncertain,
    );
  }
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  assert.equal(validateStaffDraftContentV2(content()).amountMinor, null);
});

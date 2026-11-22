import test from 'node:test';
import { fixture, publish } from './public-media-fixtures.mjs';
import { verifyAllocationCompletionPrecision } from '../integration-tests/private-operation-resolution-checks.mjs';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
test('forward precision migration preserves guarded creation/successor behavior and the real-PG rehearsal fixture uses the maintained schema', async () => {
  const db = await fixture();
  try {
    await publish(db);
    await verifyAllocationCompletionPrecision(db, db, id);
  } finally {
    await db.close();
  }
});
